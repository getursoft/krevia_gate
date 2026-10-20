import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { societySearchSchema } from '@krevia/shared';
import { Prisma } from '@prisma/client';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { Errors } from '../common/errors';
import { validate, validateId } from '../common/validate';
import { MembershipAccessService } from '../memberships/membership-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { toSocietyDetail, toSocietySummary } from './society.mapper';

@ApiTags('societies')
@Controller('societies')
export class SocietiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MembershipAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search societies by name, city or pincode' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async search(@Query() query: unknown) {
    const { q, limit } = validate(societySearchSchema, query);
    const where: Prisma.SocietyWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { addressLine: { contains: q, mode: 'insensitive' } },
            ...(/^\d{3,6}$/.test(q) ? [{ pincode: { startsWith: q } }] : []),
          ],
        }
      : {};
    const societies = await this.prisma.society.findMany({
      where,
      orderBy: [{ name: 'asc' }, { city: 'asc' }],
      take: limit,
    });
    return { items: societies.map(toSocietySummary) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Society details (public directory information only)' })
  async detail(@Param('id') id: string) {
    const society = await this.prisma.society.findUnique({ where: { id: validateId(id) } });
    if (!society) throw Errors.notFound('Society not found.');
    return { society: toSocietyDetail(society) };
  }

  @Get(':id/overview')
  @ApiOperation({ summary: 'Member-only society overview. Requires APPROVED membership or society admin role.' })
  async overview(@CurrentSession() session: SessionWithUser, @Param('id') id: string) {
    const societyId = validateId(id);
    const role = await this.access.requireMemberOrAdmin(session.user, societyId);
    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId } });
    const isAdmin = role === 'ADMIN';
    const [approvedMembers, pendingRequests, totalUnits] = await Promise.all([
      this.prisma.membershipRequest.count({ where: { societyId, status: 'APPROVED' } }),
      isAdmin ? this.prisma.membershipRequest.count({ where: { societyId, status: 'PENDING' } }) : null,
      isAdmin ? this.prisma.unit.count({ where: { societyId } }) : null,
    ]);
    return {
      society: toSocietyDetail(society),
      approvedMembers,
      ...(pendingRequests !== null && { pendingRequests }),
      ...(totalUnits !== null && { totalUnits }),
    };
  }
}
