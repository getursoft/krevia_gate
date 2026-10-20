import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@krevia/shared';

/** HttpException carrying a stable machine-readable code for clients. */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  validation: (details: Record<string, string>, message = 'Please correct the highlighted fields.') =>
    new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, details),
  unauthenticated: (message = 'Please sign in to continue.') =>
    new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action.') =>
    new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  notFound: (message = 'The requested resource was not found.') =>
    new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message),
  conflict: (message: string) => new AppError(HttpStatus.CONFLICT, 'CONFLICT', message),
};
