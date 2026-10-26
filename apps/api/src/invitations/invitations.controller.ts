import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createInvitationSchema,
  invitationListSchema,
  invitationTokenSchema,
  platformAdminInvitationSchema,
  type MeDto,
} from '@krevia/shared';
import { AuthRateLimited } from '../auth/auth.controller';
import { CurrentSession, Public } from '../auth/auth.guard';
import { SessionService, type SessionWithUser } from '../auth/session.service';
import { toUserDto } from '../auth/user.mapper';
import { CurrentSociety, RequirePlatformPermission, RequireSocietyPermission } from '../authz/permission.guard';
import type { SocietyContext } from '../authz/society-access.service';
import { jsonSchema } from '../common/openapi';
import { validate, validateId } from '../common/validate';
import { page, toInvitationDto } from '../members/member.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@Controller()
export class InvitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService,
  ) {}

  @Post('societies/:societyId/invitations')
  @RequireSocietyPermission('membership.invite')
  @ApiOperation({
    summary: 'Invite a phone number as resident (with a unit), guard or society admin. The invite link is returned once.',
  })
  @ApiBody({ schema: jsonSchema(createInvitationSchema) })
  async create(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Body() body: unknown) {
    const input = validate(createInvitationSchema, body);
    return this.invitations.create({ ...input, societyId: ctx.societyId, actorUserId: session.userId });
  }

  @Get('societies/:societyId/invitations')
  @RequireSocietyPermission('membership.invite')
  @ApiOperation({ summary: 'Invitations of the society (administrators)' })
  async list(@CurrentSociety() ctx: SocietyContext, @Query() query: unknown) {
    const { page: pageNo, pageSize, status } = validate(invitationListSchema, query);
    await this.invitations.expireStale(this.prisma, ctx.societyId);
    const where = { societyId: ctx.societyId, ...(status && { status }) };
    const [total, rows] = await Promise.all([
      this.prisma.invitation.count({ where }),
      this.prisma.invitation.findMany({
        where,
        include: { unit: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return page(rows.map(toInvitationDto), pageNo, pageSize, total);
  }

  @Post('societies/:societyId/invitations/:invitationId/revoke')
  @HttpCode(200)
  @RequireSocietyPermission('membership.invite')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revoke(@CurrentSession() session: SessionWithUser, @CurrentSociety() ctx: SocietyContext, @Param('invitationId') id: string) {
    const invitation = await this.invitations.revoke(ctx.societyId, validateId(id, 'invitationId'), session.userId);
    return { invitation: toInvitationDto(invitation) };
  }

  @Public()
  @AuthRateLimited()
  @Post('invitations/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'What an invitation offers (society, role, unit, masked phone). Token in the body, never the URL.' })
  @ApiBody({ schema: jsonSchema(invitationTokenSchema) })
  async preview(@Body() body: unknown) {
    const { token } = validate(invitationTokenSchema, body);
    return { invitation: await this.invitations.preview(token) };
  }

  @AuthRateLimited()
  @Post('invitations/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invitation sent to my mobile number. Role and unit come from the invitation.' })
  @ApiBody({ schema: jsonSchema(invitationTokenSchema) })
  async accept(@CurrentSession() session: SessionWithUser, @Body() body: unknown): Promise<MeDto> {
    const { token } = validate(invitationTokenSchema, body);
    await this.invitations.accept(session.user, token);
    return { user: await toUserDto(this.prisma, session.user), activeSocietyId: await this.sessions.activeSocietyId(session) };
  }

  @Post('platform/societies/:societyId/admin-invitations')
  @RequirePlatformPermission('platform.admin.assign')
  @ApiOperation({ summary: 'Invite a society\'s administrator (platform administrators). Grants the platform admin no society access.' })
  @ApiBody({ schema: jsonSchema(platformAdminInvitationSchema) })
  async inviteAdmin(@CurrentSession() session: SessionWithUser, @Param('societyId') id: string, @Body() body: unknown) {
    const { phone } = validate(platformAdminInvitationSchema, body);
    return this.invitations.create({ societyId: validateId(id, 'societyId'), phone, role: 'ADMIN', actorUserId: session.userId, via: 'platform' });
  }
}
