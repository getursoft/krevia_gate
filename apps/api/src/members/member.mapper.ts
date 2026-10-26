import type { AuditEvent, Building, Floor, Invitation, Membership, Prisma, Resident, ResidentUnit, Unit, UnitAssignment, User } from '@prisma/client';
import type { AuditEventDto, InvitationDto, MemberDto, UnitAssignmentDto, UnitDto } from '@krevia/shared';
import { maskPhone } from '../auth/user.mapper';

export const ACTIVE_ASSIGNMENT = { endedAt: null } as const;

export const memberInclude = {
  user: { select: { id: true, fullName: true, phone: true } },
  assignments: { where: ACTIVE_ASSIGNMENT, include: { unit: true }, orderBy: { assignedAt: 'asc' } },
} satisfies Prisma.MembershipInclude;

type MemberRow = Membership & {
  user: Pick<User, 'id' | 'fullName' | 'phone'>;
  assignments: (UnitAssignment & { unit: Unit })[];
};

export const toAssignmentDto = (a: UnitAssignment & { unit: Unit }): UnitAssignmentDto => ({
  id: a.id,
  unitId: a.unitId,
  tower: a.unit.tower,
  number: a.unit.number,
  occupancy: a.occupancy,
  assignedAt: a.assignedAt.toISOString(),
});

export const toMemberDto = (m: MemberRow): MemberDto => ({
  id: m.id,
  role: m.role,
  status: m.status,
  user: m.user,
  units: m.assignments.map(toAssignmentDto),
  createdAt: m.createdAt.toISOString(),
  statusChangedAt: m.statusChangedAt?.toISOString() ?? null,
});

export const unitInclude = {
  building: true,
  floor: true,
  assignments: {
    where: ACTIVE_ASSIGNMENT,
    include: {
      membership: { select: { id: true, user: { select: { fullName: true } } } },
      residentUnit: { include: { resident: { select: { id: true, fullName: true } } } },
    },
    orderBy: { assignedAt: 'asc' },
  },
  residentUnits: {
    where: { endedAt: null },
    include: { resident: { select: { id: true, fullName: true } } },
    orderBy: { startedAt: 'asc' },
  },
} satisfies Prisma.UnitInclude;

export type UnitRow = Unit & {
  building: Building;
  floor: Floor | null;
  assignments: (UnitAssignment & {
    membership: { id: string; user: { fullName: string } };
    residentUnit: (ResidentUnit & { resident: Pick<Resident, 'id' | 'fullName'> }) | null;
  })[];
  residentUnits: (ResidentUnit & { resident: Pick<Resident, 'id' | 'fullName'> })[];
};

export const toUnitDto = (u: UnitRow): UnitDto => {
  const residents: UnitDto['residents'] = [];
  const seen = new Set<string>();
  for (const a of u.assignments) {
    const residentId = a.residentUnit?.resident.id ?? a.id;
    if (seen.has(residentId)) continue;
    seen.add(residentId);
    residents.push({
      assignmentId: a.id,
      residentId,
      membershipId: a.membership.id,
      fullName: a.residentUnit?.resident.fullName ?? a.membership.user.fullName,
      occupancy: a.occupancy,
    });
  }
  for (const ru of u.residentUnits) {
    if (seen.has(ru.resident.id)) continue;
    seen.add(ru.resident.id);
    residents.push({
      assignmentId: ru.assignmentId,
      residentId: ru.resident.id,
      membershipId: null,
      fullName: ru.resident.fullName,
      occupancy: ru.relationship,
    });
  }
  return {
    id: u.id,
    societyId: u.societyId,
    tower: u.building.name,
    number: u.number,
    buildingId: u.buildingId,
    buildingName: u.building.name,
    floorId: u.floorId,
    floorLevel: u.floor?.level ?? null,
    floorName: u.floor?.name ?? null,
    status: u.status,
    occupancyStatus: residents.length > 0 ? 'OCCUPIED' : 'VACANT',
    archivedAt: u.archivedAt?.toISOString() ?? null,
    residents,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
};

export const toInvitationDto = (i: Invitation & { unit: Unit | null }): InvitationDto => ({
  id: i.id,
  societyId: i.societyId,
  phone: maskPhone(i.phone),
  role: i.role,
  unit: i.unit ? { id: i.unit.id, tower: i.unit.tower, number: i.unit.number } : null,
  occupancy: i.occupancy,
  // A PENDING invitation past its expiry is reported as EXPIRED even before it is swept.
  status: i.status === 'PENDING' && i.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : i.status,
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
  acceptedAt: i.acceptedAt?.toISOString() ?? null,
  revokedAt: i.revokedAt?.toISOString() ?? null,
});

export const toAuditDto = (e: AuditEvent, actors: Map<string, string>): AuditEventDto => ({
  id: e.id,
  createdAt: e.createdAt.toISOString(),
  action: e.action,
  outcome: e.outcome,
  actor: e.actorUserId ? { id: e.actorUserId, fullName: actors.get(e.actorUserId) ?? 'Deleted user' } : null,
  societyId: e.societyId,
  targetType: e.targetType,
  targetId: e.targetId,
  requestId: e.requestId,
  metadata: (e.metadata ?? {}) as Record<string, unknown>,
});

export const page = <T>(items: T[], pageNo: number, pageSize: number, total: number) => ({ items, page: pageNo, pageSize, total });
