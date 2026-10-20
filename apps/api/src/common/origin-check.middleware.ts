import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '../config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions (in addition to SameSite=Lax):
 * - any state-changing request that carries an Origin header must come from an allowed origin;
 * - a state-changing request authenticated by cookie (no bearer token) must carry an allowed Origin.
 * Mobile clients authenticate with bearer tokens and are unaffected.
 */
export function originCheck(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.header('origin');
    const usesCookie =
      !req.header('authorization') && Boolean((req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]);
    if ((origin && !allowed.has(origin)) || (usesCookie && !origin)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Request origin is not allowed.',
          requestId: (req as Request & { requestId?: string }).requestId,
        },
      });
      return;
    }
    next();
  };
}
