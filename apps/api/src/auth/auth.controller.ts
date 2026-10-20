import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CLIENT_HEADER, loginSchema, registerSchema, type AuthResponseDto } from '@krevia/shared';
import type { ClientType, User } from '@prisma/client';
import type { Request, Response } from 'express';
import { APP_CONFIG, SESSION_COOKIE, type AppConfig } from '../config';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentSession, Public } from './auth.guard';
import { getDummyHash, hashPassword, verifyPassword } from './password';
import { SessionService, type SessionWithUser } from './session.service';
import { toUserDto } from './user.mapper';

export const AUTH_RATE_LIMITED = 'authRateLimited';
/** Applies the strict `auth` throttler (per client IP) to a route. */
const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED, true);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
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
      throw Errors.unauthenticated('Incorrect mobile number or password.');
    }
    return this.startSession(user, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentSession() session: SessionWithUser, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(session.id);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user' })
  async me(@CurrentSession() session: SessionWithUser) {
    return { user: await toUserDto(this.prisma, session.user) };
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
