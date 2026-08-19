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
 *  2. **The hash covers the figures, not just the words.** Restructuring a plan
 *     after signing breaks the hash rather than quietly changing what somebody
 *     agreed to — and a broken hash is surfaced, not swallowed.
 */

export interface ContractActor {
  userId: string;
  userName: string;
  userRole: UserRole;
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
   * `hashMatches` is false when the plan has been changed since signing. It is
   * reported rather than hidden: a contract whose figures no longer describe
   * the plan should be re-signed, and the shop needs to know that before it
   * relies on the old one.
   */
  public static async render(contractId: string): Promise<{
    contract: Contract;
    snapshot: ContractSnapshot;
    clauses: ReturnType<typeof renderClauses>;
    declaration: typeof DECLARATION;
    hashMatches: boolean | null;
  }> {
    const contract = await this.require(contractId);
    const snapshot = JSON.parse(contract.snapshot) as ContractSnapshot;

    return {
      contract,
      snapshot,
      clauses: renderClauses(snapshot),
      declaration: DECLARATION,
      hashMatches: contract.documentHash
        ? contract.documentHash === this.hash(contract.termsVersion, contract.snapshot)
        : null,
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
          'The financing agreement no longer matches the plan it was signed against — the plan has been changed ' +
          'since. It must be re-signed before the handset can be restricted.',
      };
    }

    return { allowed: true, contract };
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
