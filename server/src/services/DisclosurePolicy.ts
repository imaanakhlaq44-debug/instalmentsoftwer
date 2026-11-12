import { repo } from '../db/repositories/index.js';
import { ContractService } from './ContractService.js';
import { termsDiscloseIntegrityChecks, termsDiscloseResetProtection } from './contractTerms.js';
import { Device } from '../types/index.js';

/**
 * Whether the customer holding a handset was told about two things the app
 * does to it, and so whether this server may take part in them.
 *
 * Both are disclosed from terms v1.4. They are answered the way
 * `offlineLockDaysFor` answers the offline rule: the handset never reasons
 * about contracts, it is simply told less. A customer on v1.3 or earlier gets
 * "no" to both until they sign the current agreement.
 */

/**
 * Hardware identity and integrity signals (IMEI and serial read-back, root and
 * bootloader state, secure-chip attestation), and the restriction that follows
 * tampering.
 *
 * This asks which terms the handset's agreement is written on, not whether it
 * is currently enforceable: a shop is still told about a tampered phone whose
 * v1.4 agreement was voided or is waiting for a signature at the counter.
 * Acting on it is a separate question — the tamper lock additionally needs
 * valid consent, like every other lock. Where the agreement predates v1.4, or
 * there is none, the server drops the signals unread and unstored.
 */
export async function integrityChecksDisclosedFor(device: Device): Promise<boolean> {
  if (device.noLock) return false;
  const contract = await repo.contracts.findByDevice(device.id);
  return contract !== null && contract !== undefined && termsDiscloseIntegrityChecks(contract.termsVersion);
}

/**
 * Factory-reset protection: whether the shop's Google account ids may be sent
 * to this handset. An empty list makes the app remove the protection.
 *
 * This one is enforcement — it decides who can set the phone up after a wipe —
 * so it needs what a lock needs: a valid signed agreement, on terms that say so.
 */
export async function resetProtectionDisclosedFor(device: Device): Promise<boolean> {
  if (device.noLock) return false;
  const consent = await ContractService.consentForDevice(device.id);
  return consent.allowed && !!consent.contract && termsDiscloseResetProtection(consent.contract.termsVersion);
}
