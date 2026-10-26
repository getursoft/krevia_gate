import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditListSchema } from '@krevia/shared';
import type { Prisma } from '@prisma/client';
import { CurrentSociety, RequirePlatformPermission, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { validate } from '../common/validate';
import { page, toAuditDto } from '../members/member.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toSocietySummary } from '../societies/society.mapper';

/**
 * Read-only access to the audit trail. There are deliberately no endpoints
 * that change or delete events, and the database rejects UPDATE/DELETE.
 */
@ApiTags('audit')
@Controller()
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('societies/:societyId/audit-events')
  @RequireSocietyPermission('audit.read')
  @ApiOperation({ summary: 'Audit events of this society (administrators, read-only)' })
  async societyEvents(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    return this.list({ societyId: ctx.societyId }, query);
  }

  @Get('platform/audit-events')
  @RequirePlatformPermission('platform.audit.read')
  @ApiOperation({ summary: 'Platform-wide audit events (platform administrators, read-only)' })
  async platformEvents(@Query() query: unknown) {
    return this.list({}, query);
  }

  @Get('platform/societies')
  @RequirePlatformPermission('platform.society.read')
  @ApiOperation({ summary: 'All societies with member counts (platform administrators). No resident data.' })
  async platformSocieties() {
    const societies = await this.prisma.society.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { units: true, memberships: { where: { status: 'ACTIVE' } } } } },
    });
    return {
      items: societies.map((s) => ({ ...toSocietySummary(s), units: s._count.units, activeMembers: s._count.memberships })),
    };
  }

  private async list(scope: Prisma.AuditEventWhereInput, query: unknown) {
    const { page: pageNo, pageSize, action, outcome } = validate(auditListSchema, query);
    const where: Prisma.AuditEventWhereInput = { ...scope, ...(action && { action }), ...(outcome && { outcome }) };
    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (pageNo - 1) * pageSize, take: pageSize }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((id): id is string => Boolean(id)))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    return page(rows.map((r) => toAuditDto(r, names)), pageNo, pageSize, total);
  }
}
