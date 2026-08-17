import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService.js';
import { db } from '../db/db.js';
import { User, UserRole, AuthenticatedUser } from '../types/index.js';
import { AppError } from '../utils/AppError.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Client IP, honouring a trusted reverse proxy's X-Forwarded-For. */
export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
}

/**
 * Reads a route parameter as a single string.
 *
 * Express types a param as `string | string[]` because a pattern can repeat.
 * None of ours do, so this collapses the union in one place rather than
 * scattering casts through every handler.
 */
export function routeParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

/**
 * Rejects any request without a valid, non-expired JWT belonging to an account
 * that still exists and is still active. Attaches `req.user`.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    return next(AppError.unauthorized('Authentication required. Please sign in.'));
  }

  const decoded = AuthService.verifyToken(token);
  if (!decoded) {
    return next(AppError.unauthorized('Your session has expired. Please sign in again.'));
  }

  // Re-check the account on every request: a user deactivated or role-changed
  // mid-session must not keep working off a stale token.
  const user = db.findById<User>('users', decoded.userId);
  if (!user) {
    return next(AppError.unauthorized('Account no longer exists.'));
  }
  if (!user.active) {
    return next(AppError.forbidden('This account has been deactivated.'));
  }

  req.user = {
    userId: user.id,
    dealerId: user.dealerId,
    customerId: user.customerId,
    role: user.role,
    name: user.name,
    email: user.email,
  };

  next();
}

/** Restricts a route to the given roles. Must run after `requireAuth`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(
        AppError.forbidden(
          `This action requires one of the following roles: ${roles.join(', ')}. Your role is ${req.user.role}.`
        )
      );
    }
    next();
  };
}

/** Convenience guards for the two most common permission levels. */
export const requireDealerStaff = requireRole('SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF');
export const requireDealerAdmin = requireRole('SUPER_ADMIN', 'DEALER_ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');

export function getAuthUser(req: Request): AuthenticatedUser {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

/**
 * Resolves which dealer's data this request is allowed to touch.
 *
 * This is the single most important function for tenant isolation: the dealer
 * id comes from the verified JWT, never from the query string. Only a
 * SUPER_ADMIN may point at another dealer (or at 'all') via `?dealerId=`.
 *
 * Returns `null` to mean "no dealer filter" — reachable only by SUPER_ADMIN.
 */
export function resolveDealerScope(req: Request): string | null {
  const user = getAuthUser(req);

  if (user.role === 'SUPER_ADMIN') {
    const requested = req.query.dealerId;
    if (!requested || requested === 'all') return null;
    return String(requested);
  }

  if (!user.dealerId) {
    throw AppError.forbidden('Your account is not linked to any dealer.');
  }

  // A dealer user asking for someone else's data is a deliberate probe — log it.
  const requested = req.query.dealerId;
  if (requested && requested !== 'all' && String(requested) !== user.dealerId) {
    console.warn(
      `[security] Cross-tenant access attempt: user=${user.userId} (dealer=${user.dealerId}) requested dealer=${requested} on ${req.method} ${req.originalUrl}`
    );
  }

  return user.dealerId;
}

/**
 * The dealer id to stamp onto a newly created record. Unlike `resolveDealerScope`
 * this must always produce a concrete id — a SUPER_ADMIN creating records has to
 * say which dealer they are acting for.
 */
export function resolveWritableDealerId(req: Request, bodyDealerId?: unknown): string {
  const user = getAuthUser(req);

  if (user.role === 'SUPER_ADMIN') {
    const target = bodyDealerId ?? req.query.dealerId;
    if (!target || target === 'all') {
      throw AppError.badRequest('As a super admin you must specify which dealerId this record belongs to.');
    }
    if (!db.findById('dealers', String(target))) {
      throw AppError.notFound(`Dealer ${target}`);
    }
    return String(target);
  }

  if (!user.dealerId) {
    throw AppError.forbidden('Your account is not linked to any dealer.');
  }

  if (bodyDealerId && String(bodyDealerId) !== user.dealerId) {
    throw AppError.forbidden('You cannot create records for another dealer.');
  }

  return user.dealerId;
}

/**
 * Throws unless the caller is allowed to touch a record belonging to `dealerId`.
 * Use this on every single-record read/write that is looked up by id.
 */
export function assertDealerAccess(req: Request, recordDealerId: string | undefined, resource = 'record'): void {
  const user = getAuthUser(req);
  if (user.role === 'SUPER_ADMIN') return;

  if (!recordDealerId || recordDealerId !== user.dealerId) {
    // Deliberately a 404, not a 403: confirming the record exists would leak
    // that another dealer has a device/customer with this id.
    throw AppError.notFound(resource.charAt(0).toUpperCase() + resource.slice(1));
  }
}

/**
 * Extra guard for CUSTOMER logins: they may only ever see their own records.
 * Throws if the customer id on the record is not the one bound to their account.
 */
export function assertCustomerSelfAccess(req: Request, recordCustomerId: string | undefined, resource = 'record'): void {
  const user = getAuthUser(req);
  if (user.role !== 'CUSTOMER') return;

  if (!user.customerId || recordCustomerId !== user.customerId) {
    throw AppError.notFound(resource.charAt(0).toUpperCase() + resource.slice(1));
  }
}
