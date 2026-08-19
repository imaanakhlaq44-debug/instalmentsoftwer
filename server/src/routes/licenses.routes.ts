import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy, dealerScope } from '../db/repositories/index.js';
import { Dealer, DeviceLicense } from '../types/index.js';
import { LicenseService, PACK_OPTIONS } from '../services/LicenseService.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerAdmin, requireSuperAdmin, getAuthUser, resolveDealerScope, clientIp, routeParam,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';

export const licensesRouter = Router();

// Licensing is commercial information — staff and customers have no need for it.
licensesRouter.use(requireDealerAdmin);

/**
 * The licence position: locks bought, locks spent, locks left.
 *
 * A super admin sees every dealership, a shop owner sees their own. Both read
 * the same shape, so the page does not branch on role to find its numbers.
 */
licensesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);

    const [packs, licenses] = await Promise.all([
      repo.licensePacks.findMany({ where: dealerScope(scope), orderBy: { createdAt: 'desc' } }),
      repo.deviceLicenses.findMany({ where: dealerScope(scope) }),
    ]);

    const dealerIds = [...new Set([...packs, ...licenses].map((r) => r.dealerId))];
    const dealersById = indexBy<Dealer>(await repo.dealers.findByIds(dealerIds), (d) => d.id);

    const countFor = (dealerId: string, status: DeviceLicense['status']) =>
      licenses.filter((l) => l.dealerId === dealerId && l.status === status).length;

    const dealerSummaries = dealerIds.map((id) => {
      const available = countFor(id, 'AVAILABLE');
      const consumed = countFor(id, 'CONSUMED');
      const voided = countFor(id, 'VOID');
      const total = available + consumed + voided;
      const dealerPacks = packs.filter((p) => p.dealerId === id);

      return {
        dealerId: id,
        dealerName: dealersById.get(id)?.name ?? 'Unknown dealer',
        dealerCity: dealersById.get(id)?.city ?? 'N/A',
        available,
        consumed,
        void: voided,
        total,
        packsBought: dealerPacks.length,
        spent: dealerPacks.reduce((sum, p) => sum + p.totalPrice, 0),
        // The bar on the page: how much of what they bought is already spent.
        utilizationPercentage: total > 0 ? Math.round((consumed / total) * 100) : 0,
        outOfLocks: available === 0,
        // A shop that cannot enrol tomorrow's sale should be told today.
        runningLow: available > 0 && available <= 5,
      };
    });

    res.json({
      dealers: dealerSummaries,
      packs: packs.map((p) => ({
        ...p,
        dealerName: dealersById.get(p.dealerId)?.name ?? 'Unknown dealer',
        // Of this pack's own locks, how many are already on a handset.
        consumed: licenses.filter((l) => l.packId === p.id && l.status === 'CONSUMED').length,
      })),
      catalogue: PACK_OPTIONS,
    });
  })
);

/**
 * Every lock in one pack, with the handset each was spent on.
 *
 * This is the audit a dealer asks for when they want to know where 100 locks
 * went, so it names the device and the IMEI rather than only a count.
 */
licensesRouter.get(
  '/packs/:id',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const pack = await repo.licensePacks.findById(routeParam(req, 'id'));
    if (!pack) throw AppError.notFound('Licence pack');

    if (user.role !== 'SUPER_ADMIN' && pack.dealerId !== user.dealerId) {
      throw AppError.notFound('Licence pack');
    }

    const licenses = await repo.deviceLicenses.findByPack(pack.id);
    const deviceIds = licenses.map((l) => l.deviceId).filter((id): id is string => Boolean(id));
    const devicesById = indexBy(await repo.devices.findByIds(deviceIds), (d) => d.id);

    res.json({
      pack,
      licenses: licenses.map((l) => {
        const device = l.deviceId ? devicesById.get(l.deviceId) : undefined;
        return {
          ...l,
          deviceName: device ? `${device.brand} ${device.model}` : null,
        };
      }),
    });
  })
);

/**
 * Records a pack purchase and mints its locks.
 *
 * Super admin only, and deliberately so: there is no payment gateway, so this
 * endpoint is the platform confirming money actually arrived. A dealer who
 * could call it could mint themselves free locks.
 */
const issueSchema = z.object({
  dealerId: z.string().trim().min(1).max(64),
  size: z.number().int(),
  reference: z.string().trim().max(80).optional(),
});

licensesRouter.post(
  '/packs',
  requireSuperAdmin,
  validateBody(issueSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof issueSchema>;

    const { pack, licenses } = await LicenseService.issuePack({
      dealerId: body.dealerId,
      size: body.size,
      reference: body.reference,
      actor: { id: user.userId, name: user.name },
    });

    await AuditService.log({
      dealerId: body.dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'LICENSE_PACK_ISSUED',
      targetType: 'LICENSE_PACK',
      targetId: pack.id,
      details:
        `Issued a pack of ${pack.size} device locks at Rs ${pack.unitPrice} each ` +
        `(Rs ${pack.totalPrice} total)${pack.reference ? `, reference ${pack.reference}` : ''}.`,
      ipAddress: clientIp(req),
    });

    res.status(201).json({ pack, licenses, message: `${licenses} device locks are ready to use.` });
  })
);
