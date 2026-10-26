import { Inject, Injectable } from '@nestjs/common';
import { BRAND } from '@krevia/shared';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { MESSAGE_SENDER, type MessageSender } from '../messaging/message-sender';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password';
import { SessionService } from './session.service';

export const RESET_MAX_ATTEMPTS = 5;
export const RESET_RESEND_COOLDOWN_MS = 60_000;
export const RESET_MAX_PER_HOUR = 5;

/** Same message whether or not the number is registered. */
export const RESET_REQUESTED_MESSAGE = 'If an account exists for this number, we have sent a 6-digit code to it.';
const INVALID_CODE = 'The code is invalid or has expired. Request a new code and try again.';

/**
 * Password reset with a 6-digit one-time code delivered by MESSAGE_SENDER.
 *
 * - Codes are stored as HMAC-SHA256(AUTH_PEPPER, userId:code), never in clear.
 * - Expire after RESET_CODE_TTL_MINUTES, single use, RESET_MAX_ATTEMPTS
 *   guesses per code, a 60 s resend cooldown and RESET_MAX_PER_HOUR codes per
 *   hour; requesting a new code invalidates the previous one.
 * - Responses never reveal whether a number is registered.
 * - A successful reset revokes every session of the account.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async request(phone: string, clientKey: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (!user) {
      await this.audit.recordLimited(`reset:${clientKey}`, {
        action: 'auth.password_reset.requested',
        outcome: 'FAILURE',
        actorUserId: null,
        metadata: { reason: 'unknown_account' },
      });
      return;
    }
    const now = Date.now();
    const recent = await this.prisma.passwordResetCode.findMany({
      where: { userId: user.id, createdAt: { gt: new Date(now - 3600_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const reason =
      recent[0] && now - recent[0].createdAt.getTime() < RESET_RESEND_COOLDOWN_MS
        ? 'cooldown'
        : recent.length >= RESET_MAX_PER_HOUR
          ? 'hourly_limit'
          : null;
    if (reason) {
      await this.audit.recordLimited(`reset:${user.id}`, {
        action: 'auth.password_reset.requested',
        outcome: 'FAILURE',
        actorUserId: null,
        targetType: 'user',
        targetId: user.id,
        metadata: { reason },
      });
      return;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.$transaction([
      // Only the newest code is usable.
      this.prisma.passwordResetCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.passwordResetCode.create({
        data: { userId: user.id, codeHash: this.hash(user.id, code), expiresAt: new Date(now + this.config.resetCodeTtlMs) },
      }),
    ]);
    const minutes = Math.round(this.config.resetCodeTtlMs / 60_000);
    const delivered = await this.sender.send({
      to: phone,
      kind: 'password_reset',
      body: `${code} is your ${BRAND.name} password reset code. It expires in ${minutes} minutes. Never share it with anyone.`,
    });
    await this.audit.record({
      action: 'auth.password_reset.requested',
      outcome: 'SUCCESS',
      actorUserId: null,
      targetType: 'user',
      targetId: user.id,
      metadata: { delivered, channel: this.sender.name },
    });
  }

  async confirm(phone: string, code: string, newPassword: string, clientKey: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    const record = user
      ? await this.prisma.passwordResetCode.findFirst({
          where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const fail = async (reason: string) => {
      await this.audit.recordLimited(`reset-confirm:${user?.id ?? clientKey}`, {
        action: 'auth.password_reset.failed',
        outcome: 'FAILURE',
        actorUserId: null,
        ...(user && { targetType: 'user', targetId: user.id }),
        metadata: { reason },
      });
      return Errors.validation({ code: INVALID_CODE }, INVALID_CODE);
    };
    if (!user || !record) throw await fail(user ? 'no_active_code' : 'unknown_account');

    // Count the attempt first (atomically), so parallel guesses cannot exceed the limit.
    const counted = await this.prisma.passwordResetCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: RESET_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw await fail('too_many_attempts');

    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = Buffer.from(this.hash(user.id, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw await fail('wrong_code');

    const passwordHash = await hashPassword(newPassword);
    const revoked = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetCode.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count === 0) return null;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
      const count = await this.sessions.revokeAllForUser(user.id, tx);
      await this.audit.record(
        {
          action: 'auth.password_reset.completed',
          outcome: 'SUCCESS',
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          metadata: { revokedLogins: count },
        },
        tx,
      );
      return count;
    });
    if (revoked === null) throw await fail('already_used');
  }

  private hash(userId: string, code: string): string {
    return createHmac('sha256', this.config.authPepper).update(`${userId}:${code}`).digest('hex');
  }
}
