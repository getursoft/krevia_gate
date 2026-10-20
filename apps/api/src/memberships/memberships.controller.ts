import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createMembershipRequestSchema, reviewMembershipRequestSchema } from '@krevia/shared';
import { MembershipStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { toSocietySummary } from '../societies/society.mapper';
import { MembershipAccessService } from './membership-access.service';
import {
  adminMembershipInclude,
  membershipInclude,
  toAdminMembershipDto,
  toMembershipDto,
} from './membership.mapper';

const statusFilterSchema = z.object({ status: z.nativeEnum(MembershipStatus).optional() });

const ACTIVE_STATUSES: MembershipStatus[] = ['PENDING', 'APPROVED'];

@ApiTags('membership')
@Controller()
export class MembershipsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MembershipAccessService,
  ) {}

  @Post('membership-requests')
  @ApiOperation({
    summary: 'Request to join a society. Always created as PENDING; verification is done by a society admin.',
  })
  @ApiBody({ schema: jsonSchema(createMembershipRequestSchema) })
  async create(@CurrentSession() session: SessionWithUser, @Body() body: unknown) {
    const input = validate(createMembershipRequestSchema, body);
    const society = await this.prisma.society.findUnique({ where: { id: input.societyId } });
    if (!society) throw Errors.notFound('Society not found.');
    const tower = society.towers.find((t) => t.toLowerCase() === input.tower.toLowerCase());
    if (!tower) throw Errors.validation({ tower: 'Select a tower / block from this society.' });

    const active = await this.prisma.membershipRequest.findFirst({
      where: { userId: session.userId, status: { in: ACTIVE_STATUSES } },
      include: { society: true },
    });
    if (active) throw this.duplicateError(active.status, active.society.name);

    try {
      const request = await this.prisma.$transaction(async (tx) => {
        const unit = await tx.unit.upsert({
          where: { societyId_tower_number: { societyId: society.id, tower, number: input.unitNumber } },
          update: {},
          create: { societyId: society.id, tower, number: input.unitNumber },
        });
        return tx.membershipRequest.create({
          // Status is never taken from client input.
          data: { userId: session.userId, societyId: society.id, unitId: unit.id, occupancy: input.occupancy },
          include: membershipInclude,
        });
      });
      return { request: toMembershipDto(request) };
    } catch (err) {
      // Concurrent duplicate submission hit the partial unique index.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('You already have a membership request in progress.');
      }
      throw err;
    }
  }

  @Get('membership-requests/me')
  @ApiOperation({ summary: 'My current membership request and history' })
  async mine(@CurrentSession() session: SessionWithUser) {
    const requests = await this.prisma.membershipRequest.findMany({
      where: { userId: session.userId },
      include: membershipInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const history = requests.map(toMembershipDto);
    return { current: history.find((r) => ACTIVE_STATUSES.includes(r.status)) ?? null, history };
  }

  @Post('membership-requests/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw my own PENDING request' })
  async cancel(@CurrentSession() session: SessionWithUser, @Param('id') id: string) {
    const requestId = validateId(id);
    // Scoped by userId so another user's request is indistinguishable from a missing one.
    const result = await this.prisma.membershipRequest.updateMany({
      where: { id: requestId, userId: session.userId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (result.count === 0) {
      const own = await this.prisma.membershipRequest.findFirst({
        where: { id: requestId, userId: session.userId },
        select: { id: true },
      });
      if (!own) throw Errors.notFound('Membership request not found.');
      throw Errors.conflict('Only pending requests can be withdrawn.');
    }
    const request = await this.prisma.membershipRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: membershipInclude,
    });
    return { request: toMembershipDto(request) };
  }

  @Get('admin/societies')
  @ApiOperation({ summary: 'Societies I administer' })
  async adminSocieties(@CurrentSession() session: SessionWithUser) {
    const where: Prisma.SocietyWhereInput =
      session.user.platformRole === 'PLATFORM_ADMIN'
        ? {}
        : { roles: { some: { userId: session.userId, role: 'ADMIN' } } };
    const societies = await this.prisma.society.findMany({ where, orderBy: { name: 'asc' } });
    return { items: societies.map(toSocietySummary) };
  }

  @Get('societies/:id/membership-requests')
  @ApiOperation({ summary: 'Membership requests for a society (society admins only)' })
  @ApiQuery({ name: 'status', required: false, enum: MembershipStatus })
  async listForSociety(
    @CurrentSession() session: SessionWithUser,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const societyId = validateId(id);
    const { status } = validate(statusFilterSchema, query);
    const society = await this.prisma.society.findUnique({ where: { id: societyId }, select: { id: true } });
    if (!society) throw Errors.notFound('Society not found.');
    await this.access.requireSocietyAdmin(session.user, societyId);
    const items = await this.prisma.membershipRequest.findMany({
      where: { societyId, ...(status && { status }) },
      include: adminMembershipInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: items.map(toAdminMembershipDto) };
  }

  @Post('membership-requests/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a PENDING request (admin of that society only)' })
  @ApiBody({ schema: jsonSchema(reviewMembershipRequestSchema) })
  approve(@CurrentSession() session: SessionWithUser, @Param('id') id: string, @Body() body: unknown) {
    return this.review(session, id, body, 'APPROVED');
  }

  @Post('membership-requests/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a PENDING request (admin of that society only)' })
  @ApiBody({ schema: jsonSchema(reviewMembershipRequestSchema) })
  reject(@CurrentSession() session: SessionWithUser, @Param('id') id: string, @Body() body: unknown) {
    return this.review(session, id, body, 'REJECTED');
  }

  private async review(session: SessionWithUser, id: string, body: unknown, status: 'APPROVED' | 'REJECTED') {
    const requestId = validateId(id);
    const { note } = validate(reviewMembershipRequestSchema, body);
    const existing = await this.prisma.membershipRequest.findUnique({ where: { id: requestId } });
    if (!existing) throw Errors.notFound('Membership request not found.');
    await this.access.requireSocietyAdmin(session.user, existing.societyId);
    if (existing.userId === session.userId) throw Errors.forbidden('You cannot review your own request.');

    // Conditional update makes concurrent approve/reject safe.
    const result = await this.prisma.membershipRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status, reviewNote: note ?? null, reviewedById: session.userId, reviewedAt: new Date() },
    });
    if (result.count === 0) throw Errors.conflict('This request has already been reviewed or withdrawn.');
    const request = await this.prisma.membershipRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: adminMembershipInclude,
    });
    return { request: toAdminMembershipDto(request) };
  }

  private duplicateError(status: MembershipStatus, societyName: string) {
    return status === 'APPROVED'
      ? Errors.conflict(`You are already a verified member of ${societyName}.`)
      : Errors.conflict(`You already have a pending request for ${societyName}. Please wait for verification.`);
  }
}
