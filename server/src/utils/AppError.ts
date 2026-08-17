/**
 * An error that is safe to show to the API caller.
 *
 * Anything thrown that is NOT an AppError is treated as an unexpected internal
 * fault: it gets logged in full on the server and the client only receives a
 * generic message, so stack traces and library internals never leak.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(message: string, statusCode = 400, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options?.code;
    this.details = options?.details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(message, 400, { code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'Authentication required.') {
    return new AppError(message, 401, { code: 'UNAUTHORIZED' });
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError(message, 403, { code: 'FORBIDDEN' });
  }

  static notFound(resource = 'Resource') {
    return new AppError(`${resource} not found.`, 404, { code: 'NOT_FOUND' });
  }

  static conflict(message: string) {
    return new AppError(message, 409, { code: 'CONFLICT' });
  }

  static unprocessable(message: string, details?: unknown) {
    return new AppError(message, 422, { code: 'UNPROCESSABLE', details });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (typeof err === 'object' && err !== null && (err as any).isOperational === true);
}
