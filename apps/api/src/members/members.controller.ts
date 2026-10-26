import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { memberListSchema, setActiveSocietySchema, updateMemberStatusSchema, type MeDto } from '@krevia/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentSession } from '../auth/auth.guard';
import { SessionService, type SessionWithUser } from '../auth/session.service';
import { toUserDto } from '../auth/user.mapper';
import { CurrentSociety, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { memberInclude, page, toMemberDto } from './member.mapper';
import { MembershipLifecycleService } from './membership-lifecycle.service';

/** Spreadsheet apps execute cells starting with these characters; prefix them. */
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const EXPORT_LIMIT = 5000;

@ApiTags('members')
@Controller()
export class MembersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MembershipLifecycleService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get('societies/:societyId/members')
  @RequireSocietyPermission('membership.read')
  @ApiOperation({ summary: 'Members of a society (administrators). Filter by role, status or name/phone.' })
  async list(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const { page: pageNo, pageSize, role, status, q } = validate(memberListSchema, query);
    const where = this.where(ctx.societyId, { role, status, q });
    const [total, rows] = await Promise.all([
      this.prisma.membership.count({ where }),
      this.prisma.membership.findMany({
        where,
        include: memberInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return page(rows.map(toMemberDto), pageNo, pageSize, total);
  }

  @Patch('societies/:societyId/members/:membershipId')
  @RequireSocietyPermission('membership.manage')
  @ApiOperation({ summary: 'Suspend, reactivate or revoke a membership. Roles cannot be changed here.' })
  @ApiBody({ schema: jsonSchema(updateMemberStatusSchema) })
  async updateStatus(
    @CurrentSession() session: SessionWithUser,
    @CurrentSociety() ctx: SocietyContext,
    @Param('membershipId') id: string,
    @Body() body: unknown,
  ) {
    const membershipId = validateId(id, 'membershipId');
    const input = validate(updateMemberStatusSchema, body);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Tenant-scoped lookup: a membership of another society is "not found".
      const membership = await tx.membership.findFirst({ where: { id: membershipId, societyId: ctx.societyId } });
      if (!membership) throw Errors.notFound('Member not found.');
      if (membership.userId === session.userId) throw Errors.forbidden('You cannot change your own membership.');
      return this.lifecycle.changeStatus(tx, membership, input.status, { actorUserId: session.userId, reason: input.reason });
    });
    const member = await this.prisma.membership.findUniqueOrThrow({ where: { id: updated.id }, include: memberInclude });
    return { member: toMemberDto(member) };
  }

  @Get('societies/:societyId/members/export')
  @RequireSocietyPermission('data.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="krevia-members.csv"')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'CSV export of the society roster (administrators). Audited.' })
  async export(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const { role, status, q } = validate(memberListSchema, query);
    const rows = await this.prisma.membership.findMany({
      where: this.where(ctx.societyId, { role, status, q }),
      include: memberInclude,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_LIMIT,
    });
    await this.audit.record({
      action: 'data.exported',
      outcome: 'SUCCESS',
      societyId: ctx.societyId,
      targetType: 'members',
      metadata: { rows: rows.length, filters: { role, status, q: q ? 'set' : undefined } },
    });
    const lines = [
      ['Name', 'Phone', 'Role', 'Status', 'Units', 'Member since'].join(','),
      ...rows.map((m) =>
        [
          m.user.fullName,
          m.user.phone,
          m.role,
          m.status,
          m.assignments.map((a) => `${a.unit.tower}-${a.unit.number} (${a.occupancy})`).join('; '),
          m.createdAt.toISOString().slice(0, 10),
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    return `${lines.join('\n')}\n`;
  }

  @Get('me/memberships')
  @ApiOperation({ summary: 'All my memberships across societies, with status' })
  async mine(@CurrentSession() session: SessionWithUser) {
    const user = await toUserDto(this.prisma, session.user);
    return { items: user.memberships };
  }

  @Post('me/active-society')
  @HttpCode(200)
  @ApiOperation({ summary: 'Choose the active society for this session. Requires an ACTIVE membership there.' })
  @ApiBody({ schema: jsonSchema(setActiveSocietySchema) })
  async setActive(@CurrentSession() session: SessionWithUser, @Body() body: unknown): Promise<MeDto> {
    const { societyId } = validate(setActiveSocietySchema, body);
    const active = await this.prisma.membership.findFirst({
      where: { userId: session.userId, societyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!active) {
      await this.audit.recordLimited(`denied:${session.userId}`, {
        action: 'authz.denied',
        outcome: 'DENIED',
        societyId,
        metadata: { permission: 'session.active_society', route: '/api/v1/me/active-society' },
      });
      throw Errors.forbidden('You are not an active member of that society.');
    }
    await this.sessions.setActiveSociety(session.id, societyId);
    await this.audit.record({ action: 'session.active_society.changed', outcome: 'SUCCESS', societyId });
    return { user: await toUserDto(this.prisma, session.user), activeSocietyId: societyId };
  }

  private where(societyId: string, f: { role?: string; status?: string; q?: string }): Prisma.MembershipWhereInput {
    return {
      societyId,
      ...(f.role && { role: f.role as Prisma.MembershipWhereInput['role'] }),
      ...(f.status && { status: f.status as Prisma.MembershipWhereInput['status'] }),
      ...(f.q && {
        user: {
          OR: [
            { fullName: { contains: f.q, mode: 'insensitive' as const } },
            { phone: { contains: f.q.replace(/\D/g, '') || f.q } },
          ],
        },
      }),
    };
  }
}
