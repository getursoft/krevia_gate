import { Inject, Injectable } from '@nestjs/common';
import type { ClientType, Session, User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionWithUser extends Session {
  user: User;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates a session and returns the raw token. Only the SHA-256 hash is persisted. */
  async create(userId: string, clientType: ClientType, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs);
    await this.prisma.session.create({
      data: {
        userId,
        clientType,
        tokenHash: hashToken(token),
        userAgent: userAgent?.slice(0, 255),
        expiresAt,
      },
    });
    return { token, expiresAt };
  }

  /** Resolves a raw token to an active (unexpired, unrevoked) session. */
  async resolve(token: string): Promise<SessionWithUser | null> {
    if (!token || token.length > 128) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    return session;
  }

  async revoke(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
