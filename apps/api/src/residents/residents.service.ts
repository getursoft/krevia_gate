import { Injectable } from '@nestjs/common';
import type { OccupancyType, Resident } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AddResidentUnitInput, CreateResidentInput, MyHouseholdDto, ResidentDto, UpdateResidentInput, UpdateResidentUnitInput } from '@krevia/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { MembershipLifecycleService } from '../members/membership-lifecycle.service';
import { toUnitDto, unitInclude } from '../members/member.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { residentInclude, toHouseholdMember, toResidentDto, type ResidentRowWithUnits } from './resident.mapper';
import { endResidentAssignment, syncResidentAssignment } from './resident-sync';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ResidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MembershipLifecycleService,
    private readonly audit: AuditService,
  ) {}

  async list(societyId: string, filters: { buildingId?: string; unitId?: string; relationship?: OccupancyType; status?: 'ACTIVE' | 'INACTIVE'; q?: string; page: number; pageSize: number }) {
    const where: Prisma.ResidentWhereInput = {
      societyId,
      ...(filters.status && { status: filters.status }),
      ...(filters.q && {
        OR: [
          { fullName: { contains: filters.q, mode: 'insensitive' } },
          { phone: { contains: filters.q.replace(/\D/g, '') || filters.q } },
          { email: { contains: filters.q, mode: 'insensitive' } },
        ],
      }),
      ...((filters.buildingId || filters.unitId || filters.relationship) && {
        units: {
          some: {
            endedAt: null,
            ...(filters.unitId && { unitId: filters.unitId }),
            ...(filters.relationship && { relationship: filters.relationship }),
            ...(filters.buildingId && { unit: { buildingId: filters.buildingId } }),
          },
        },
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.resident.count({ where }),
      this.prisma.resident.findMany({
        where,
        include: residentInclude,
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    return { rows, total };
  }

  async detail(societyId: string, residentId: string): Promise<ResidentRowWithUnits> {
    const resident = await this.prisma.resident.findFirst({ where: { id: residentId, societyId }, include: residentInclude });
    if (!resident) throw Errors.notFound('Resident not found.');
    return resident;
  }

  async create(societyId: string, actorUserId: string, input: CreateResidentInput & { relationship: OccupancyType }): Promise<ResidentDto> {
    const unit = await this.prisma.unit.findFirst({ where: { id: input.unitId, societyId }, select: { id: true, status: true } });
    if (!unit) throw Errors.notFound('Unit not found.');
    if (unit.status !== 'ACTIVE') throw Errors.conflict('This unit is archived. Restore it before adding residents.');

    const linkedUser = input.phone
      ? await this.prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } })
      : null;
    if (linkedUser) {
      const existingLink = await this.prisma.resident.findFirst({ where: { societyId, userId: linkedUser.id }, select: { id: true } });
      if (existingLink) throw Errors.conflict('This person is already in the resident directory. Edit their existing record instead.');
    }

    try {
      const resident = await this.prisma.$transaction(async (tx) => {
        const created = await tx.resident.create({
          data: {
            societyId,
            userId: linkedUser?.id ?? null,
            fullName: input.fullName,
            phone: input.phone ?? null,
            email: input.email ?? null,
            emergencyContactName: input.emergencyContactName || null,
            emergencyContactPhone: input.emergencyContactPhone ?? null,
            vehicles: (input.vehicles ?? []) as Prisma.InputJsonValue,
            createdById: actorUserId,
          },
        });
        if (input.isPrimary) await this.clearPrimary(tx, societyId, input.unitId);
        await tx.residentUnit.create({
          data: {
            societyId,
            residentId: created.id,
            unitId: input.unitId,
            relationship: input.relationship,
            isPrimary: input.isPrimary ?? false,
            createdById: actorUserId,
          },
        });
        await this.audit.record(
          {
            action: 'resident.created',
            outcome: 'SUCCESS',
            actorUserId,
            societyId,
            targetType: 'resident',
            targetId: created.id,
            metadata: { relationship: input.relationship, unitId: input.unitId, hasAccount: Boolean(linkedUser) },
          },
          tx,
        );
        return tx.resident.findUniqueOrThrow({ where: { id: created.id }, include: residentInclude });
      });
      return toResidentDto(resident);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('A resident with this mobile number is already in this society.');
      }
      throw err;
    }
  }

  async update(societyId: string, actorUserId: string, residentId: string, input: UpdateResidentInput): Promise<ResidentDto> {
    const current = await this.prisma.resident.findFirst({ where: { id: residentId, societyId } });
    if (!current) throw Errors.notFound('Resident not found.');
    if (input.phone && input.phone !== current.phone) {
      const clash = await this.prisma.resident.findFirst({ where: { societyId, phone: input.phone, NOT: { id: residentId } }, select: { id: true } });
      if (clash) throw Errors.conflict('Another resident already uses this mobile number.');
    }
    try {
      const resident = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.resident.update({
          where: { id: residentId },
          data: {
            ...(input.fullName !== undefined && { fullName: input.fullName }),
            ...(input.phone !== undefined && { phone: input.phone }),
            ...(input.email !== undefined && { email: input.email }),
            ...(input.status !== undefined && {
              status: input.status,
              ...(input.status === 'INACTIVE' && { archivedAt: new Date() }),
              ...(input.status === 'ACTIVE' && { archivedAt: null }),
            }),
            ...(input.emergencyContactName !== undefined && { emergencyContactName: input.emergencyContactName || null }),
            ...(input.emergencyContactPhone !== undefined && { emergencyContactPhone: input.emergencyContactPhone }),
            ...(input.vehicles !== undefined && { vehicles: input.vehicles as Prisma.InputJsonValue }),
          },
        });
        await this.audit.record(
          {
            action: 'resident.updated',
            outcome: 'SUCCESS',
            actorUserId,
            societyId,
            targetType: 'resident',
            targetId: residentId,
            metadata: { fields: Object.keys(input) },
          },
          tx,
        );
        return tx.resident.findUniqueOrThrow({ where: { id: updated.id }, include: residentInclude });
      });
      return toResidentDto(resident);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('A resident with this mobile number is already in this society.');
      }
      throw err;
    }
  }

  async archive(societyId: string, actorUserId: string, residentId: string): Promise<ResidentDto> {
    const current = await this.prisma.resident.findFirst({ where: { id: residentId, societyId } });
    if (!current) throw Errors.notFound('Resident not found.');
    const resident = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.resident.update({ where: { id: residentId }, data: { status: 'INACTIVE', archivedAt: now } });
      const activeUnits = await tx.residentUnit.findMany({ where: { residentId, societyId, endedAt: null }, select: { id: true, assignmentId: true, unitId: true } });
      await tx.residentUnit.updateMany({ where: { residentId, societyId, endedAt: null }, data: { endedAt: now } });
      for (const link of activeUnits) {
        if (link.assignmentId) {
          await tx.unitAssignment.updateMany({ where: { id: link.assignmentId, endedAt: null }, data: { endedAt: now, endedById: actorUserId } });
          await this.audit.record(
            { action: 'unit.unassigned', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'unit', targetId: link.unitId, metadata: { assignmentId: link.assignmentId, reason: 'resident_archived' } },
            tx,
          );
        }
      }
      await this.audit.record(
        { action: 'resident.archived', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'resident', targetId: residentId, metadata: { unitsEnded: activeUnits.length } },
        tx,
      );
      return tx.resident.findUniqueOrThrow({ where: { id: residentId }, include: residentInclude });
    });
    return toResidentDto(resident);
  }

  async addUnit(societyId: string, actorUserId: string, residentId: string, input: AddResidentUnitInput): Promise<ResidentDto> {
    const [resident, unit] = await Promise.all([
      this.prisma.resident.findFirst({ where: { id: residentId, societyId } }),
      this.prisma.unit.findFirst({ where: { id: input.unitId, societyId }, select: { id: true, status: true } }),
    ]);
    if (!resident) throw Errors.notFound('Resident not found.');
    if (!unit) throw Errors.notFound('Unit not found.');
    if (unit.status !== 'ACTIVE') throw Errors.conflict('This unit is archived.');
    if (resident.status !== 'ACTIVE') throw Errors.conflict('This resident is inactive. Reactivate them before adding a unit.');

    const existing = await this.prisma.residentUnit.findFirst({ where: { residentId, unitId: input.unitId, endedAt: null }, select: { id: true } });
    if (existing) throw Errors.conflict('This resident is already associated with this unit.');

    const membership = resident.userId
      ? await this.prisma.membership.findFirst({
          where: { userId: resident.userId, societyId, role: 'RESIDENT', status: 'ACTIVE' },
          select: { id: true },
        })
      : null;

    await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) await this.clearPrimary(tx, societyId, input.unitId);
      let assignmentId: string | null = null;
      if (membership) {
        const assignment = await this.lifecycle.assignUnit(tx, {
          societyId,
          unitId: input.unitId,
          membershipId: membership.id,
          occupancy: input.relationship,
          actorUserId,
        });
        assignmentId = assignment.id;
      }
      const alreadyLinked = assignmentId
        ? await tx.residentUnit.findFirst({ where: { assignmentId }, select: { id: true } })
        : null;
      if (!alreadyLinked) {
        await tx.residentUnit.create({
          data: {
            societyId,
            residentId,
            unitId: input.unitId,
            relationship: input.relationship,
            isPrimary: input.isPrimary ?? false,
            assignmentId,
            createdById: actorUserId,
          },
        });
      }
      await this.audit.record(
        { action: 'resident.unit_linked', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'resident', targetId: residentId, metadata: { unitId: input.unitId, relationship: input.relationship } },
        tx,
      );
    });
    return toResidentDto(await this.detail(societyId, residentId));
  }

  async updateUnit(societyId: string, actorUserId: string, residentId: string, residentUnitId: string, input: UpdateResidentUnitInput): Promise<ResidentDto> {
    const link = await this.prisma.residentUnit.findFirst({ where: { id: residentUnitId, residentId, societyId, endedAt: null } });
    if (!link) throw Errors.notFound('Resident unit association not found.');
    await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) await this.clearPrimary(tx, societyId, link.unitId);
      await tx.residentUnit.update({
        where: { id: residentUnitId },
        data: {
          ...(input.relationship !== undefined && { relationship: input.relationship }),
          ...(input.isPrimary !== undefined && { isPrimary: input.isPrimary }),
        },
      });
      if (input.relationship !== undefined && link.assignmentId) {
        await tx.unitAssignment.updateMany({ where: { id: link.assignmentId, societyId }, data: { occupancy: input.relationship } });
      }
      await this.audit.record(
        { action: 'resident.unit_updated', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'resident', targetId: residentId, metadata: { residentUnitId, fields: Object.keys(input) } },
        tx,
      );
    });
    return toResidentDto(await this.detail(societyId, residentId));
  }

  async endUnit(societyId: string, actorUserId: string, residentId: string, residentUnitId: string): Promise<ResidentDto> {
    const link = await this.prisma.residentUnit.findFirst({ where: { id: residentUnitId, residentId, societyId, endedAt: null } });
    if (!link) throw Errors.notFound('Resident unit association not found.');
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.residentUnit.update({ where: { id: residentUnitId }, data: { endedAt: now } });
      if (link.assignmentId) {
        await tx.unitAssignment.updateMany({ where: { id: link.assignmentId, endedAt: null }, data: { endedAt: now, endedById: actorUserId } });
        await this.audit.record(
          { action: 'unit.unassigned', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'unit', targetId: link.unitId, metadata: { assignmentId: link.assignmentId } },
          tx,
        );
      }
      await this.audit.record(
        { action: 'resident.unit_unlinked', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'resident', targetId: residentId, metadata: { residentUnitId, unitId: link.unitId } },
        tx,
      );
    });
    return toResidentDto(await this.detail(societyId, residentId));
  }

  async myHousehold(societyId: string, userId: string): Promise<MyHouseholdDto> {
    const resident = await this.prisma.resident.findFirst({ where: { societyId, userId }, include: residentInclude });
    if (!resident) return { resident: null, units: [] };
    const active = resident.units.filter((u) => u.endedAt === null);
    const units: MyHouseholdDto['units'] = [];
    for (const link of active) {
      const others = await this.prisma.residentUnit.findMany({
        where: { societyId, unitId: link.unitId, endedAt: null, NOT: { residentId: resident.id } },
        include: { resident: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { startedAt: 'asc' },
      });
      const unit = await this.prisma.unit.findFirstOrThrow({ where: { id: link.unitId, societyId }, include: unitInclude });
      units.push({
        unit: toUnitDto(unit),
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        household: others.map((o) => toHouseholdMember(o.resident, o.relationship)),
      });
    }
    return { resident: toResidentDto(resident), units };
  }

  private async clearPrimary(tx: Tx, societyId: string, unitId: string) {
    await tx.residentUnit.updateMany({ where: { societyId, unitId, endedAt: null, isPrimary: true }, data: { isPrimary: false } });
  }

  /** Keeps the directory row in sync when an authenticated assignment is created. */
  syncAssignment(tx: Tx, assignmentId: string, actorUserId: string | null): Promise<void> {
    return syncResidentAssignment(tx, assignmentId, actorUserId);
  }

  /** Ends the directory link when an authenticated assignment ends. */
  endAssignment(tx: Tx, assignmentId: string): Promise<void> {
    return endResidentAssignment(tx, assignmentId);
  }

  async residentForUser(societyId: string, userId: string): Promise<Resident | null> {
    return this.prisma.resident.findFirst({ where: { societyId, userId } });
  }
}
