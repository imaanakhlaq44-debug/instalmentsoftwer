import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { repo } from '../db/repositories/index.js';
import { Tx } from '../db/prisma.js';
import { AuditService } from './AuditService.js';
import { DEFAULT_POLICY } from './InstallmentMath.js';
import { AppError } from '../utils/AppError.js';
import { Contract, Installment, InstallmentPlan, UserRole } from '../types/index.js';
import {
  CURRENT_TERMS_VERSION,
  ContractSnapshot,
  DECLARATION,
  renderClauses,
} from './contractTerms.js';

/**
 * The customer's consent, recorded.
 *
 * The system can restrict a handset somebody is paying for. That is a serious
 * thing to do on the strength of a conversation at a counter, so it now rests
 * on a document: the terms as they stood, the figures as they stood, and a
 * signature against both.
 *
 * Two rules hold the whole thing together:
 *
 *  1. **The terms are versioned and never edited in place.** A contract renders
 *     from the version it was signed under, so an old signature keeps meaning
 *     what it meant.
 *  2. **What is enforced is compared against what was signed.** The hash proves
 *     the stored record has not been altered; `planDrift` proves the plan still
 *     matches the one frozen into it. Restructuring after signing therefore
 *     fails the second check rather than quietly changing what somebody agreed
 *     to — and both failures are surfaced, not swallowed.
 */

export interface ContractActor {
  userId: string;
  userName: string;
  userRole: UserRole;
}

/** `a`, `a and b`, `a, b and c` — the changed terms read as a sentence. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The schedule reduced to what was promised: which installment, how much, and
 * when. Amount *paid*, late fees and status are all left out — they change as
 * a plan is repaid, and none of them is a term anybody agreed to.
 */
function currentSchedule(installments: Installment[]): ContractSnapshot['schedule'] {
  return installments
    .slice()
    .sort((a, b) => a.installmentNumber - b.installmentNumber)
    .map((i) => ({
      installmentNumber: i.installmentNumber,
      amountDue: i.amountDue,
      dueDate: i.dueDate,
    }));
}

/** One comparable string, so a reordered or resized schedule cannot slip past. */
function scheduleKey(rows: ContractSnapshot['schedule']): string {
  return rows
    .slice()
    .sort((a, b) => a.installmentNumber - b.installmentNumber)
    .map((r) => `${r.installmentNumber}:${r.amountDue}:${r.dueDate}`)
    .join('|');
}

export class ContractService {
  /**
   * Drafts the contract for a newly registered sale.
   *
   * Called inside the registration transaction: a financed device that exists
   * with no contract to sign is exactly the gap this feature closes.
   */
  public static async createDraft(
    params: {
      dealerId: string;
      customerId: string;
      deviceId: string;
      plan: InstallmentPlan;
      installments: Installment[];
    },
    tx?: Tx
  ): Promise<Contract> {
    const snapshot = await this.buildSnapshot(params, tx);

    return repo.contracts.create(
      {
        id: `ctr-${uuidv4().substring(0, 8)}`,
        dealerId: params.dealerId,
        customerId: params.customerId,
        deviceId: params.deviceId,
        planId: params.plan.id,
        termsVersion: CURRENT_TERMS_VERSION,
        snapshot: JSON.stringify(snapshot),
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
      },
      tx
    );
  }

