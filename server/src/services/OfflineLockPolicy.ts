import { ContractService } from './ContractService.js';
import { ContractSnapshot, termsDiscloseOfflineLock } from './contractTerms.js';
import { Contract, Device, DevicePolicy } from '../types/index.js';

/**
 * Whether a given handset is permitted to restrict itself, and after how long.
 *
 * The offline rule is the one restriction this server does not apply, because
 * the phone it applies to is by definition out of reach. What the server keeps
 * is the *permission*: it answers a single number, and the handset does nothing
 * but obey it. That keeps consent, dealer policy and contract versions on this
 * side of the wire, where they can be audited, rather than being re-derived on
 * a phone that has no way to check any of them.
 *
 * This is the offline counterpart of the consent check inside
 * `DeviceManagementService.lockDevice`, and it is deliberately stricter.
 */
export async function offlineLockDaysFor(device: Device, policy: DevicePolicy): Promise<number> {
  const days = policy.offlineLockAfterDays ?? 0;

  // Not configured at all.
  if (days <= 0) return 0;

  // A shop that locks by hand does not get a rule that fires with nobody
  // deciding, however many days it has entered.
  if (!policy.autoLockEnabled) return 0;

  // The same question every lock passes through: no contract, an unsigned one,
  // a voided one, or one whose hash no longer matches all mean nobody has
  // agreed to this handset being restricted.
  const consent = await ContractService.consentForDevice(device.id);
  if (!consent.allowed || !consent.contract) return 0;

  // A contract signed under terms v1.0 says a handset may be restricted for
  // non-payment. It does not say the phone has to keep reporting in. Acting on
  // an undisclosed rule is precisely what the consent feature exists to stop.
  if (!termsDiscloseOfflineLock(consent.contract.termsVersion)) return 0;

  const signed = signedOfflineLock(consent.contract);
  if (!signed?.enabled || signed.afterDays <= 0) return 0;

  // Never shorter than the figure printed on the contract in the customer's
  // hand. A dealer may relax the rule for everybody at any time; tightening it
  // afterwards would enforce a number this customer never agreed to.
  return Math.max(days, signed.afterDays);
}

/** The offline rule as it was printed on the contract the customer signed. */
function signedOfflineLock(contract: Contract): ContractSnapshot['offlineLock'] {
  try {
    return (JSON.parse(contract.snapshot) as ContractSnapshot).offlineLock;
  } catch {
    // A snapshot that will not parse cannot be shown to have disclosed
    // anything, so it discloses nothing.
    return undefined;
  }
}
