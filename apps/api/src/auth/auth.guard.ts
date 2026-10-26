import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_COOKIE } from '../config';
import { Errors } from '../common/errors';
import { requestStore } from '../common/request-context.middleware';
import { SessionService, type SessionWithUser } from './session.service';

export const IS_PUBLIC = 'isPublic';
/** Marks a route as reachable without a session. Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { auth?: SessionWithUser; requestId?: string };

export function extractToken(req: Request): { token: string | null; via: 'bearer' | 'cookie' | null } {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return { token: header.slice(7).trim(), via: 'bearer' };
  const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (cookie) return { token: cookie, via: 'cookie' };
  return { token: null, via: null };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const { token } = extractToken(req);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw Errors.unauthenticated();
    req.auth = session;
    const store = requestStore.getStore();
    if (store) store.userId = session.userId;
    return true;
  }
}

/** Injects the authenticated session (with user) into a handler parameter. */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw Errors.unauthenticated();
  return req.auth;
});
