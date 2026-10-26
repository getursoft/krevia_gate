import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformPermission, SocietyPermission } from '@krevia/shared';
import type { AuthedRequest } from '../auth/auth.guard';
import { Errors } from '../common/errors';
import { validateId } from '../common/validate';
import { SocietyAccessService, type SocietyContext } from './society-access.service';

const SOCIETY_PERMISSION = 'societyPermission';
const PLATFORM_PERMISSION = 'platformPermission';

/**
 * Requires `permission` in the society named by the route parameter `param`
 * (default `societyId`). The guard validates the id, resolves the caller's
 * ACTIVE memberships and rejects the request before the handler runs.
 */
export const RequireSocietyPermission = (permission: SocietyPermission, param = 'societyId') =>
  SetMetadata(SOCIETY_PERMISSION, { permission, param });

/** Requires a platform permission (from User.platformRole). Grants no society access. */
export const RequirePlatformPermission = (permission: PlatformPermission) => SetMetadata(PLATFORM_PERMISSION, permission);

type SocietyRequest = AuthedRequest & { society?: SocietyContext };

/** Runs after AuthGuard (registration order in AppModule). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: SocietyAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const society = this.reflector.get<{ permission: SocietyPermission; param: string } | undefined>(SOCIETY_PERMISSION, handler);
    const platform = this.reflector.get<PlatformPermission | undefined>(PLATFORM_PERMISSION, handler);
    if (!society && !platform) return true;

    const req = context.switchToHttp().getRequest<SocietyRequest>();
    if (!req.auth) throw Errors.unauthenticated();
    const route = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : undefined;
    if (platform) await this.access.authorizePlatform(req.auth.user, platform, route);
    if (society) {
      const societyId = validateId(String(req.params[society.param] ?? ''), society.param);
      req.society = await this.access.authorize(req.auth.user, societyId, society.permission, route);
    }
    return true;
  }
}

/** The authorised society context set by PermissionGuard. */
export const CurrentSociety = createParamDecorator((_: unknown, ctx: ExecutionContext): SocietyContext => {
  const req = ctx.switchToHttp().getRequest<SocietyRequest>();
  if (!req.society) throw Errors.forbidden();
  return req.society;
});
