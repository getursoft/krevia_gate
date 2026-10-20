import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody, ErrorCode } from '@krevia/shared';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from './errors';
import { redactText } from './logger';
import type { RequestErrorInfo } from './request-context.middleware';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'BAD_REQUEST',
  429: 'RATE_LIMITED',
};

/**
 * Converts every error into `{ error: { code, message, details?, requestId } }`.
 * Internal details (stack traces, SQL, Prisma messages) never reach the client.
 *
 * The filter does not log by itself: it attaches a safe error summary to the
 * response, and the request-context middleware writes it on the request's single
 * access-log line. One error → one log entry, correlated by requestId.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody['error'] = { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute and try again.' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code = STATUS_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST');
      // Body-parser errors (malformed JSON) arrive here as 400s.
      const message =
        status === 400
          ? 'The request could not be understood.'
          : status === 404
            ? 'The requested resource was not found.'
            : status >= 500
              ? 'Something went wrong. Please try again.'
              : exception.message;
      body = { code, message };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { code: 'CONFLICT', message: 'This record already exists.' };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { code: 'NOT_FOUND', message: 'The requested resource was not found.' };
      }
    } else if (isBodyParserError(exception)) {
      status = exception.status;
      body = {
        code: 'BAD_REQUEST',
        message: status === 413 ? 'The request is too large.' : 'The request could not be understood.',
      };
    }

    const info: RequestErrorInfo = { errorCode: body.code };
    if (status >= 500) {
      // Server faults: record what failed (redacted), never the request body or headers.
      const err = exception as Error | undefined;
      info.errorName = err?.name ?? 'Error';
      info.errorMessage = redactText(err?.message ?? String(exception));
      if (!this.config.isProduction && err?.stack) info.stack = redactText(err.stack);
    }
    res.locals.requestError = info;

    res.status(status).json({ error: { ...body, requestId } } satisfies ApiErrorBody);
  }
}

function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { status?: unknown }).status === 'number' &&
    typeof (e as { type?: unknown }).type === 'string'
  );
}
