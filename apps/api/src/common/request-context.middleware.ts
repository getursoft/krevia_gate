import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppLogger, LogLevel } from './logger';

/** Error details attached by AllExceptionsFilter so the access log line can carry them. */
export interface RequestErrorInfo {
  errorCode: string;
  errorName?: string;
  errorMessage?: string;
  stack?: string;
}

/** Per-request values available anywhere in the call chain (audit events use them). */
export interface RequestStore {
  requestId: string;
  /** Set by AuthGuard once the session is validated. */
  userId?: string;
}

export const requestStore = new AsyncLocalStorage<RequestStore>();

const QUIET_PATHS = new Set(['/api/v1/health', '/api/v1/ready']);

/**
 * Assigns a request id (honouring a well-formed incoming `X-Request-Id`), returns
 * it in the response, and writes exactly one structured access-log line per request:
 * `{ requestId, method, route, status, durationMs, errorCode? }`.
 * Bodies, query strings, headers, cookies and tokens are never logged.
 */
export function requestContext(logger: AppLogger) {
  return (req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      const error = res.locals.requestError as RequestErrorInfo | undefined;
      const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : QUIET_PATHS.has(req.path) ? 'debug' : 'info';
      // Route pattern (e.g. /api/v1/societies/:id) keeps ids out of aggregations; falls back to the path.
      const route = req.route?.path ? `${req.baseUrl}${req.route.path as string}` : req.path;
      logger.emit(level, `${req.method} ${route} ${status}`, {
        context: 'HTTP',
        requestId: req.requestId,
        method: req.method,
        route,
        status,
        durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100,
        ...error,
      });
    });
    requestStore.run({ requestId: req.requestId }, next);
  };
}