  /**
   * Records the signature.
   *
   * The snapshot is rebuilt from the plan as it stands *now* and written back
   * before hashing, so what is signed is what the customer is looking at rather
   * than whatever the figures were when the draft was created — a plan edited
   * between registration and signing is a normal thing at a counter.
   */
  public static async sign(
    params: {
      contractId: string;
      signerName: string;
      signatureImage: string;
      actor: ContractActor;
      ipAddress?: string;
    },
    tx?: Tx
  ): Promise<Contract> {
    const contract = await this.require(params.contractId, tx);

    if (contract.status === 'SIGNED') {
      throw AppError.conflict('This contract has already been signed.');
    }
    if (contract.status === 'VOID') {
      throw AppError.badRequest('This contract was voided. Issue a new one before signing.');
    }
    if (!params.signatureImage.startsWith('data:image/png;base64,')) {
      throw AppError.badRequest('The signature must be a PNG image drawn on screen.');
    }

    const plan = await repo.installmentPlans.findById(contract.planId, tx);
    if (!plan) throw AppError.notFound('Installment plan');
    const installments = await repo.installments.findByPlan(plan.id, tx);

    const snapshot = await this.buildSnapshot(
      {
        dealerId: contract.dealerId,
        customerId: contract.customerId,
        deviceId: contract.deviceId,
        plan,
        installments,
      },
      tx
    );

    const snapshotJson = JSON.stringify(snapshot);
    const nowIso = new Date().toISOString();

    const signed = await repo.contracts.update(
      contract.id,
      {
        snapshot: snapshotJson,
        status: 'SIGNED',
        signedAt: nowIso,
        signerName: params.signerName,
        signatureImage: params.signatureImage,
        signedIp: params.ipAddress,
        documentHash: this.hash(contract.termsVersion, snapshotJson),
      },
      tx
    );

    await AuditService.log(
      {
        dealerId: contract.dealerId,
        userId: params.actor.userId,
        actorName: params.actor.userName,
        actorRole: params.actor.userRole,
        action: 'CONTRACT_SIGNED',
        targetType: 'CONTRACT',
        targetId: contract.id,
        details:
          `${params.signerName} signed the financing agreement (terms v${contract.termsVersion}) for ` +
          `${snapshot.device.brand} ${snapshot.device.model}, including consent to device restriction.`,
        ipAddress: params.ipAddress,
      },
      tx
    );

    return signed ?? contract;
  }

  public static async void(params: {
    contractId: string;
    reason: string;
    actor: ContractActor;
    ipAddress?: string;
  }): Promise<Contract> {
    const contract = await this.require(params.contractId);

    const voided = await repo.contracts.update(contract.id, {
      status: 'VOID',
      voidedAt: new Date().toISOString(),
      voidReason: params.reason,
    });

    await AuditService.log({
      dealerId: contract.dealerId,
      userId: params.actor.userId,
      actorName: params.actor.userName,
      actorRole: params.actor.userRole,
      action: 'CONTRACT_VOIDED',
      targetType: 'CONTRACT',
      targetId: contract.id,
      // A voided contract means the device can no longer be restricted, so the
      // reason matters to whoever reads this later.
      details: `${params.actor.userName} voided the financing agreement: ${params.reason}`,
      ipAddress: params.ipAddress,
    });

    return voided ?? contract;
  }

  /**
   * The document, ready to render or print.
   *
   * Two separate answers, because they are two separate failures.
   * `hashMatches` is false when the stored record has been altered since
   * signing. `planMatches` is false when the record is intact but the plan
   * being enforced has moved away from it, and `planChanges` names what moved.
   * Both are reported rather than hidden: a contract that no longer describes
   * the plan should be re-signed, and the shop needs to know that before it
   * relies on the old one.
   */
  public static async render(contractId: string): Promise<{
    contract: Contract;
    snapshot: ContractSnapshot;
    clauses: ReturnType<typeof renderClauses>;
    declaration: typeof DECLARATION;
    hashMatches: boolean | null;
    planMatches: boolean | null;
    planChanges: string[];
  }> {
    const contract = await this.require(contractId);
    const snapshot = JSON.parse(contract.snapshot) as ContractSnapshot;
    const planChanges = await this.planDrift(contract);

    return {
      contract,
      snapshot,
      // Rendered under the version this contract was signed with, not the
      // current one — that is what makes an old signature keep its meaning.
      clauses: renderClauses(snapshot, contract.termsVersion),
      declaration: DECLARATION,
      hashMatches: contract.documentHash
        ? contract.documentHash === this.hash(contract.termsVersion, contract.snapshot)
        : null,
      // A draft has nothing signed to drift from, so the question does not
      // apply rather than being answered "fine".
      planMatches: contract.status === 'SIGNED' ? planChanges.length === 0 : null,
      planChanges,
    };
  }

