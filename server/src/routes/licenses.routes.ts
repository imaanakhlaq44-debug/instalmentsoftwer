import { Router } from 'express';

import { repo, indexBy, dealerScope } from '../db/repositories/index.js';
import { Dealer } from '../types/index.js';
import { requireDealerAdmin, resolveDealerScope } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const licensesRouter = Router();

// Licensing is commercial information — staff and customers have no need for it.
licensesRouter.use(requireDealerAdmin);

licensesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);
    const today = new Date().toISOString().split('T')[0];

    const licenses = await repo.licenseKeys.findMany({ where: dealerScope(scope) });
    if (licenses.length === 0) {
      res.json([]);
      return;
    }

    const dealerIds = [...new Set(licenses.map((l) => l.dealerId))];
    const dealersById = indexBy<Dealer>(await repo.dealers.findByIds(dealerIds), (d) => d.id);

    // One COUNT per dealer, run together, rather than loading every device row
    // just to measure how many slots are occupied.
    const usage = new Map(
      await Promise.all(
        dealerIds.map(async (id): Promise<[string, number]> => [
          id,
          await repo.devices.countActiveForDealer(id),
        ])
      )
    );

    const enriched = licenses.map((l) => {
      const dealer = dealersById.get(l.dealerId);
      // Removed devices no longer occupy a licence slot.
      const used = usage.get(l.dealerId) ?? 0;
      const expired = l.expiryDate < today;
      const daysUntilExpiry = Math.ceil(
        (new Date(l.expiryDate).getTime() - new Date(today).getTime()) / 86_400_000
      );

      return {
        ...l,
        usedDevices: used,
        availableDevices: Math.max(0, l.deviceLimit - used),
        utilizationPercentage: l.deviceLimit > 0 ? Math.min(100, Math.round((used / l.deviceLimit) * 100)) : 0,
        dealerName: dealer?.name ?? 'Unknown Dealer',
        dealerCity: dealer?.city ?? 'N/A',
        // Report the real state rather than the stored flag, which drifts.
        status: expired ? 'EXPIRED' : l.status,
        isExpired: expired,
        daysUntilExpiry,
        expiringSoon: !expired && daysUntilExpiry <= 30,
        atCapacity: used >= l.deviceLimit,
      };
    });

    res.json(enriched);
  })
);
