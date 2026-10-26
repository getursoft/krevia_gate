import { Injectable } from '@nestjs/common';
import type { MemberRole, User } from '@prisma/client';
import {
  PLATFORM_ROLE_PERMISSIONS,
  societyPermissionsFor,
  type PlatformPermission,
  type SocietyPermission,
} from '@krevia/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/** What the current user may do in one society, resolved from the database for this request. */
export interface SocietyContext {
  societyId: string;
  roles: MemberRole[];
  permissions: Set<SocietyPermission>;
}

const DENIED_MESSAGE: Partial<Record<SocietyPermission, string>> = {
  'membership.review': 'Only administrators of this society can do this.',
  'membership.read': 'Only administrators of this society can do this.',
  'society.read': 'Only verified residents of this society can view this.',
};

/**
 * The single authorisation point for society-owned data (tenant isolation).
 *
 * 1. Identity comes from the server-validated session (AuthGuard), never from
 *    the request body, query or a client-side claim.
 * 2. Roles come from ACTIVE Membership rows for (user, society), read from
 *    the database on every request, so suspension or revocation applies
 *    immediately.
 * 3. Permissions come from the central matrix (packages/shared/src/permissions.ts).
 * 4. Denials are audited (rate-limited) and answered with 403 before any
 *    society data is read. Resources inside the society are then loaded with
 *    tenant-scoped queries (`where: { id, societyId }`) by the callers.
 *
 * Platform administrators get platform permissions only; they have no implicit
 * society access.
 */
@Injectable()
export class SocietyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async context(userId: string, societyId: string): Promise<SocietyContext> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, societyId, status: 'ACTIVE' },
      select: { role: true },
    });
    const roles = memberships.map((m) => m.role);
    return { societyId, roles, permissions: societyPermissionsFor(roles) };
  }

  /** Throws 403 (and audits the attempt) unless the user holds `permission` in the society. */
  async authorize(user: User, societyId: string, permission: SocietyPermission, route?: string): Promise<SocietyContext> {
    const ctx = await this.context(user.id, societyId);
    if (!ctx.permissions.has(permission)) {
      await this.audit.recordLimited(`denied:${user.id}`, {
        action: 'authz.denied',
        outcome: 'DENIED',
        actorUserId: user.id,
        societyId,
        metadata: { permission, roles: ctx.roles, ...(route && { route }) },
      });
      throw Errors.forbidden(DENIED_MESSAGE[permission] ?? 'You do not have permission to do this in this society.');
    }
    return ctx;
  }

  hasPlatform(user: User, permission: PlatformPermission): boolean {
    return PLATFORM_ROLE_PERMISSIONS[user.platformRole].includes(permission);
  }

  async authorizePlatform(user: User, permission: PlatformPermission, route?: string): Promise<void> {
    if (this.hasPlatform(user, permission)) return;
    await this.audit.recordLimited(`denied:${user.id}`, {
      action: 'authz.denied',
      outcome: 'DENIED',
      actorUserId: user.id,
      metadata: { permission, scope: 'platform', ...(route && { route }) },
    });
    throw Errors.forbidden('This action is limited to Krevia platform administrators.');
  }
}
