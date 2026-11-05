import { ContractService } from './ContractService.js';
import { ContractSnapshot, termsDiscloseStagedRestrictions } from './contractTerms.js';
import { Contract, Device, DevicePolicy, Installment } from '../types/index.js';

/**
 * Staged restrictions: a lighter touch for the first missed installments.
 *
 *   level 0  nothing                     (everything paid, or within grace)
 *   level 1  outgoing calls and SMS off  (one installment past grace)
 *   level 2  + social and video apps off (two past grace)
 *   full lock                            (three past grace, or the last one)
 *
 * What the business asked for was "one SIM off, then both SIMs off". Android
 * gives a device-owner app no way to switch off a single SIM slot — only the
 * carrier or the OEM firmware can — so the closest honest equivalent is used:
 * restrictions the platform does let a device owner apply, every one of which
 * leaves emergency calls and incoming calls working.
 *
 * As with every restriction here, the server decides and the phone obeys. The
 * handset is sent a level number and the package list; it never reasons about
 * consent or policy itself.
 */

/** Apps suspended at level 2. Only those actually installed are touched. */
export const RESTRICTED_APPS: readonly string[] = [
  'com.whatsapp',
  'com.whatsapp.w4b',
  'com.facebook.katana',
  'com.facebook.lite',
  'com.facebook.orca',
  'com.instagram.android',
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
  'com.google.android.youtube',
  'com.snapchat.android',
  'com.imo.android.imoim',
  'org.telegram.messenger',
];

/** How many installments past grace before the phone is fully locked. */
export const FULL_LOCK_AT = 3;

/** Overdue installments counted the way the engine marks them. */
export function overdueCount(installments: Pick<Installment, 'status'>[]): number {
  return installments.filter((i) => i.status === 'OVERDUE').length;
}

/**
 * Whether the plan has reached a full lock under staged restrictions: three
 * installments past grace, or the final installment past grace (a plan of two
 * would otherwise never reach three).
 */
export function stagedFullLockDue(
  installments: Pick<Installment, 'status' | 'installmentNumber'>[]
): boolean {
  const overdue = installments.filter((i) => i.status === 'OVERDUE');
  if (overdue.length >= FULL_LOCK_AT) return true;
  const last = Math.max(0, ...installments.map((i) => i.installmentNumber));
  return overdue.some((i) => i.installmentNumber === last);
}

/** The level a handset should be at, from its overdue count alone. 0, 1 or 2. */
export function levelForOverdue(count: number): 0 | 1 | 2 {
  if (count <= 0) return 0;
  return count === 1 ? 1 : 2;
}

/**
 * The level this handset is permitted and required to apply right now.
 *
 * Zero unless all of these hold: the dealer has staged restrictions and
 * automatic enforcement on, the customer signed a valid contract, and that
 * contract's terms (v1.2+) describe the stages and had them on at signing.
 */
export async function restrictionLevelFor(
  device: Device,
  policy: DevicePolicy,
  installments: Pick<Installment, 'status'>[]
): Promise<0 | 1 | 2> {
  if (!policy.stagedRestrictionsEnabled || !policy.autoLockEnabled) return 0;

  const level = levelForOverdue(overdueCount(installments));
  if (level === 0) return 0;

  const consent = await ContractService.consentForDevice(device.id);
  if (!consent.allowed || !consent.contract) return 0;
  if (!termsDiscloseStagedRestrictions(consent.contract.termsVersion)) return 0;
  if (!signedStages(consent.contract)?.enabled) return 0;

  return level;
}

function signedStages(contract: Contract): ContractSnapshot['stagedRestrictions'] {
  try {
    return (JSON.parse(contract.snapshot) as ContractSnapshot).stagedRestrictions;
  } catch {
    return undefined;
  }
}
