import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type AuditOutcome } from '@prisma/client';
import { redact } from '@krevia/shared';
import { LOGGER, type AppLogger } from '../common/logger';
import { requestStore } from '../common/request-context.middleware';
import { PrismaService } from '../prisma/prisma.service';

/** Stable action names. Keep in sync with docs/sprint-2/security-report.md. */
export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.password_reset.requested'
  | 'auth.password_reset.completed'
  | 'auth.password_reset.failed'
  | 'session.active_society.changed'
  | 'authz.denied'
  | 'society.created'
  | 'society.updated'
  | 'membership.request.created'
  | 'membership.request.approved'
  | 'membership.request.rejected'
  | 'membership.created'
  | 'membership.status_changed'
  | 'invitation.created'
  | 'invitation.accepted'
  | 'invitation.accept_failed'
  | 'invitation.revoked'
  | 'invitation.expired'
  | 'unit.created'
  | 'unit.updated'
  | 'unit.archived'
  | 'unit.restored'
  | 'unit.assigned'
  | 'unit.unassigned'
  | 'building.created'
  | 'building.updated'
  | 'building.archived'
  | 'floor.created'
  | 'floor.updated'
  | 'floor.deleted'
  | 'resident.created'
  | 'resident.updated'
  | 'resident.archived'
  | 'resident.unit_linked'
  | 'resident.unit_updated'
  | 'resident.unit_unlinked'
  | 'resident.import.previewed'
  | 'resident.import.completed'
  | 'resident.import.failed'
  | 'data.exported'
  | 'platform.admin_invited';

export interface AuditInput {
  action: AuditAction;
  outcome: AuditOutcome;
  /** Defaults to the authenticated user of the current request. */
  actorUserId?: string | null;
  societyId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Small, non-sensitive context. Passed through the shared redactor before storage. */
  metadata?: Record<string, unknown>;
}

type Db = PrismaService | Prisma.TransactionClient;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/**
 * Writes the append-only audit trail (`AuditEvent`). Every event carries the
 * request id of the current request. Passwords, codes and tokens are never
 * passed in; metadata is redacted as a second line of defence.
 */
@Injectable()
export class AuditService {
  private readonly windows = new Map<string, { count: number; resetAt: number; suppressed: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  /** Records an event. Pass `db` to write inside the caller's transaction. */
  async record(event: AuditInput, db: Db = this.prisma): Promise<void> {
    const store = requestStore.getStore();
    await db.auditEvent.create({
      data: {
        action: event.action,
        outcome: event.outcome,
        actorUserId: event.actorUserId === undefined ? (store?.userId ?? null) : event.actorUserId,
        societyId: event.societyId ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        requestId: store?.requestId ?? null,
        metadata: (redact(event.metadata ?? {}) ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * For failures and denials that an attacker can trigger at will: at most
   * MAX_PER_WINDOW events per key per minute reach the database; the rest are
   * counted and reported once on the log. Never throws, so the original
   * error response is not replaced by an audit failure.
   */
  async recordLimited(key: string, event: AuditInput): Promise<void> {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (w?.suppressed) {
        this.logger.emit('warn', 'Audit events suppressed by rate limit', { context: 'Audit', action: event.action, suppressed: w.suppressed });
      }
      w = { count: 0, resetAt: now + WINDOW_MS, suppressed: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.prune(now);
    }
    if (w.count >= MAX_PER_WINDOW) {
      w.suppressed += 1;
      return;
    }
    w.count += 1;
    try {
      await this.record(event);
    } catch (err) {
      this.logger.emit('error', 'Failed to write audit event', { context: 'Audit', action: event.action, error: (err as Error).message });
    }
  }

  private prune(now: number) {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
