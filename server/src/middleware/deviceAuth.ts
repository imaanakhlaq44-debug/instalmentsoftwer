import { Request, Response, NextFunction } from 'express';

import { repo } from '../db/repositories/index.js';
import { Device } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './errorHandler.js';
import { hashDeviceToken, deviceTokenMatches, parseDeviceAuthorization } from '../utils/deviceToken.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The handset behind a DPC request. Set by `requireDevice`. */
      device?: Device;
    }
  }
}

/**
 * Statuses a phone may not authenticate from.
 *
 * A repossessed or retired handset keeps its row for the audit trail, but its
 * credentials stop working — otherwise a device released to a new owner would
 * still be taking policy from the old dealer.
 */
const REVOKED_STATUSES = new Set(['REMOVED', 'INACTIVE']);

/**
 * Authenticates the Device Policy Controller, not a person.
 *
 * This is a separate scheme from the dashboard's JWT on purpose: a phone has no
 * user session, must not hold a staff token, and its credential should be
 * revocable on its own. Compromising one handset must not reach the dealership.
 */
export const requireDevice = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const credential = parseDeviceAuthorization(req.headers.authorization);
  if (!credential) {
    return next(AppError.unauthorized('Device authentication required.'));
  }

  const device = await repo.devices.findById(credential.deviceId);

  // One message for every failure below: an unenrolled device, a wrong token
  // and an unknown id must be indistinguishable to a caller probing the API.
  const rejected = () => next(AppError.unauthorized('Device credentials are not valid.'));

  if (!device || !device.authTokenHash) return rejected();
  if (!deviceTokenMatches(hashDeviceToken(credential.token), device.authTokenHash)) return rejected();

  if (REVOKED_STATUSES.has(device.status)) {
    return next(AppError.forbidden('This device is no longer under management.'));
  }

  req.device = device;
  next();
});

export function getDevice(req: Request): Device {
  if (!req.device) throw AppError.unauthorized('Device authentication required.');
  return req.device;
}
