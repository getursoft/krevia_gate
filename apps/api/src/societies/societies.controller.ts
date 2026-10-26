import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createSocietySchema, societySearchSchema, updateSocietySchema } from '@krevia/shared';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CurrentSociety, RequirePlatformPermission, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { toSocietyDetail, toSocietySummary } from './society.mapper';

const slugify = (name: string, city: string) =>
  `${`${name}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)}-${randomBytes(3).toString('hex')}`;

@ApiTags('societies')
@Controller('societies')
export class SocietiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search societies by name, city or pincode (public directory information only)' })
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

  @Post()
  @RequirePlatformPermission('society.create')
  @ApiOperation({ summary: 'Create a society (platform administrators only). Invite its first admin separately.' })
  @ApiBody({ schema: jsonSchema(createSocietySchema) })
  async create(@Body() body: unknown) {
    const input = validate(createSocietySchema, body);
    const society = await this.prisma.$transaction(async (tx) => {
      const created = await tx.society.create({ data: { ...input, slug: slugify(input.name, input.city) } });
      await this.audit.record(
        { action: 'society.created', outcome: 'SUCCESS', societyId: created.id, targetType: 'society', targetId: created.id, metadata: { name: created.name } },
        tx,
      );
      return created;
    });
    return { society: toSocietyDetail(society) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Society details (public directory information only)' })
  async detail(@Param('id') id: string) {
    const society = await this.prisma.society.findUnique({ where: { id: validateId(id) } });
    if (!society) throw Errors.notFound('Society not found.');
    return { society: toSocietyDetail(society) };
  }

  @Patch(':societyId')
  @RequireSocietyPermission('society.update')
  @ApiOperation({ summary: 'Update society details (society administrators). Towers that still have units cannot be removed.' })
  @ApiBody({ schema: jsonSchema(updateSocietySchema) })
  async update(@CurrentSociety() ctx: SocietyContext, @Body() body: unknown) {
    const input = validate(updateSocietySchema, body);
    const society = await this.prisma.$transaction(async (tx) => {
      const current = await tx.society.findUniqueOrThrow({ where: { id: ctx.societyId } });
      if (input.towers) {
        const kept = new Set(input.towers.map((t) => t.toLowerCase()));
        const removed = current.towers.filter((t) => !kept.has(t.toLowerCase()));
        if (removed.length) {
          const inUse = await tx.unit.findFirst({ where: { societyId: ctx.societyId, tower: { in: removed } }, select: { tower: true } });
          if (inUse) throw Errors.validation({ towers: `Tower "${inUse.tower}" still has units and cannot be removed.` });
        }
      }
      const updated = await tx.society.update({ where: { id: ctx.societyId }, data: input });
      await this.audit.record(
        { action: 'society.updated', outcome: 'SUCCESS', societyId: ctx.societyId, targetType: 'society', targetId: ctx.societyId, metadata: { fields: Object.keys(input) } },
        tx,
      );
      return updated;
    });
    return { society: toSocietyDetail(society) };
  }

  @Get(':id/overview')
  @RequireSocietyPermission('society.read', 'id')
  @ApiOperation({ summary: 'Member-only society overview. Requires an ACTIVE resident or administrator membership.' })
  async overview(@CurrentSociety() ctx: SocietyContext) {
    const { societyId } = ctx;
    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId } });
    const isAdmin = ctx.permissions.has('membership.review');
    const [approvedMembers, pendingRequests, totalUnits] = await Promise.all([
      this.prisma.membership.count({ where: { societyId, role: 'RESIDENT', status: 'ACTIVE' } }),
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
