import { Router } from 'express';

import { db } from '../db/db.js';
import { LicenseKey, Dealer, Device } from '../types/index.js';
import { requireDealerAdmin, resolveDealerScope } from '../middleware/auth.js';

export const licensesRouter = Router();

// Licensing is commercial information — staff and customers have no need for it.
licensesRouter.use(requireDealerAdmin);

licensesRouter.get('/', (req, res) => {
  const scope = resolveDealerScope(req);

  const dealersById = db.indexBy<Dealer>('dealers', (d) => d.id);
  const devicesByDealer = db.groupBy<Device>('devices', (d) => d.dealerId);
  const today = new Date().toISOString().split('T')[0];

  const licenses = db.find<LicenseKey>('licenseKeys', (l) => (scope === null ? true : l.dealerId === scope));

  const enriched = licenses.map((l) => {
    const dealer = dealersById.get(l.dealerId);
    // Removed devices no longer occupy a licence slot.
    const active = (devicesByDealer.get(l.dealerId) ?? []).filter((d) => d.status !== 'REMOVED');
    const used = active.length;
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
});
