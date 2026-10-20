import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Server-side society isolation. Every society-scoped read/write of private data
 * must go through one of these checks; the frontend is never trusted to filter.
 */
@Injectable()
export class MembershipAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async isSocietyAdmin(user: User, societyId: string): Promise<boolean> {
    if (user.platformRole === 'PLATFORM_ADMIN') return true;
    const role = await this.prisma.societyRole.findUnique({
      where: { userId_societyId: { userId: user.id, societyId } },
    });
    return role?.role === 'ADMIN';
  }

  async requireSocietyAdmin(user: User, societyId: string): Promise<void> {
    if (!(await this.isSocietyAdmin(user, societyId))) {
      throw Errors.forbidden('Only administrators of this society can do this.');
    }
  }

  /** APPROVED residents and admins only. A PENDING request grants nothing. */
  async requireMemberOrAdmin(user: User, societyId: string): Promise<'ADMIN' | 'MEMBER'> {
    if (await this.isSocietyAdmin(user, societyId)) return 'ADMIN';
    const approved = await this.prisma.membershipRequest.findFirst({
      where: { userId: user.id, societyId, status: 'APPROVED' },
      select: { id: true },
    });
    if (!approved) throw Errors.forbidden('Only verified residents of this society can view this.');
    return 'MEMBER';
  }
}
