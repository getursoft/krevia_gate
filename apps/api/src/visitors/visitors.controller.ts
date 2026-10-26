import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createVisitorSchema,
  visitorCancelSchema,
  visitorDecisionSchema,
  visitorDestinationListSchema,
  visitorListSchema,
  visitorOverrideSchema,
} from '@krevia/shared';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { CurrentSociety, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { page } from '../members/member.mapper';
import { VisitorsService } from './visitors.service';

/**
 * Visitor and gate workflow. The guard registers and scans, the resident of the
 * destination unit approves or rejects, and the same row records entry and exit.
 */
@ApiTags('visitors')
@Controller('societies/:societyId')
export class VisitorsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Get('visitors/summary')
  @RequireSocietyPermission('visitor.read')
  @ApiOperation({ summary: 'Today and current visitor counts (staff, or a resident\'s own units)' })
  async summary(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext) {
    return this.visitors.summary(ctx, session.userId);
  }

  @Get('visitors/destinations')
  @RequireSocietyPermission('visitor.create')
  @ApiOperation({ summary: 'Minimal active-unit picker for the gate (no resident details)' })
  async destinations(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const { q } = validate(visitorDestinationListSchema, query);
    return { items: await this.visitors.destinations(ctx.societyId, q) };
  }

  @Get('visitors')
  @RequireSocietyPermission('visitor.read')
  @ApiOperation({ summary: 'Visitor register with date, unit, category and status filters' })
  async list(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const filters = validate(visitorListSchema, query);
    const result = await this.visitors.list(ctx, session.userId, filters);
    return page(result.rows, filters.page, filters.pageSize, result.total);
  }

  @Post('visitors')
  @RequireSocietyPermission('visitor.create')
  @ApiOperation({
    summary: 'Register a walk-in visitor, delivery, cab or other visitor',
    description: 'Send an optional `idempotencyKey` to make retries safe; the same key returns the original request.',
  })
  @ApiBody({ schema: jsonSchema(createVisitorSchema) })
  async create(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Body() body: unknown) {
    return this.visitors.create(ctx, session.userId, validate(createVisitorSchema, body));
  }

  @Get('visitors/:visitorId')
  @RequireSocietyPermission('visitor.read')
  @ApiOperation({ summary: 'One visitor request and its full decision, entry, exit and override history' })
  async detail(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string) {
    return { visitor: await this.visitors.detail(ctx, session.userId, validateId(id, 'visitorId')) };
  }

  @Post('visitors/:visitorId/approve')
  @HttpCode(200)
  @RequireSocietyPermission('visitor.approve')
  @ApiOperation({ summary: 'Resident of the destination unit approves the request' })
  @ApiBody({ schema: jsonSchema(visitorDecisionSchema) })
  async approve(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string, @Body() body: unknown) {
    return { visitor: await this.visitors.approve(ctx, session.userId, validateId(id, 'visitorId'), validate(visitorDecisionSchema, body)) };
  }

  @Post('visitors/:visitorId/reject')
  @HttpCode(200)
  @RequireSocietyPermission('visitor.approve')
  @ApiOperation({ summary: 'Resident of the destination unit rejects the request' })
  @ApiBody({ schema: jsonSchema(visitorDecisionSchema) })
  async reject(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string, @Body() body: unknown) {
    return { visitor: await this.visitors.reject(ctx, session.userId, validateId(id, 'visitorId'), validate(visitorDecisionSchema, body)) };
  }

  @Post('visitors/:visitorId/cancel')
  @HttpCode(200)
  @RequireSocietyPermission('visitor.manage')
  @ApiOperation({ summary: 'Cancel a pending or approved request with a reason' })
  @ApiBody({ schema: jsonSchema(visitorCancelSchema) })
  async cancel(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string, @Body() body: unknown) {
    return { visitor: await this.visitors.cancel(ctx, session.userId, validateId(id, 'visitorId'), validate(visitorCancelSchema, body)) };
  }

  @Post('visitors/:visitorId/entry')
  @HttpCode(200)
  @RequireSocietyPermission('visitor.entry')
  @ApiOperation({ summary: 'Record manual entry for an approved visitor' })
  async entry(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string) {
    return { visitor: await this.visitors.entry(ctx, session.userId, validateId(id, 'visitorId')) };
  }

  @Post('visitors/:visitorId/exit')
  @HttpCode(200)
  @RequireSocietyPermission('visitor.entry')
  @ApiOperation({ summary: 'Record exit for a visitor who is inside' })
  async exit(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string) {
    return { visitor: await this.visitors.exit(ctx, session.userId, validateId(id, 'visitorId')) };
  }

  @Post('visitors/:visitorId/override')
  @HttpCode(200)
  @RequireSocietyPermission('visitor.override')
  @ApiOperation({ summary: 'Emergency admission with a mandatory reason (administrators only)' })
  @ApiBody({ schema: jsonSchema(visitorOverrideSchema) })
  async override(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('visitorId') id: string, @Body() body: unknown) {
    return { visitor: await this.visitors.override(ctx, session.userId, validateId(id, 'visitorId'), validate(visitorOverrideSchema, body)) };
  }
}
