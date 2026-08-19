import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../utils/AppError.js';
import { config } from '../config.js';

/**
 * Wraps an async route handler so a rejected promise reaches the error handler
 * instead of hanging the request. Express 4 does not do this on its own.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
  });
}

/**
 * The single place errors turn into responses.
 *
 * Operational errors (AppError, Zod validation) are reported to the caller.
 * Anything else is logged in full server-side and reduced to a generic message,
 * so stack traces, file paths and library internals never reach the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
    res.status(422).json({
      error: 'The submitted data is not valid. Please check the highlighted fields.',
      code: 'VALIDATION_ERROR',
      details,
    });
    return;
  }

  /**
   * A body larger than `config.bodyLimit`.
   *
   * express.json throws this before any route sees the request, so without
   * this branch an oversized upload — a customer's payment screenshot, say —
   * came back as a 500 with an incident id, as though the server had broken.
   * It is a rejection, and the caller can act on it.
   */
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({
      error: 'That upload is too large. Please send a smaller image.',
      code: 'PAYLOAD_TOO_LARGE',
    });
    return;
  }

  if (isAppError(err)) {
    const appErr = err as AppError;
    // 5xx AppErrors still deserve a server-side record.
    if (appErr.statusCode >= 500) {
      console.error(`[error] ${req.method} ${req.originalUrl}:`, appErr);
    }
    res.status(appErr.statusCode).json({
      error: appErr.message,
      ...(appErr.code ? { code: appErr.code } : {}),
      ...(appErr.details ? { details: appErr.details } : {}),
    });
    return;
  }

  // Unexpected fault.
  const incidentId = `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.error(`[error] Unhandled fault ${incidentId} on ${req.method} ${req.originalUrl}`);
  console.error(err);

  res.status(500).json({
    error: 'An internal server error occurred. Please try again or contact support with the incident id.',
    code: 'INTERNAL_ERROR',
    incidentId,
    // Only in development do we hand back the real message, to keep debugging sane.
    ...(config.isProduction ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}
