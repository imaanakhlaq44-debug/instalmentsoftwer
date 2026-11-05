import { Router } from 'express';

import { prisma } from '../db/prisma.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { priceForPack } from '../services/LicenseService.js';

/**
 * The platform owner's view.
 *
 * A shop owner's dashboard answers "who do I chase today". The super admin runs
 * the platform instead, so their questions are different: which new shops are
 * waiting to pay, which shops are about to run out of locks, what the platform
 * has earned, and whether the fleet of handsets is healthy. Every figure here is
 * computed in the database, across all dealerships.
 */
export const platformRouter = Router();

platformRouter.use(requireSuperAdmin);

/** A handset this long without a check-in is worth a look. */
const STALE_DAYS = 3;
/** Fewer locks than this left, and the shop should be told before it runs out. */
const RUNNING_LOW_AT = 5;
/** Device states that mean "this phone is under management". */
const MANAGED = ['ENROLLED', 'ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING'] as const;

platformRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const staleBefore = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);

    const [dealers, packs, licenceCounts, deviceCounts, staleDevices] = await Promise.all([
      prisma.dealer.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.licensePack.findMany({
        select: { dealerId: true, size: true, totalPrice: true, createdAt: true },
      }),
      prisma.deviceLicense.groupBy({ by: ['dealerId', 'status'], _count: { _all: true } }),
      prisma.device.groupBy({ by: ['dealerId', 'status'], _count: { _all: true } }),
      prisma.device.count({
        where: { status: { in: [...MANAGED] }, lastSeen: { lt: staleBefore } },
      }),
    ]);

    const licences = (dealerId: string, status: string) =>
      licenceCounts.find((c) => c.dealerId === dealerId && c.status === status)?._count._all ?? 0;
    const devices = (dealerId: string, status?: string) =>
      deviceCounts
        .filter((c) => c.dealerId === dealerId && (!status || c.status === status))
        .reduce((sum, c) => sum + c._count._all, 0);

    const shops = dealers.map((d) => {
      const own = packs.filter((p) => p.dealerId === d.id);
      const available = licences(d.id, 'AVAILABLE');
      const lastPack = own.reduce<Date | null>((latest, p) => (!latest || p.createdAt > latest ? p.createdAt : latest), null);
      return {
        dealerId: d.id,
        name: d.name,
        ownerName: d.ownerName,
        phone: d.phone,
        email: d.email,
        city: d.city,
        active: d.active,
        createdAt: d.createdAt.toISOString(),
        available,
        consumed: licences(d.id, 'CONSUMED'),
        packsBought: own.length,
        billed: own.reduce((sum, p) => sum + p.totalPrice, 0),
        lastPackAt: lastPack ? lastPack.toISOString() : null,
        devices: {
          total: devices(d.id),
          locked: devices(d.id, 'LOCKED'),
          overdue: devices(d.id, 'OVERDUE'),
        },
        outOfLocks: own.length > 0 && available === 0,
        runningLow: available > 0 && available <= RUNNING_LOW_AT,
        requestedPack: d.requestedPackSize ? priceForPack(d.requestedPackSize) ?? null : null,
      };
    });

    const awaitingPayment = shops
      .filter((s) => s.requestedPack && s.packsBought === 0)
      .map(({ dealerId, name, ownerName, phone, email, city, createdAt, requestedPack }) => ({
        dealerId,
        name,
        ownerName,
        phone,
        email,
        city,
        createdAt,
        requestedPack,
      }));

    const thisMonth = packs.filter((p) => p.createdAt >= monthStart);
    const fleetByStatus: Record<string, number> = {};
    for (const c of deviceCounts) fleetByStatus[c.status] = (fleetByStatus[c.status] ?? 0) + c._count._all;

    res.json({
      totals: {
        shops: dealers.length,
        shopsAwaitingPayment: awaitingPayment.length,
        locksSold: packs.reduce((sum, p) => sum + p.size, 0),
        locksSoldThisMonth: thisMonth.reduce((sum, p) => sum + p.size, 0),
        revenue: packs.reduce((sum, p) => sum + p.totalPrice, 0),
        revenueThisMonth: thisMonth.reduce((sum, p) => sum + p.totalPrice, 0),
        locksAvailable: shops.reduce((sum, s) => sum + s.available, 0),
        locksConsumed: shops.reduce((sum, s) => sum + s.consumed, 0),
      },
      awaitingPayment,
      shops,
      fleet: { byStatus: fleetByStatus, stale: staleDevices, staleAfterDays: STALE_DAYS },
    });
  })
);
