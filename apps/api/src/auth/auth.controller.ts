import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CLIENT_HEADER,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  type AuthResponseDto,
  type MeDto,
} from '@krevia/shared';
import type { ClientType, User } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, SESSION_COOKIE, type AppConfig } from '../config';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentSession, Public } from './auth.guard';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from './password';
import { PasswordResetService, RESET_REQUESTED_MESSAGE } from './password-reset.service';
import { SessionService, type SessionWithUser } from './session.service';
import { toUserDto } from './user.mapper';

export const AUTH_RATE_LIMITED = 'authRateLimited';
/** Applies the strict `auth` throttler (per client IP) to a route. */
export const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED, true);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly resets: PasswordResetService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @AuthRateLimited()
  @Post('register')
  @ApiOperation({ summary: 'Create a resident account and start a session' })
  @ApiBody({ schema: jsonSchema(registerSchema) })
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = validate(registerSchema, body);
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
      select: { phone: true },
    });
    if (existing) {
      throw existing.phone === input.phone
        ? Errors.conflict('An account with this mobile number already exists. Please sign in.')
        : Errors.conflict('This email address is already linked to another account.');
    }
    const user = await this.prisma.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash: await hashPassword(input.password),
      },
    });
    res.status(201);
    await this.audit.record({ action: 'auth.register', outcome: 'SUCCESS', actorUserId: user.id, targetType: 'user', targetId: user.id });
    return this.startSession(user, req, res);
  }

  @Public()
  @AuthRateLimited()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with mobile number and password' })
  @ApiBody({ schema: jsonSchema(loginSchema) })
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = validate(loginSchema, body);
    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    // Always run a hash comparison so response time does not reveal whether the number exists.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !ok) {
      // The phone number is not stored; a known account is referenced by id only.
      await this.audit.recordLimited(`login:${req.ip}`, {
        action: 'auth.login',
        outcome: 'FAILURE',
        actorUserId: null,
        ...(user && { targetType: 'user', targetId: user.id }),
        metadata: { reason: user ? 'wrong_password' : 'unknown_account' },
      });
      throw Errors.unauthenticated('Incorrect mobile number or password.');
    }
    if (needsRehash(user.passwordHash)) {
      // Transparent upgrade of Sprint 1 scrypt hashes to Argon2id.
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
    }
    await this.audit.record({ action: 'auth.login', outcome: 'SUCCESS', actorUserId: user.id, targetType: 'user', targetId: user.id });
    return this.startSession(user, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentSession() session: SessionWithUser, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(session.id);
    await this.audit.record({ action: 'auth.logout', outcome: 'SUCCESS' });
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke every session of the current user (sign out on all devices)' })
  async logoutAll(@CurrentSession() session: SessionWithUser, @Res({ passthrough: true }) res: Response) {
    const count = await this.sessions.revokeAllForUser(session.userId);
    await this.audit.record({ action: 'auth.logout_all', outcome: 'SUCCESS', metadata: { revokedLogins: count } });
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user and the validated active society of this session' })
  async me(@CurrentSession() session: SessionWithUser): Promise<MeDto> {
    return { user: await toUserDto(this.prisma, session.user), activeSocietyId: await this.sessions.activeSocietyId(session) };
  }

  @Public()
  @AuthRateLimited()
  @Post('password-reset/request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a 6-digit reset code. Same response whether or not the number is registered.' })
  @ApiBody({ schema: jsonSchema(passwordResetRequestSchema) })
  async requestReset(@Body() body: unknown, @Req() req: Request) {
    const { phone } = validate(passwordResetRequestSchema, body);
    await this.resets.request(phone, req.ip ?? 'unknown');
    return { message: RESET_REQUESTED_MESSAGE };
  }

  @Public()
  @AuthRateLimited()
  @Post('password-reset/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password with a valid reset code. Signs the account out everywhere.' })
  @ApiBody({ schema: jsonSchema(passwordResetConfirmSchema) })
  async confirmReset(@Body() body: unknown, @Req() req: Request) {
    const input = validate(passwordResetConfirmSchema, body);
    await this.resets.confirm(input.phone, input.code, input.password, req.ip ?? 'unknown');
    return { message: 'Your password has been changed. Sign in with your new password.' };
  }

  private async startSession(user: User, req: Request, res: Response): Promise<AuthResponseDto> {
    const clientType: ClientType = req.header(CLIENT_HEADER)?.toLowerCase() === 'mobile' ? 'MOBILE' : 'WEB';
    const { token, expiresAt } = await this.sessions.create(user.id, clientType, req.header('user-agent'));
    const dto = await toUserDto(this.prisma, user);
    if (clientType === 'MOBILE') {
      return { user: dto, token, expiresAt: expiresAt.toISOString() };
    }
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
    return { user: dto, expiresAt: expiresAt.toISOString() };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
