import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  VISITOR_CATEGORY_LABEL,
  VISITOR_STATUS_LABEL,
  type CreateVisitorInput,
  type CreatedVisitorDto,
  type VisitorCancelInput,
  type VisitorDecisionInput,
  type VisitorDestinationDto,
  type VisitorDto,
  type VisitorOverrideInput,
  type VisitorSummaryDto,
} from '@krevia/shared';
import { AuditService } from '../audit/audit.service';
import { maskPhone } from '../auth/user.mapper';
import type { SocietyContext } from '../authz/society-access.service';
import { Errors } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { MESSAGE_SENDER, type MessageSender } from '../messaging/message-sender';
import { PrismaService } from '../prisma/prisma.service';
import { actorIds, toVisitorDto, visitorInclude, type VisitorRow } from './visitor.mapper';

type Tx = Prisma.TransactionClient;

const OPEN_STATUSES = ['PENDING', 'APPROVED'] as const;
const OVERRIDABLE_STATUSES = ['PENDING', 'APPROVED', 'TIMED_OUT'] as const;

/**
 * Visitor and gate workflow. One row carries the whole lifecycle; every
 * transition is a conditional update (`where: { status: expected }`), so
 * concurrent approvals or scans cannot both succeed. Every query is scoped by
 * the authorised society, and residents only see visitors for their own units.
 */
