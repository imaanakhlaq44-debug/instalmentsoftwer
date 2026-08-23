import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { repo } from '../db/repositories/index.js';
import { runInTransaction, type Tx } from '../db/prisma.js';
import { DeviceLicense, LicensePack } from '../types/index.js';
import { AppError } from '../utils/AppError.js';

/**
 * Licensing.
 *
 * A licence is one lock for one handset. It is bought in a pack, spent at
 * enrolment on exactly one IMEI, and never returned — a device that is paid
 * off, removed or swapped does not give its lock back. That is the commercial
 * model, and everything here exists to make it true even when two people are
 * enrolling phones at the same counter at the same second.
 *
 * The rule is enforced in three places, deliberately overlapping:
 *
 *   1. A unique index on `device_id`, so a device physically cannot hold two.
 *   2. A compare-and-set claim, so two concurrent enrolments cannot both take
 *      the same free lock.
 *   3. This service, which is the only code allowed to spend one.
 */

export interface PackOption {
  size: number;
  /** Rupees per lock. Bigger packs are cheaper per handset. */
  unitPrice: number;
  totalPrice: number;
}

/**
 * What the platform sells today.
 *
 * A pack records the price it was actually sold at, so changing this list never
 * rewrites what a dealer already paid.
 */
export const PACK_OPTIONS: PackOption[] = [
  { size: 30, unitPrice: 800, totalPrice: 24_000 },
  { size: 50, unitPrice: 700, totalPrice: 35_000 },
  { size: 100, unitPrice: 600, totalPrice: 60_000 },
];

export const findPackOption = (size: number): PackOption | undefined =>
  PACK_OPTIONS.find((p) => p.size === size);

/**
 * `ALMAS-L-7F3A-9C2E-B41D`.
 *
 * Random rather than sequential: a licence key is shown to the shop and printed
 * on their invoice, and a guessable one would let a dealer work out how many
 * locks the platform has sold in total.
 */
function mintKey(): string {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `ALMAS-L-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export interface IssuePackParams {
  dealerId: string;
  size: number;
  /** The shop's own payment reference — bank slip, JazzCash TID, receipt no. */
  reference?: string;
  actor: { id?: string; name: string };
  /**
   * Joins a transaction already in progress, which dealer sign-up needs: the
   * shop, its owner login and its first pack have to land together. Prisma has
   * no nested interactive transactions, so a caller that is already inside one
   * must pass it rather than let this open a second.
   */
  tx?: Tx;
}

export class LicenseService {
  /**
   * Records a purchase and mints its locks.
   *
   * The pack and every one of its licences land in one transaction: a pack that
   * exists with fewer locks than the dealer paid for is worse than no pack.
   */
  public static async issuePack(
    params: IssuePackParams
  ): Promise<{ pack: LicensePack; licenses: number }> {
    const option = findPackOption(params.size);
    if (!option) {
      throw AppError.badRequest(
        `Packs are sold in ${PACK_OPTIONS.map((p) => p.size).join(', ')} locks.`
      );
    }

    const dealer = await repo.dealers.findById(params.dealerId);
    if (!dealer) throw AppError.notFound('Dealer');

    const nowIso = new Date().toISOString();
    const packId = `pack-${uuidv4().substring(0, 8)}`;

    const mint = async (tx: Tx) => {
      const pack = await repo.licensePacks.create(
        {
          id: packId,
          dealerId: params.dealerId,
          size: option.size,
          unitPrice: option.unitPrice,
          totalPrice: option.totalPrice,
          reference: params.reference?.trim() || null,
          issuedById: params.actor.id ?? null,
          issuedByName: params.actor.name,
          createdAt: nowIso,
        },
        tx
      );

      const licenses: DeviceLicense[] = Array.from({ length: option.size }, () => ({
        id: `lic-${uuidv4().substring(0, 12)}`,
        dealerId: params.dealerId,
        packId,
        licenseKey: mintKey(),
        status: 'AVAILABLE' as const,
        deviceId: null,
        imei: null,
        consumedAt: null,
        createdAt: nowIso,
      }));

      await repo.deviceLicenses.createMany(licenses, tx);

      return { pack, licenses: licenses.length };
    };

    return params.tx ? mint(params.tx) : runInTransaction(mint);
  }

  /** How many locks this dealer can still spend. */
  public static countAvailable(dealerId: string, tx?: Tx): Promise<number> {
    return repo.deviceLicenses.countAvailable(dealerId, tx);
  }

  /**
   * Spends one lock on a handset.
   *
   * Returns the licence the device already holds when it has one, which is what
   * makes re-enrolment free: a factory reset, a replaced DPC or a repeated QR
   * scan puts the same phone through here again, and the shop is not charged
   * twice for the same handset.
   *
   * Throws when the dealer has none left. It throws rather than enrolling on
   * credit, because an enrolled device with no licence behind it is exactly the
   * state this model exists to prevent.
   */
  public static async claimForDevice(params: {
    dealerId: string;
    deviceId: string;
    imei: string;
    tx?: Tx;
  }): Promise<{ license: DeviceLicense; alreadyHeld: boolean }> {
    const existing = await repo.deviceLicenses.findByDevice(params.deviceId, params.tx);
    if (existing) {
      return { license: existing, alreadyHeld: true };
    }

    /**
     * Claim by compare-and-set.
     *
     * `updateMany` filtered on the row still being AVAILABLE is atomic, so of
     * two enrolments racing for the last lock exactly one wins and the other
     * comes back here for the next candidate. Reading a free licence and then
     * writing to it would let both take the same one.
     */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await repo.deviceLicenses.findFirstAvailable(params.dealerId, params.tx);
      if (!candidate) break;

      const claimed = await repo.deviceLicenses.claim(
        candidate.id,
        {
          status: 'CONSUMED',
          deviceId: params.deviceId,
          imei: params.imei,
          consumedAt: new Date().toISOString(),
        },
        params.tx
      );

      if (claimed) {
        return { license: claimed, alreadyHeld: false };
      }
    }

    throw AppError.badRequest(
      'You have no device locks left. Each handset needs its own lock, and locks are not returned when a plan is paid off. Buy a pack to enrol more phones.'
    );
  }

  /** The licence position of one dealership, as the settings and licence pages show it. */
  public static async summaryFor(dealerId: string): Promise<{
    available: number;
    consumed: number;
    void: number;
    total: number;
    packs: LicensePack[];
    spent: number;
  }> {
    const [available, consumed, voided, packs] = await Promise.all([
      repo.deviceLicenses.countAvailable(dealerId),
      repo.deviceLicenses.countByStatus(dealerId, 'CONSUMED'),
      repo.deviceLicenses.countByStatus(dealerId, 'VOID'),
      repo.licensePacks.findByDealer(dealerId),
    ]);

    return {
      available,
      consumed,
      void: voided,
      total: available + consumed + voided,
      packs,
      spent: packs.reduce((sum, p) => sum + p.totalPrice, 0),
    };
  }
}
