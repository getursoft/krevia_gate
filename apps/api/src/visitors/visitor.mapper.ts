import type { Building, Prisma, Unit, Visitor, VisitorNotification } from '@prisma/client';
import type { VisitorDto } from '@krevia/shared';
import { maskPhone } from '../auth/user.mapper';

export const visitorInclude = {
  unit: { include: { building: true } },
  notifications: { orderBy: { createdAt: 'desc' }, take: 20 },
} satisfies Prisma.VisitorInclude;

export type VisitorRow = Visitor & {
  unit: Unit & { building: Building };
  notifications: VisitorNotification[];
};

export type VisitorActor = { id: string; fullName: string };

const actor = (id: string | null, names: Map<string, string>): VisitorActor | null =>
  id ? { id, fullName: names.get(id) ?? 'Unknown user' } : null;

export function toVisitorDto(v: VisitorRow, opts: { revealPhone: boolean; names: Map<string, string> }): VisitorDto {
  return {
    id: v.id,
    societyId: v.societyId,
    unit: { id: v.unit.id, tower: v.unit.tower, number: v.unit.number, buildingName: v.unit.building.name },
    name: v.name,
    phone: v.phone ? (opts.revealPhone ? v.phone : maskPhone(v.phone)) : null,
    category: v.category,
    purpose: v.purpose,
    status: v.status,
    approvalExpiresAt: v.approvalExpiresAt.toISOString(),
    createdBy: actor(v.createdById, opts.names),
    decidedBy: actor(v.decidedById, opts.names),
    decidedAt: v.decidedAt?.toISOString() ?? null,
    decisionNote: v.decisionNote,
    cancelledBy: actor(v.cancelledById, opts.names),
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    cancelReason: v.cancelReason,
    entryAt: v.entryAt?.toISOString() ?? null,
    entryBy: actor(v.entryById, opts.names),
    entryMethod: v.entryMethod,
    exitAt: v.exitAt?.toISOString() ?? null,
    exitBy: actor(v.exitById, opts.names),
    overrideReason: v.overrideReason,
    overriddenBy: actor(v.overriddenById, opts.names),
    overriddenAt: v.overriddenAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    notifications: v.notifications.map((n) => ({
      kind: n.kind,
      channel: n.channel,
      delivered: n.delivered,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

/** All actor ids on a row, so the service can resolve names in one query. */
export function actorIds(rows: VisitorRow[]): string[] {
  const ids = new Set<string>();
  for (const v of rows) {
    for (const id of [v.createdById, v.decidedById, v.cancelledById, v.entryById, v.exitById, v.overriddenById]) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