@Injectable()
export class VisitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  private isStaff(ctx: SocietyContext): boolean {
    return ctx.roles.includes('ADMIN') || ctx.roles.includes('GUARD');
  }

  /** null = whole society (admin/guard); otherwise the resident's active unit ids. */
  private async visibleUnitIds(ctx: SocietyContext, userId: string): Promise<string[] | null> {
    if (this.isStaff(ctx)) return null;
    const links = await this.prisma.residentUnit.findMany({
      where: { societyId: ctx.societyId, endedAt: null, resident: { userId, societyId: ctx.societyId, status: 'ACTIVE', archivedAt: null } },
      select: { unitId: true },
    });
    return [...new Set(links.map((l) => l.unitId))];
  }

  private async namesFor(rows: VisitorRow[]): Promise<Map<string, string>> {
    const ids = actorIds(rows);
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private async dto(visitor: VisitorRow, ctx: SocietyContext): Promise<VisitorDto> {
    const names = await this.namesFor([visitor]);
    return toVisitorDto(visitor, { revealPhone: this.isStaff(ctx), names });
  }

  /** Lazy timeout: any read or action first turns stale PENDING rows into TIMED_OUT. */
  async sweepExpired(societyId: string): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.visitor.findMany({
      where: { societyId, status: 'PENDING', approvalExpiresAt: { lte: now } },
      select: { id: true, unitId: true, category: true },
    });
    for (const row of expired) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.visitor.updateMany({
          where: { id: row.id, societyId, status: 'PENDING', approvalExpiresAt: { lte: now } },
          data: { status: 'TIMED_OUT', decidedAt: now },
        });
        if (!claimed.count) return;
        await this.audit.record(
          {
            action: 'visitor.timed_out',
            outcome: 'SUCCESS',
            actorUserId: null,
            societyId,
            targetType: 'visitor',
            targetId: row.id,
            metadata: { unitId: row.unitId, category: row.category, previousStatus: 'PENDING' },
          },
          tx,
        );
      });
    }
  }

  private async findVisible(societyId: string, ctx: SocietyContext, userId: string, visitorId: string): Promise<VisitorRow> {
    const visitor = await this.prisma.visitor.findFirst({ where: { id: visitorId, societyId }, include: visitorInclude });
    if (!visitor) throw Errors.notFound('Visitor request not found.');
    const units = await this.visibleUnitIds(ctx, userId);
    if (units && !units.includes(visitor.unitId)) throw Errors.notFound('Visitor request not found.');
    return visitor;
  }

  async list(
    ctx: SocietyContext,
    userId: string,
    filters: { dateFrom?: Date; dateTo?: Date; unitId?: string; category?: string; status?: string; q?: string; page: number; pageSize: number },
  ) {
    await this.sweepExpired(ctx.societyId);
    const units = await this.visibleUnitIds(ctx, userId);
    const where: Prisma.VisitorWhereInput = {
      societyId: ctx.societyId,
      ...(units && { unitId: { in: units } }),
      ...(filters.unitId && { unitId: filters.unitId }),
      ...(filters.category && { category: filters.category as Prisma.EnumVisitorCategoryFilter['equals'] }),
      ...(filters.status && { status: filters.status as Prisma.EnumVisitorStatusFilter['equals'] }),
      ...((filters.dateFrom || filters.dateTo) && {
        createdAt: { ...(filters.dateFrom && { gte: filters.dateFrom }), ...(filters.dateTo && { lte: filters.dateTo }) },
      }),
      ...(filters.q && {
        OR: [
          { name: { contains: filters.q, mode: 'insensitive' } },
          { phone: { contains: filters.q } },
          { purpose: { contains: filters.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.visitor.count({ where }),
      this.prisma.visitor.findMany({
        where,
        include: visitorInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    const names = await this.namesFor(rows);
    return {
      rows: rows.map((v) => toVisitorDto(v, { revealPhone: this.isStaff(ctx), names })),
      total,
    };
  }

  async summary(ctx: SocietyContext, userId: string): Promise<VisitorSummaryDto> {
    await this.sweepExpired(ctx.societyId);
    const units = await this.visibleUnitIds(ctx, userId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const base: Prisma.VisitorWhereInput = { societyId: ctx.societyId, ...(units && { unitId: { in: units } }) };
    const [todayTotal, pending, approved, entered, exited, timedOut, cancelled] = await Promise.all([
      this.prisma.visitor.count({ where: { ...base, createdAt: { gte: start } } }),
      this.prisma.visitor.count({ where: { ...base, status: 'PENDING' } }),
      this.prisma.visitor.count({ where: { ...base, status: 'APPROVED' } }),
      this.prisma.visitor.count({ where: { ...base, status: 'ENTERED' } }),
      this.prisma.visitor.count({ where: { ...base, status: 'EXITED', exitAt: { gte: start } } }),
      this.prisma.visitor.count({ where: { ...base, status: 'TIMED_OUT' } }),
      this.prisma.visitor.count({ where: { ...base, status: 'CANCELLED' } }),
    ]);
    return { todayTotal, pending, approved, entered, exited, timedOut, cancelled };
  }

  /** Minimal unit picker for the gate: no resident names or contact details. */
  async destinations(societyId: string, q?: string): Promise<VisitorDestinationDto[]> {
    const units = await this.prisma.unit.findMany({
      where: {
        societyId,
        status: 'ACTIVE',
        ...(q && {
          OR: [{ number: { contains: q.toUpperCase() } }, { building: { name: { contains: q, mode: 'insensitive' } } }],
        }),
      },
      select: { id: true, tower: true, number: true, building: { select: { name: true } } },
      orderBy: [{ building: { name: 'asc' } }, { number: 'asc' }],
      take: 200,
    });
    return units.map((u) => ({ id: u.id, tower: u.tower, number: u.number, buildingName: u.building.name }));
  }

  async detail(ctx: SocietyContext, userId: string, visitorId: string): Promise<VisitorDto> {
    await this.sweepExpired(ctx.societyId);
    return this.dto(await this.findVisible(ctx.societyId, ctx, userId, visitorId), ctx);
  }

  async create(ctx: SocietyContext, actorUserId: string, input: CreateVisitorInput): Promise<CreatedVisitorDto> {
    if (input.idempotencyKey) {
      const existing = await this.prisma.visitor.findFirst({
        where: { societyId: ctx.societyId, idempotencyKey: input.idempotencyKey },
        include: visitorInclude,
      });
      if (existing) {
        return {
          visitor: await this.dto(existing, ctx),
          created: false,
          notification: this.notificationSummary(existing),
        };
      }
    }

    const unit = await this.prisma.unit.findFirst({
      where: { id: input.unitId, societyId: ctx.societyId, status: 'ACTIVE' },
      select: { id: true, tower: true, number: true },
    });
    if (!unit) throw Errors.notFound('Unit not found.');

    const recipients = await this.recipients(ctx.societyId, unit.id);
    if (!recipients.some((r) => r.userId)) {
      throw Errors.validation(
        { unitId: 'No resident with an app account is linked to this flat.' },
        'This flat has no resident who can approve a visitor. Ask an administrator to link a resident first.',
      );
    }

    const since = new Date(Date.now() - this.config.visitorDuplicateWindowMs);
    const duplicate = await this.prisma.visitor.findFirst({
      where: {
        societyId: ctx.societyId,
        unitId: unit.id,
        category: input.category,
        status: { in: [...OPEN_STATUSES] },
        createdAt: { gte: since },
        ...(input.phone ? { phone: input.phone } : { name: input.name }),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw Errors.conflict('An identical visitor request is already open for this flat. Check the live queue before registering again.');
    }

    const approvalExpiresAt = new Date(Date.now() + this.config.visitorApprovalTtlMs);
    const created = await this.prisma.$transaction(async (tx) => {
      const visitor = await tx.visitor.create({
        data: {
          societyId: ctx.societyId,
          unitId: unit.id,
          name: input.name,
          phone: input.phone ?? null,
          category: input.category,
          purpose: input.purpose,
          approvalExpiresAt,
          idempotencyKey: input.idempotencyKey ?? null,
          createdById: actorUserId,
        },
      });
      await this.audit.record(
        {
          action: 'visitor.created',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitor.id,
          metadata: { unitId: unit.id, category: input.category, approvalExpiresAt: approvalExpiresAt.toISOString() },
        },
        tx,
      );
      return visitor;
    });

    const full = await this.prisma.visitor.findUniqueOrThrow({ where: { id: created.id }, include: visitorInclude });
    const notification = await this.notify(full, 'APPROVAL_REQUEST');
    return { visitor: await this.dto(full, ctx), created: true, notification };
  }

  async approve(ctx: SocietyContext, actorUserId: string, visitorId: string, input: VisitorDecisionInput): Promise<VisitorDto> {
    await this.sweepExpired(ctx.societyId);
    await this.findVisible(ctx.societyId, ctx, actorUserId, visitorId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.visitor.updateMany({
        where: { id: visitorId, societyId: ctx.societyId, status: 'PENDING', approvalExpiresAt: { gt: new Date() } },
        data: { status: 'APPROVED', decidedById: actorUserId, decidedAt: new Date(), decisionNote: input.note ?? null },
      });
      if (!claimed.count) throw await this.transitionConflict(tx, visitorId, ctx.societyId, 'approved');
      await this.audit.record(
        {
          action: 'visitor.approved',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitorId,
          metadata: { previousStatus: 'PENDING', hasNote: Boolean(input.note) },
        },
        tx,
      );
      return tx.visitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    });
    await this.notify(updated, 'DECISION');
    return this.dto(updated, ctx);
  }

  async reject(ctx: SocietyContext, actorUserId: string, visitorId: string, input: VisitorDecisionInput): Promise<VisitorDto> {
    await this.sweepExpired(ctx.societyId);
    await this.findVisible(ctx.societyId, ctx, actorUserId, visitorId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.visitor.updateMany({
        where: { id: visitorId, societyId: ctx.societyId, status: 'PENDING', approvalExpiresAt: { gt: new Date() } },
        data: { status: 'REJECTED', decidedById: actorUserId, decidedAt: new Date(), decisionNote: input.note ?? null },
      });
      if (!claimed.count) throw await this.transitionConflict(tx, visitorId, ctx.societyId, 'rejected');
      await this.audit.record(
        {
          action: 'visitor.rejected',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitorId,
          metadata: { previousStatus: 'PENDING', hasNote: Boolean(input.note) },
        },
        tx,
      );
      return tx.visitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    });
    await this.notify(updated, 'DECISION');
    return this.dto(updated, ctx);
  }

  async cancel(ctx: SocietyContext, actorUserId: string, visitorId: string, input: VisitorCancelInput): Promise<VisitorDto> {
    await this.sweepExpired(ctx.societyId);
    const existing = await this.prisma.visitor.findFirst({ where: { id: visitorId, societyId: ctx.societyId } });
    if (!existing) throw Errors.notFound('Visitor request not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.visitor.updateMany({
        where: { id: visitorId, societyId: ctx.societyId, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'CANCELLED', cancelledById: actorUserId, cancelledAt: new Date(), cancelReason: input.reason },
      });
      if (!claimed.count) throw await this.transitionConflict(tx, visitorId, ctx.societyId, 'cancelled');
      await this.audit.record(
        {
          action: 'visitor.cancelled',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitorId,
          metadata: { previousStatus: existing.status, reason: input.reason },
        },
        tx,
      );
      return tx.visitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    });
    await this.notify(updated, 'STATUS_CHANGE');
    return this.dto(updated, ctx);
  }

  async entry(ctx: SocietyContext, actorUserId: string, visitorId: string): Promise<VisitorDto> {
    await this.sweepExpired(ctx.societyId);
    const existing = await this.prisma.visitor.findFirst({ where: { id: visitorId, societyId: ctx.societyId } });
    if (!existing) throw Errors.notFound('Visitor request not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.visitor.updateMany({
        where: { id: visitorId, societyId: ctx.societyId, status: 'APPROVED' },
        data: { status: 'ENTERED', entryAt: new Date(), entryById: actorUserId, entryMethod: 'MANUAL' },
      });
      if (!claimed.count) throw await this.transitionConflict(tx, visitorId, ctx.societyId, 'entered');
      await this.audit.record(
        {
          action: 'visitor.entered',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitorId,
          metadata: { method: 'MANUAL', previousStatus: existing.status },
        },
        tx,
      );
      return tx.visitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    });
    await this.notify(updated, 'STATUS_CHANGE');
    return this.dto(updated, ctx);
  }

  async exit(ctx: SocietyContext, actorUserId: string, visitorId: string): Promise<VisitorDto> {
    const existing = await this.prisma.visitor.findFirst({ where: { id: visitorId, societyId: ctx.societyId } });
    if (!existing) throw Errors.notFound('Visitor request not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.visitor.updateMany({
        where: { id: visitorId, societyId: ctx.societyId, status: 'ENTERED' },
        data: { status: 'EXITED', exitAt: new Date(), exitById: actorUserId },
      });
      if (!claimed.count) throw await this.transitionConflict(tx, visitorId, ctx.societyId, 'exited');
      await this.audit.record(
        {
          action: 'visitor.exited',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitorId,
          metadata: { previousStatus: 'ENTERED' },
        },
        tx,
      );
      return tx.visitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    });
    await this.notify(updated, 'STATUS_CHANGE');
    return this.dto(updated, ctx);
  }

  /** Emergency admission without a resident decision. Admin-only, reason required. */
  async override(ctx: SocietyContext, actorUserId: string, visitorId: string, input: VisitorOverrideInput): Promise<VisitorDto> {
    await this.sweepExpired(ctx.societyId);
    const existing = await this.prisma.visitor.findFirst({ where: { id: visitorId, societyId: ctx.societyId } });
    if (!existing) throw Errors.notFound('Visitor request not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.visitor.updateMany({
        where: { id: visitorId, societyId: ctx.societyId, status: { in: [...OVERRIDABLE_STATUSES] } },
        data: {
          status: 'ENTERED',
          entryAt: new Date(),
          entryById: actorUserId,
          entryMethod: 'OVERRIDE',
          overrideReason: input.reason,
          overriddenById: actorUserId,
          overriddenAt: new Date(),
        },
      });
      if (!claimed.count) throw await this.transitionConflict(tx, visitorId, ctx.societyId, 'overridden');
      await this.audit.record(
        {
          action: 'visitor.overridden',
          outcome: 'SUCCESS',
          actorUserId,
          societyId: ctx.societyId,
          targetType: 'visitor',
          targetId: visitorId,
          metadata: { previousStatus: existing.status, reason: input.reason },
        },
        tx,
      );
      return tx.visitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    });
    await this.notify(updated, 'STATUS_CHANGE');
    return this.dto(updated, ctx);
  }

  private async transitionConflict(tx: Tx, visitorId: string, societyId: string, attempted: string) {
    const current = await tx.visitor.findFirst({ where: { id: visitorId, societyId }, select: { status: true } });
    const status = current?.status;
    if (status === 'PENDING') return Errors.conflict('This request is still pending a resident decision.');
    if (status === 'APPROVED' && attempted === 'approved') return Errors.conflict('This request has already been approved.');
    if (status === 'ENTERED' && attempted === 'entered') return Errors.conflict('Entry has already been recorded for this visitor.');
    if (status === 'EXITED' && attempted === 'exited') return Errors.conflict('Exit has already been recorded for this visitor.');
    if (status === 'TIMED_OUT') return Errors.conflict('This request has timed out and can no longer be decided.');
    return Errors.conflict(
      status ? `This request is ${VISITOR_STATUS_LABEL[status].toLowerCase()} and cannot be ${attempted}.` : 'This request cannot be updated.',
    );
  }

  private notificationSummary(visitor: VisitorRow): CreatedVisitorDto['notification'] {
    const rows = visitor.notifications;
    return {
      delivered: rows.length > 0 && rows.every((n) => n.delivered),
      channel: rows[0]?.channel ?? this.sender.name,
      recipients: rows.length,
    };
  }

  private async recipients(societyId: string, unitId: string) {
    const links = await this.prisma.residentUnit.findMany({
      where: {
        societyId,
        unitId,
        endedAt: null,
        resident: { societyId, status: 'ACTIVE', archivedAt: null },
      },
      include: { resident: { select: { id: true, userId: true, fullName: true, phone: true } } },
    });
    const seen = new Set<string>();
    return links
      .map((l) => l.resident)
      .filter((r) => {
        if (!r.userId || seen.has(r.userId)) return false;
        seen.add(r.userId);
        return true;
      });
  }

  /**
   * Records one delivery attempt per resident with an account. In-app delivery
   * is the pending list itself; SMS/email success is reported honestly by the
   * configured sender. A missing provider never blocks the workflow.
   */
  private async notify(visitor: VisitorRow, kind: 'APPROVAL_REQUEST' | 'DECISION' | 'STATUS_CHANGE') {
    const people = await this.recipients(visitor.societyId, visitor.unitId);
    if (people.length === 0) return { delivered: false, channel: this.sender.name, recipients: 0 };

    const body =
      kind === 'APPROVAL_REQUEST'
        ? `${visitor.name} (${VISITOR_CATEGORY_LABEL[visitor.category]}) is at the gate for ${visitor.unit.tower}-${visitor.unit.number}. Purpose: ${visitor.purpose}. Open Krevia to approve or reject.`
        : `Visitor ${visitor.name} for ${visitor.unit.tower}-${visitor.unit.number} is now ${VISITOR_STATUS_LABEL[visitor.status].toLowerCase()}.`;

    let allDelivered = true;
    for (const person of people) {
      let delivered = true;
      let channel = 'in-app';
      if (person.phone) {
        channel = this.sender.name;
        try {
          delivered = await this.sender.send({ to: person.phone, kind: 'visitor', body });
        } catch {
          delivered = false;
        }
      }
      allDelivered = allDelivered && delivered;
      await this.prisma.visitorNotification.create({
        data: {
          societyId: visitor.societyId,
          visitorId: visitor.id,
          recipientUserId: person.userId,
          recipientPhone: person.phone ? maskPhone(person.phone) : null,
          kind,
          channel,
          delivered,
        },
      });
    }
    return { delivered: allDelivered, channel: this.sender.name, recipients: people.length };
  }
}
