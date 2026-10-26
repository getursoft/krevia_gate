import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { assignUnitSchema, createUnitSchema, unitListSchema, updateUnitSchema } from '@krevia/shared';
import { Prisma, type Building } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { CurrentSociety, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { ACTIVE_ASSIGNMENT, page, toAssignmentDto, toUnitDto, unitInclude } from '../members/member.mapper';
import { MembershipLifecycleService } from '../members/membership-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { endResidentAssignment } from '../residents/resident-sync';

type Tx = Prisma.TransactionClient;

/**
 * Units (flats) and resident assignments. Every query is scoped by the
 * authorised society id; a unit, membership or assignment from another
 * society is answered with 404, never touched.
 */
@ApiTags('units')
@Controller('societies/:societyId')
export class UnitsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MembershipLifecycleService,
    private readonly audit: AuditService,
  ) {}

  @Get('units')
  @RequireSocietyPermission('unit.read')
  @ApiOperation({ summary: 'Units of the society with their current residents (administrators)' })
  async list(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const { page: pageNo, pageSize, tower, buildingId, floorId, status, occupancy, q } = validate(unitListSchema, query);
    const occupancyWhere: Prisma.UnitWhereInput =
      occupancy === 'OCCUPIED'
        ? { OR: [{ assignments: { some: ACTIVE_ASSIGNMENT } }, { residentUnits: { some: { endedAt: null } } }] }
        : occupancy === 'VACANT'
          ? { AND: [{ assignments: { none: ACTIVE_ASSIGNMENT } }, { residentUnits: { none: { endedAt: null } } }] }
          : {};
    const where: Prisma.UnitWhereInput = {
      societyId: ctx.societyId,
      ...(tower && { building: { name: { equals: tower, mode: 'insensitive' } } }),
      ...(buildingId && { buildingId }),
      ...(floorId && { floorId }),
      ...(status && { status }),
      ...(q && { number: { contains: q.toUpperCase() } }),
      ...occupancyWhere,
    };
    const [total, rows] = await Promise.all([
      this.prisma.unit.count({ where }),
      this.prisma.unit.findMany({
        where,
        include: unitInclude,
        orderBy: [{ building: { name: 'asc' } }, { floor: { level: 'asc' } }, { number: 'asc' }],
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return page(rows.map(toUnitDto), pageNo, pageSize, total);
  }

  @Post('units')
  @RequireSocietyPermission('unit.create')
  @ApiOperation({ summary: 'Add a unit to a tower / block, optionally on a floor' })
  @ApiBody({ schema: jsonSchema(createUnitSchema) })
  async create(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Body() body: unknown) {
    const input = validate(createUnitSchema, body);
    try {
      const unit = await this.prisma.$transaction(async (tx) => {
        const building = await this.resolveBuilding(tx, ctx.societyId, input);
        if (input.floorId) await this.assertFloor(tx, ctx.societyId, building.id, input.floorId);
        const created = await tx.unit.create({
          data: {
            societyId: ctx.societyId,
            tower: building.name,
            buildingId: building.id,
            floorId: input.floorId ?? null,
            number: input.number,
          },
          include: unitInclude,
        });
        await this.audit.record(
          {
            action: 'unit.created',
            outcome: 'SUCCESS',
            actorUserId: session.userId,
            societyId: ctx.societyId,
            targetType: 'unit',
            targetId: created.id,
            metadata: { tower: building.name, number: input.number, floorId: input.floorId ?? null },
          },
          tx,
        );
        return created;
      });
      return { unit: toUnitDto(unit) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict(`Unit ${input.number} already exists in this tower.`);
      }
      throw err;
    }
  }

  @Get('my-units')
  @RequireSocietyPermission('household.read')
  @ApiOperation({ summary: 'Units I am currently assigned to in this society (residents)' })
  async mine(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext) {
    const rows = await this.prisma.unit.findMany({
      where: {
        societyId: ctx.societyId,
        status: 'ACTIVE',
        assignments: { some: { ...ACTIVE_ASSIGNMENT, membership: { userId: session.userId, status: 'ACTIVE', role: 'RESIDENT' } } },
      },
      include: unitInclude,
      orderBy: [{ building: { name: 'asc' } }, { number: 'asc' }],
    });
    return { items: rows.map(toUnitDto) };
  }

  @Get('units/:unitId')
  @RequireSocietyPermission('unit.read')
  @ApiOperation({ summary: 'One unit of the society (administrators)' })
  async detail(@CurrentSociety() ctx: SocietyContext, @Param('unitId') id: string) {
    const unit = await this.prisma.unit.findFirst({ where: { id: validateId(id, 'unitId'), societyId: ctx.societyId }, include: unitInclude });
    if (!unit) throw Errors.notFound('Unit not found.');
    return { unit: toUnitDto(unit) };
  }

  @Patch('units/:unitId')
  @RequireSocietyPermission('unit.create')
  @ApiOperation({ summary: 'Rename or move a unit. Residents keep their links.' })
  @ApiBody({ schema: jsonSchema(updateUnitSchema) })
  async update(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('unitId') id: string,
    @Body() body: unknown,
  ) {
    const unitId = validateId(id, 'unitId');
    const input = validate(updateUnitSchema, body);
    try {
      const unit = await this.prisma.$transaction(async (tx) => {
        const current = await tx.unit.findFirst({ where: { id: unitId, societyId: ctx.societyId } });
        if (!current) throw Errors.notFound('Unit not found.');
        const building = input.buildingId
          ? await this.resolveBuilding(tx, ctx.societyId, { buildingId: input.buildingId })
          : await tx.building.findFirstOrThrow({ where: { id: current.buildingId, societyId: ctx.societyId } });
        let floorId = current.floorId;
        if (input.floorId !== undefined) floorId = input.floorId;
        else if (building.id !== current.buildingId) floorId = null;
        if (floorId) await this.assertFloor(tx, ctx.societyId, building.id, floorId);
        const updated = await tx.unit.update({
          where: { id: unitId },
          data: {
            ...(input.number !== undefined && { number: input.number }),
            buildingId: building.id,
            tower: building.name,
            floorId,
          },
          include: unitInclude,
        });
        await this.audit.record(
          {
            action: 'unit.updated',
            outcome: 'SUCCESS',
            actorUserId: session.userId,
            societyId: ctx.societyId,
            targetType: 'unit',
            targetId: unitId,
            metadata: { fields: Object.keys(input) },
          },
          tx,
        );
        return updated;
      });
      return { unit: toUnitDto(unit) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('Another unit already uses this number in that tower.');
      }
      throw err;
    }
  }

  @Post('units/:unitId/archive')
  @HttpCode(200)
  @RequireSocietyPermission('unit.create')
  @ApiOperation({ summary: 'Archive an empty unit. End resident links first.' })
  async archive(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('unitId') id: string) {
    const unitId = validateId(id, 'unitId');
    const unit = await this.prisma.$transaction(async (tx) => {
      const current = await tx.unit.findFirst({ where: { id: unitId, societyId: ctx.societyId } });
      if (!current) throw Errors.notFound('Unit not found.');
      if (current.status === 'ARCHIVED') return tx.unit.findUniqueOrThrow({ where: { id: unitId }, include: unitInclude });
      const [assignments, links] = await Promise.all([
        tx.unitAssignment.count({ where: { unitId, societyId: ctx.societyId, endedAt: null } }),
        tx.residentUnit.count({ where: { unitId, societyId: ctx.societyId, endedAt: null } }),
      ]);
      if (assignments + links > 0) {
        throw Errors.conflict('End the active resident links for this unit before archiving it.');
      }
      const updated = await tx.unit.update({
        where: { id: unitId },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
        include: unitInclude,
      });
      await this.audit.record(
        {
          action: 'unit.archived',
          outcome: 'SUCCESS',
          actorUserId: session.userId,
          societyId: ctx.societyId,
          targetType: 'unit',
          targetId: unitId,
        },
        tx,
      );
      return updated;
    });
    return { unit: toUnitDto(unit) };
  }

  @Post('units/:unitId/restore')
  @HttpCode(200)
  @RequireSocietyPermission('unit.create')
  @ApiOperation({ summary: 'Restore an archived unit' })
  async restore(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('unitId') id: string) {
    const unitId = validateId(id, 'unitId');
    const unit = await this.prisma.$transaction(async (tx) => {
      const current = await tx.unit.findFirst({ where: { id: unitId, societyId: ctx.societyId }, include: { building: true } });
      if (!current) throw Errors.notFound('Unit not found.');
      if (current.building.archivedAt) throw Errors.conflict('Restore the tower / block first.');
      const updated = await tx.unit.update({
        where: { id: unitId },
        data: { status: 'ACTIVE', archivedAt: null },
        include: unitInclude,
      });
      await this.audit.record(
        {
          action: 'unit.restored',
          outcome: 'SUCCESS',
          actorUserId: session.userId,
          societyId: ctx.societyId,
          targetType: 'unit',
          targetId: unitId,
        },
        tx,
      );
      return updated;
    });
    return { unit: toUnitDto(unit) };
  }

  @Post('units/:unitId/assignments')
  @RequireSocietyPermission('unit.assign')
  @ApiOperation({ summary: 'Assign an ACTIVE resident membership of this society to this unit' })
  @ApiBody({ schema: jsonSchema(assignUnitSchema) })
  async assign(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('unitId') id: string,
    @Body() body: unknown,
  ) {
    const unitId = validateId(id, 'unitId');
    const input = validate(assignUnitSchema, body);
    const assignment = await this.prisma.$transaction((tx) =>
      this.lifecycle.assignUnit(tx, { societyId: ctx.societyId, unitId, membershipId: input.membershipId, occupancy: input.occupancy, actorUserId: session.userId }),
    );
    return { assignment: toAssignmentDto(assignment) };
  }

  @Delete('units/:unitId/assignments/:assignmentId')
  @HttpCode(204)
  @RequireSocietyPermission('unit.assign')
  @ApiOperation({ summary: 'End a resident\'s assignment to this unit' })
  async unassign(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('unitId') unitIdRaw: string,
    @Param('assignmentId') assignmentIdRaw: string,
  ) {
    const unitId = validateId(unitIdRaw, 'unitId');
    const assignmentId = validateId(assignmentIdRaw, 'assignmentId');
    await this.prisma.$transaction(async (tx) => {
      const ended = await tx.unitAssignment.updateMany({
        where: { id: assignmentId, unitId, societyId: ctx.societyId, endedAt: null },
        data: { endedAt: new Date(), endedById: session.userId },
      });
      if (ended.count === 0) throw Errors.notFound('Assignment not found.');
      await endResidentAssignment(tx, assignmentId);
      await this.audit.record(
        { action: 'unit.unassigned', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'unit', targetId: unitId, metadata: { assignmentId } },
        tx,
      );
    });
  }

  /**
   * Resolves a building by id, or by legacy tower name. A legacy label without a
   * Building row (e.g. a society created before Sprint 3) is backfilled on use.
   */
  private async resolveBuilding(
    tx: Tx,
    societyId: string,
    input: { buildingId?: string; tower?: string },
  ): Promise<Building> {
    if (input.buildingId) {
      const building = await tx.building.findFirst({ where: { id: input.buildingId, societyId } });
      if (!building) throw Errors.notFound('Tower / block not found.');
      if (building.archivedAt) throw Errors.conflict('This tower / block is archived.');
      return building;
    }
    const name = input.tower?.trim();
    if (!name) throw Errors.validation({ buildingId: 'Choose a tower / block' });
    const society = await tx.society.findUniqueOrThrow({ where: { id: societyId }, select: { towers: true } });
    const existing = await tx.building.findFirst({ where: { societyId, name: { equals: name, mode: 'insensitive' } } });
    if (existing) {
      if (existing.archivedAt) throw Errors.conflict('This tower / block is archived.');
      return existing;
    }
    const canonical = society.towers.find((t) => t.toLowerCase() === name.toLowerCase()) ?? name;
    const created = await tx.building.create({ data: { societyId, name: canonical } });
    if (!society.towers.some((t) => t.toLowerCase() === canonical.toLowerCase())) {
      await tx.society.update({ where: { id: societyId }, data: { towers: { set: [...society.towers, canonical] } } });
    }
    return created;
  }

  private async assertFloor(tx: Tx, societyId: string, buildingId: string, floorId: string) {
    const floor = await tx.floor.findFirst({ where: { id: floorId, buildingId, societyId }, select: { id: true } });
    if (!floor) throw Errors.validation({ floorId: 'Choose a floor from this tower / block.' });
  }
}
