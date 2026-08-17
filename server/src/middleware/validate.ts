import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

/**
 * Parses and REPLACES `req.body` with the validated result, so handlers can
 * rely on types and never see unexpected extra fields.
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}

/**
 * Validates the query string. `req.query` is a getter on newer Express versions,
 * so the parsed result is exposed as `req.validatedQuery` instead of overwriting.
 */
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) return next(result.error);
    (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    next();
  };
}

export function getQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery as T;
}