  /**
   * Whether this device may be restricted.
   *
   * The single question the lock asks. It is deliberately strict: no contract,
   * an unsigned one, a voided one, or one whose figures no longer match the
   * plan all mean the same thing — nobody has agreed to this handset being
   * locked in its present terms.
   */
  public static async consentForDevice(deviceId: string): Promise<{
    allowed: boolean;
    reason?: string;
    contract?: Contract;
  }> {
    const contract = await repo.contracts.findByDevice(deviceId);

    if (!contract) {
      return {
        allowed: false,
        reason:
          'No financing agreement exists for this device. A signed agreement recording the customer\'s consent ' +
          'is required before the handset can be restricted.',
      };
    }

    if (contract.status === 'DRAFT') {
      return {
        allowed: false,
        contract,
        reason:
          'The financing agreement for this device has not been signed. Have the customer sign it before ' +
          'restricting the handset.',
      };
    }

    if (contract.status === 'VOID') {
      return {
        allowed: false,
        contract,
        reason: `The financing agreement for this device was voided${contract.voidReason ? `: ${contract.voidReason}` : '.'}`,
      };
    }

    if (contract.documentHash !== this.hash(contract.termsVersion, contract.snapshot)) {
      return {
        allowed: false,
        contract,
        reason:
          'The stored financing agreement no longer matches its own signature — the record has been altered ' +
          'since it was signed. It must be re-issued and re-signed before the handset can be restricted.',
      };
    }

    /**
     * The check the hash cannot make.
     *
     * The hash is computed over the snapshot as stored, so it proves the row is
     * intact and nothing more — rewrite the plan and the contract's own figures
     * sit there unchanged, still hashing perfectly. What has to be asked is
     * whether the plan being enforced is still the plan that was signed, and
     * that means comparing the two.
     *
     * This is the abuse the whole consent feature exists to stop: sign somebody
     * up at one figure, restructure upward afterwards, then lock the phone for
     * non-payment of a number they never agreed to.
     */
    const drift = await this.planDrift(contract);
    if (drift.length > 0) {
      return {
        allowed: false,
        contract,
        reason:
          `The financing agreement no longer describes this plan — ${listOf(drift)} ` +
          `${drift.length === 1 ? 'has' : 'have'} changed since it was signed. A fresh agreement must be ` +
          'signed before the handset can be restricted.',
      };
    }

    return { allowed: true, contract };
  }

  /**
   * What has changed in the plan since the contract was signed.
   *
   * Returns the human names of the terms that differ, or an empty list when the
   * plan still matches. An unsigned contract has nothing to drift from.
   *
   * Only the figures the customer actually agreed to are compared. Payments,
   * late fees, waivers and status changes move constantly and none of them
   * alter what was promised, so none of them appear here — a customer paying an
   * installment must never look like a plan that was rewritten behind them.
   */
  public static async planDrift(contract: Contract): Promise<string[]> {
    if (contract.status !== 'SIGNED') return [];

    const plan = await repo.installmentPlans.findById(contract.planId);
    if (!plan) {
      // The plan a signed agreement names has gone. Nothing can be shown to
      // match it, so consent cannot rest on it.
      return ['the repayment plan itself'];
    }

    const installments = await repo.installments.findByPlan(plan.id);

    let signed: ContractSnapshot;
    try {
      signed = JSON.parse(contract.snapshot) as ContractSnapshot;
    } catch {
      return ['the agreement’s own record of the plan'];
    }

    const before = signed.plan;
    const now = plan;
    const changed: string[] = [];

    const compare = (label: string, a: unknown, b: unknown) => {
      if (a !== b) changed.push(label);
    };

    compare('the total price', before.totalAmount, now.totalAmount);
    compare('the down payment', before.downPayment, now.downPayment);
    compare('the financed amount', before.financedAmount, now.financedAmount);
    compare('the monthly installment', before.monthlyInstallment, now.monthlyInstallment);
    compare('the number of installments', before.totalInstallments, now.totalInstallments);
    compare('the first due date', before.firstDueDate, now.firstDueDate);
    compare('the grace period', before.gracePeriodDays, now.gracePeriodDays);

    if (scheduleKey(signed.schedule) !== scheduleKey(currentSchedule(installments))) {
      changed.push('the repayment schedule');
    }

    return changed;
  }

