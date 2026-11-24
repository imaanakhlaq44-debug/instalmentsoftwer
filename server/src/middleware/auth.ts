import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService.js';
import { repo } from '../db/repositories/index.js';
import { UserRole, AuthenticatedUser } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './errorHandler.js';

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

/**
 * The only endpoints an account with a temporary password may reach: restore
 * the session, set a real password, or sign out. Matched as "METHOD /full/path".
 */
const PASSWORD_CHANGE_ALLOWED = new Set([
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout',
]);

/**
 * Everything a shop's staff login may reach. Nothing else answers for them.
 *
 * The owner's rule: every staff login can look a customer up and call or
 * WhatsApp them (the staff desk). Counter staff can also take a payment at the
 * counter (it waits for the owner's approval), make a new sale and connect the
 * sold phone. No locking, no settings, no reversals, no account deletion, no
 * line to the platform: those are the owner's.
 *
 * This is an allow-list checked before any route runs, so a new route is
 * closed to staff until someone adds it here on purpose. `:id` stands for
 * exactly one path segment.
 */
const STAFF_ALLOWED: Partial<Record<UserRole, readonly string[]>> = {
  DEALER_VIEWER: [
    'GET /api/auth/me',
    'POST /api/auth/change-password',
    'POST /api/auth/logout',
    'GET /api/staff-desk/customers',
  ],
  DEALER_STAFF: [
    'GET /api/auth/me',
    'POST /api/auth/change-password',
    'POST /api/auth/logout',
    'GET /api/staff-desk/customers',
    'POST /api/payments',
    // A new sale: customer, phone and plan in one form.
    'GET /api/customers/sale-helper',
    'POST /api/customers/agreement-preview',
    'POST /api/customers',
    'GET /api/sale-drafts',
    'PUT /api/sale-drafts/:id',
    'DELETE /api/sale-drafts/:id',
    'GET /api/devices/imei-status/:id',
    // Connecting the sold phone (the QR on the counter).
    'GET /api/devices',
    'GET /api/devices/:id',
    'GET /api/enrollment/readiness',
    'GET /api/enrollment/tokens',
    'POST /api/enrollment/generate',
    'POST /api/enrollment/tokens/:id/revoke',
    'POST /api/enrollment/phone-intakes',
    'GET /api/enrollment/phone-intakes/:id',
  ],
};

function routeMatches(pattern: string, request: string): boolean {
  const want = pattern.split('/');
  const got = request.split('/');
  if (want.length !== got.length) return false;
  return want.every((part, i) => (part === ':id' ? got[i].length > 0 : part === got[i]));
}

/** Whether a staff role may make this request. Other roles are not limited here. */
export function staffMayReach(role: UserRole, method: string, path: string): boolean {
  const allowed = STAFF_ALLOWED[role];
  if (!allowed) return true;
  const verb = method === 'HEAD' || method === 'OPTIONS' ? 'GET' : method;
  const request = `${verb} ${path.replace(/\/+$/, '') || '/'}`;
  return allowed.some((pattern) => routeMatches(pattern, request));
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
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    return next(AppError.unauthorized('Authentication required. Please sign in.'));
  }

  const decoded = AuthService.verifyToken(token);
  if (!decoded) {
    return next(AppError.unauthorized('Your session has expired. Please sign in again.'));
  }

  // Re-check the account on every request: a user deactivated or role-changed
  // mid-session must not keep working off a stale token. This is also why the
  // role is never taken from the token's own claims.
  const user = await repo.users.findById(decoded.userId);
  if (!user) {
    return next(AppError.unauthorized('Account no longer exists.'));
  }
  if ((decoded.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
    return next(AppError.unauthorized('Session revoked. Please sign in again.'));
  }
  if (!user.active) {
    return next(AppError.forbidden('This account has been deactivated.'));
  }

  // Suspending a dealer must cut off its staff and customers immediately, not
  // only at their next login — otherwise a token issued before the suspension
  // keeps locking devices and recording payments until it expires.
  if (user.dealerId) {
    const dealer = await repo.dealers.findById(user.dealerId);
    if (!dealer || !dealer.active) {
      return next(AppError.forbidden('Your dealer account is suspended. Please contact Almas SDM support.'));
    }
  }

  // A temporary password (set by an admin) must be replaced before the account
  // can do anything else. The dashboard redirects too, but that is only UI —
  // this is the actual gate for anyone calling the API directly.
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(`${req.method} ${req.baseUrl}${req.path}`)) {
    return next(
      new AppError('You must change your temporary password before continuing.', 403, { code: 'PASSWORD_CHANGE_REQUIRED' })
    );
  }

  // Staff logins reach only their two jobs (see STAFF_ALLOWED). Enforced here,
  // before any route runs, so a route that forgets its role guard still stays
  // closed to them.
  if (!staffMayReach(user.role, req.method, `${req.baseUrl}${req.path}`)) {
    return next(
      new AppError(
        user.role === 'DEALER_VIEWER'
          ? 'Your account can only look up customers to contact them. Ask the shop owner.'
          : 'Your account can only look up customers, record payments, make sales and connect phones. Ask the shop owner.',
        403,
        { code: user.role === 'DEALER_VIEWER' ? 'VIEW_ONLY' : 'STAFF_LIMITED' }
      )
    );
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
});

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
/** Everyone on the shop's side, view-only staff included. For reads only. */
export const requireShopTeam = requireRole('SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'DEALER_VIEWER');
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
export async function resolveWritableDealerId(req: Request, bodyDealerId?: unknown): Promise<string> {
  const user = getAuthUser(req);

  if (user.role === 'SUPER_ADMIN') {
    const target = bodyDealerId ?? req.query.dealerId;
    if (!target || target === 'all') {
      throw AppError.badRequest('As a super admin you must specify which dealerId this record belongs to.');
    }
    if (!(await repo.dealers.findById(String(target)))) {
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
