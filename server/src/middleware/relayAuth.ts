import { Request, Response, NextFunction } from 'express';

import { repo } from '../db/repositories/index.js';
import { SmsRelay } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './errorHandler.js';
import { hashDeviceToken, deviceTokenMatches } from '../utils/deviceToken.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The paired phone behind a relay request. Set by `requireRelay`. */
      relay?: SmsRelay;
    }
  }
}

/**
 * Parses `Authorization: Relay <relayId>.<token>`.
 *
 * Same shape as the DPC's scheme, for the same reasons: the id travels with the
 * secret so the lookup is one indexed read, and a token presented for the wrong
 * relay is rejected outright rather than quietly matching another one.
 */
function parseRelayAuthorization(header: string | undefined): { relayId: string; token: string } | null {
  if (!header || !header.startsWith('Relay ')) return null;

  const credential = header.slice('Relay '.length).trim();
  const separator = credential.indexOf('.');
  if (separator <= 0 || separator === credential.length - 1) return null;

  return { relayId: credential.slice(0, separator), token: credential.slice(separator + 1) };
}

/**
 * Authenticates a paired phone, not a person.
 *
 * A relay is a shop's own handset sitting on a counter. It must never hold a
 * staff token: it can read the queued messages of one dealership and report on
 * them, and that is the entire extent of its authority.
 */
export const requireRelay = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const credential = parseRelayAuthorization(req.headers.authorization);
  if (!credential) {
    return next(AppError.unauthorized('Relay authentication required.'));
  }

  const relay = await repo.smsRelays.findById(credential.relayId);

  // One message for every failure: an unknown id and a wrong token must be
  // indistinguishable to anyone probing the endpoint.
  const rejected = () => next(AppError.unauthorized('Relay credentials are not valid.'));

  if (!relay || !relay.tokenHash) return rejected();
  if (!deviceTokenMatches(hashDeviceToken(credential.token), relay.tokenHash)) return rejected();

  if (relay.revokedAt) {
    return next(AppError.forbidden('This phone has been unpaired.'));
  }

  req.relay = relay;
  next();
});

export function getRelay(req: Request): SmsRelay {
  if (!req.relay) throw AppError.unauthorized('Relay authentication required.');
  return req.relay;
}