  // -----------------------------------------------------------------------

  private static async require(contractId: string, tx?: Tx): Promise<Contract> {
    const contract = await repo.contracts.findById(contractId, tx);
    if (!contract) throw AppError.notFound('Contract');
    return contract;
  }

  /** SHA-256 over the terms version and the frozen facts. */
  private static hash(termsVersion: string, snapshotJson: string): string {
    return crypto.createHash('sha256').update(`${termsVersion}\n${snapshotJson}`).digest('hex');
  }

  private static async buildSnapshot(
    params: {
      dealerId: string;
      customerId: string;
      deviceId: string;
      plan: InstallmentPlan;
      installments: Installment[];
    },
    tx?: Tx
  ): Promise<ContractSnapshot> {
    const [dealer, customer, device, policy] = await Promise.all([
      repo.dealers.findById(params.dealerId, tx),
      repo.customers.findById(params.customerId, tx),
      repo.devices.findById(params.deviceId, tx),
      repo.devicePolicies.findByDealer(params.dealerId, tx),
    ]);

    if (!dealer || !customer || !device) {
      throw AppError.badRequest('The contract cannot be prepared until the customer and device exist.');
    }

    const effective = policy ?? DEFAULT_POLICY;

    return {
      dealer: {
        name: dealer.name,
        code: dealer.code,
        phone: dealer.phone,
        address: dealer.address,
        city: dealer.city,
      },
      // The full CNIC and address belong here. This is the one document where
      // masking would be wrong: it is the customer's own copy of what they
      // signed, and an agreement identifying "***-*******-1" identifies nobody.
      customer: {
        name: customer.name,
        cnic: customer.cnic,
        phone: customer.phone,
        address: customer.address,
      },
      device: {
        brand: device.brand,
        model: device.model,
        imei: device.imei,
        color: device.color,
        ramStorage: device.ramStorage,
      },
      plan: {
        totalAmount: params.plan.totalAmount,
        downPayment: params.plan.downPayment,
        financedAmount: params.plan.financedAmount,
        monthlyInstallment: params.plan.monthlyInstallment,
        totalInstallments: params.plan.totalInstallments,
        firstDueDate: params.plan.firstDueDate,
        gracePeriodDays: params.plan.gracePeriodDays,
      },
      // Frozen with everything else, and clause 4 of terms v1.1 prints the day
      // count from here. It is what the customer actually agreed to, so the DPC
      // route will not hand a handset a shorter limit than this one however the
      // dealer's live policy is edited afterwards.
      offlineLock: {
        enabled: effective.autoLockEnabled === true && (effective.offlineLockAfterDays ?? 0) > 0,
        afterDays: effective.offlineLockAfterDays ?? 0,
      },
      lateFee: {
        enabled: effective.lateFeeEnabled !== false,
        type: effective.lateFeeType ?? 'FIXED',
        amount: effective.lateFeeAmount ?? 0,
        frequency: effective.lateFeeFrequency ?? 'ONE_TIME',
        maxPerInstallment: effective.lateFeeMaxPerInstallment,
      },
      schedule: params.installments
        .slice()
        .sort((a, b) => a.installmentNumber - b.installmentNumber)
        .map((i) => ({
          installmentNumber: i.installmentNumber,
          amountDue: i.amountDue,
          dueDate: i.dueDate,
        })),
      preparedAt: new Date().toISOString(),
    };
  }
}
