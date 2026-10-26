import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createBuildingSchema, createFloorSchema, updateBuildingSchema, updateFloorSchema, type BuildingDto, type FloorDto } from '@krevia/shared';
import { Prisma, type Building, type Floor } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { CurrentSociety, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';

type FloorRow = Floor & { _count: { units: number } };
type BuildingRow = Building & { floors: FloorRow[]; _count: { units: number } };

const buildingInclude = {
  floors: { orderBy: { level: 'asc' }, include: { _count: { select: { units: true } } } },
  _count: { select: { units: true } },
} satisfies Prisma.BuildingInclude;

const toFloorDto = (f: FloorRow): FloorDto => ({
  id: f.id,
  buildingId: f.buildingId,
  level: f.level,
  name: f.name,
  unitCount: f._count.units,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
});

const toBuildingDto = (b: BuildingRow): BuildingDto => ({
  id: b.id,
  societyId: b.societyId,
  name: b.name,
  archivedAt: b.archivedAt?.toISOString() ?? null,
  floors: b.floors.map(toFloorDto),
  unitCount: b._count.units,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
});

/** Replace a society's legacy tower label list while preserving order. */
function withTower(towers: string[], name: string, previous?: string) {
  const next = towers.filter((t) => t.toLowerCase() !== name.toLowerCase() && (!previous || t.toLowerCase() !== previous.toLowerCase()));
  const at = previous ? towers.findIndex((t) => t.toLowerCase() === previous.toLowerCase()) : -1;
  if (at >= 0) next.splice(at, 0, name);
  else next.push(name);
  return next;
}

@ApiTags('buildings')
@Controller('societies/:societyId/buildings')
export class BuildingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireSocietyPermission('building.read')
  @ApiOperation({ summary: 'Towers / blocks and their floors (administrators)' })
  async list(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const includeArchived = typeof query === 'object' && query !== null && (query as Record<string, unknown>).includeArchived === 'true';
    const rows = await this.prisma.building.findMany({
      where: { societyId: ctx.societyId, ...(includeArchived ? {} : { archivedAt: null }) },
      include: buildingInclude,
      orderBy: { name: 'asc' },
    });
    return { items: rows.map(toBuildingDto) };
  }

  @Post()
  @RequireSocietyPermission('building.manage')
  @ApiOperation({ summary: 'Add a tower / block' })
  @ApiBody({ schema: jsonSchema(createBuildingSchema) })
  async create(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Body() body: unknown) {
    const { name } = validate(createBuildingSchema, body);
    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: ctx.societyId }, select: { towers: true } });
    const existing = await this.prisma.building.findFirst({
      where: { societyId: ctx.societyId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw Errors.conflict(`Tower ${name} already exists.`);
    }
    // A legacy tower label may exist without a Building row; adopt its spelling.
    const canonical = society.towers.find((t) => t.toLowerCase() === name.toLowerCase()) ?? name;
    const building = await this.prisma.$transaction(async (tx) => {
      const created = await tx.building.create({ data: { societyId: ctx.societyId, name: canonical }, include: buildingInclude });
      if (!society.towers.some((t) => t.toLowerCase() === canonical.toLowerCase())) {
        await tx.society.update({ where: { id: ctx.societyId }, data: { towers: { set: [...society.towers, canonical] } } });
      }
      await this.audit.record(
        { action: 'building.created', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'building', targetId: created.id, metadata: { name } },
        tx,
      );
      return created;
    });
    return { building: toBuildingDto(building) };
  }

  @Get(':buildingId')
  @RequireSocietyPermission('building.read')
  @ApiOperation({ summary: 'One tower / block with its floors' })
  async detail(@CurrentSociety() ctx: SocietyContext, @Param('buildingId') id: string) {
    const building = await this.prisma.building.findFirst({
      where: { id: validateId(id, 'buildingId'), societyId: ctx.societyId },
      include: buildingInclude,
    });
    if (!building) throw Errors.notFound('Tower / block not found.');
    return { building: toBuildingDto(building) };
  }

  @Patch(':buildingId')
  @RequireSocietyPermission('building.manage')
  @ApiOperation({ summary: 'Rename a tower / block. Units keep their association.' })
  @ApiBody({ schema: jsonSchema(updateBuildingSchema) })
  async update(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('buildingId') id: string,
    @Body() body: unknown,
  ) {
    const buildingId = validateId(id, 'buildingId');
    const { name } = validate(updateBuildingSchema, body);
    const building = await this.prisma.$transaction(async (tx) => {
      const current = await tx.building.findFirst({ where: { id: buildingId, societyId: ctx.societyId } });
      if (!current) throw Errors.notFound('Tower / block not found.');
      if (name && name.toLowerCase() !== current.name.toLowerCase()) {
        const clash = await tx.building.findFirst({
          where: { societyId: ctx.societyId, name: { equals: name, mode: 'insensitive' }, NOT: { id: buildingId } },
          select: { id: true },
        });
        if (clash) throw Errors.conflict(`Tower ${name} already exists.`);
      }
      const society = await tx.society.findUniqueOrThrow({ where: { id: ctx.societyId }, select: { towers: true } });
      const updated = await tx.building.update({ where: { id: buildingId }, data: { ...(name && { name }) }, include: buildingInclude });
      if (name && name !== current.name) {
        await tx.unit.updateMany({ where: { buildingId, societyId: ctx.societyId }, data: { tower: name } });
        await tx.society.update({ where: { id: ctx.societyId }, data: { towers: { set: withTower(society.towers, name, current.name) } } });
      }
      await this.audit.record(
        { action: 'building.updated', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'building', targetId: buildingId, metadata: { fields: Object.keys(body as object) } },
        tx,
      );
      return updated;
    });
    return { building: toBuildingDto(building) };
  }

  @Post(':buildingId/archive')
  @HttpCode(200)
  @RequireSocietyPermission('building.manage')
  @ApiOperation({ summary: 'Archive a tower / block. Active units must be archived first.' })
  async archive(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('buildingId') id: string) {
    const buildingId = validateId(id, 'buildingId');
    const building = await this.prisma.$transaction(async (tx) => {
      const current = await tx.building.findFirst({ where: { id: buildingId, societyId: ctx.societyId } });
      if (!current) throw Errors.notFound('Tower / block not found.');
      if (current.archivedAt) return tx.building.findUniqueOrThrow({ where: { id: buildingId }, include: buildingInclude });
      const activeUnits = await tx.unit.count({ where: { buildingId, societyId: ctx.societyId, status: 'ACTIVE' } });
      if (activeUnits > 0) throw Errors.conflict(`Archive the ${activeUnits} active unit(s) in this tower first.`);
      const updated = await tx.building.update({ where: { id: buildingId }, data: { archivedAt: new Date() }, include: buildingInclude });
      const society = await tx.society.findUniqueOrThrow({ where: { id: ctx.societyId }, select: { towers: true } });
      await tx.society.update({
        where: { id: ctx.societyId },
        data: { towers: { set: society.towers.filter((t) => t.toLowerCase() !== current.name.toLowerCase()) } },
      });
      await this.audit.record(
        { action: 'building.archived', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'building', targetId: buildingId },
        tx,
      );
      return updated;
    });
    return { building: toBuildingDto(building) };
  }

  @Post(':buildingId/floors')
  @RequireSocietyPermission('building.manage')
  @ApiOperation({ summary: 'Add a floor to a tower / block' })
  @ApiBody({ schema: jsonSchema(createFloorSchema) })
  async createFloor(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('buildingId') id: string,
    @Body() body: unknown,
  ) {
    const buildingId = validateId(id, 'buildingId');
    const input = validate(createFloorSchema, body);
    const building = await this.prisma.building.findFirst({ where: { id: buildingId, societyId: ctx.societyId }, select: { id: true, archivedAt: true } });
    if (!building) throw Errors.notFound('Tower / block not found.');
    if (building.archivedAt) throw Errors.conflict('This tower / block is archived.');
    try {
      const floor = await this.prisma.$transaction(async (tx) => {
        const created = await tx.floor.create({
          data: { societyId: ctx.societyId, buildingId, level: input.level, name: input.name || null },
          include: { _count: { select: { units: true } } },
        });
        await this.audit.record(
          { action: 'floor.created', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'floor', targetId: created.id, metadata: { buildingId, level: input.level } },
          tx,
        );
        return created;
      });
      return { floor: toFloorDto(floor) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.conflict('This floor already exists in the tower.');
      throw err;
    }
  }

  @Patch(':buildingId/floors/:floorId')
  @RequireSocietyPermission('building.manage')
  @ApiOperation({ summary: 'Rename a floor or change its level' })
  @ApiBody({ schema: jsonSchema(updateFloorSchema) })
  async updateFloor(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('buildingId') buildingIdRaw: string,
    @Param('floorId') floorIdRaw: string,
    @Body() body: unknown,
  ) {
    const buildingId = validateId(buildingIdRaw, 'buildingId');
    const floorId = validateId(floorIdRaw, 'floorId');
    const input = validate(updateFloorSchema, body);
    const current = await this.prisma.floor.findFirst({ where: { id: floorId, buildingId, societyId: ctx.societyId } });
    if (!current) throw Errors.notFound('Floor not found.');
    try {
      const floor = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.floor.update({
          where: { id: floorId },
          data: { ...(input.level !== undefined && { level: input.level }), ...(input.name !== undefined && { name: input.name || null }) },
          include: { _count: { select: { units: true } } },
        });
        await this.audit.record(
          { action: 'floor.updated', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'floor', targetId: floorId, metadata: { fields: Object.keys(input) } },
          tx,
        );
        return updated;
      });
      return { floor: toFloorDto(floor) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.conflict('This floor already exists in the tower.');
      throw err;
    }
  }

  @Delete(':buildingId/floors/:floorId')
  @HttpCode(204)
  @RequireSocietyPermission('building.manage')
  @ApiOperation({ summary: 'Delete an empty floor' })
  async deleteFloor(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('buildingId') buildingIdRaw: string,
    @Param('floorId') floorIdRaw: string,
  ) {
    const buildingId = validateId(buildingIdRaw, 'buildingId');
    const floorId = validateId(floorIdRaw, 'floorId');
    await this.prisma.$transaction(async (tx) => {
      const floor = await tx.floor.findFirst({ where: { id: floorId, buildingId, societyId: ctx.societyId }, include: { _count: { select: { units: true } } } });
      if (!floor) throw Errors.notFound('Floor not found.');
      if (floor._count.units > 0) throw Errors.conflict('Move or archive the units on this floor first.');
      await tx.floor.delete({ where: { id: floorId } });
      await this.audit.record(
        { action: 'floor.deleted', outcome: 'SUCCESS', actorUserId: session.userId, societyId: ctx.societyId, targetType: 'floor', targetId: floorId, metadata: { buildingId, level: floor.level } },
        tx,
      );
    });
  }
}
