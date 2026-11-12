import { repo } from '../../db/repositories/index.js';
import { AppError } from '../../utils/AppError.js';
import { Customer, Installment, InstallmentPlan } from '../../types/index.js';
import { amountOutstanding, daysBetween, toDateOnly } from '../InstallmentMath.js';
import { toWhatsAppNumber } from './phone.js';
import {
  WhatsAppKind, WhatsAppLanguage, WhatsAppFacts, DEFAULT_WHATSAPP_LANGUAGE, WHATSAPP_LANGUAGES,
  renderWhatsAppMessage, buildWaLink,
} from './templates.js';

export interface ComposeRequest {
  customer: Customer;
  kind: WhatsAppKind;
  /** Narrow the message to one installment (due reminder) or one plan. */
  installmentId?: string;
  planId?: string;
  /** PAYMENT_RECEIVED: which payment. Defaults to the customer's latest verified one. */
  paymentId?: string;
  /** Defaults to today. A parameter so a test can stand on a fixed date. */
  today?: string;
}

export interface ComposedWhatsApp {
  kind: WhatsAppKind;
  language: WhatsAppLanguage;
  customerId: string;
  customerName: string;
  /** The number as it is on file, for display. */
  phone: string;
  /** The same number as WhatsApp addresses it: 923XXXXXXXXX. */
  waNumber: string;
  message: string;
  url: string;
}

const OPEN_PLAN = (plan: InstallmentPlan | undefined) =>
  !!plan && plan.status !== 'COMPLETED' && plan.status !== 'CANCELLED';

/**
 * Builds the click-to-WhatsApp message for one customer from the ledger.
 *
 * It refuses, with a reason the counter can read, whenever the message would
 * say something untrue: an overdue notice to somebody who owes nothing late, a
 * lock warning for a phone sold without a lock or without a signed agreement,
 * a receipt for a payment nobody has verified.
 */
export class WhatsAppLinkService {
  public static async compose(req: ComposeRequest): Promise<ComposedWhatsApp> {
    const { customer, kind } = req;

    const waNumber = toWhatsAppNumber(customer.phone);
    if (!waNumber) {
      throw AppError.badRequest(
        `${customer.name}'s number (${customer.phone || 'none on file'}) is not a valid Pakistani mobile number. ` +
          'Correct it on the customer record first.'
      );
    }

    const dealer = await repo.dealers.findById(customer.dealerId);
    if (!dealer) throw AppError.notFound('Dealer');

    const policy = await repo.devicePolicies.findByDealer(customer.dealerId);
    const language = (WHATSAPP_LANGUAGES as readonly string[]).includes(policy?.whatsappLanguage ?? '')
      ? (policy!.whatsappLanguage as WhatsAppLanguage)
      : DEFAULT_WHATSAPP_LANGUAGE;

    const today = req.today ?? toDateOnly(new Date());
    const core =
      kind === 'PAYMENT_RECEIVED'
        ? await this.receiptFacts(req)
        : kind === 'DUE_REMINDER'
          ? await this.dueFacts(req)
          : await this.overdueFacts(req, today);

    const facts: WhatsAppFacts = {
      customerName: customer.name,
      shopName: dealer.name,
      shopPhone: dealer.phone,
      ...core,
    };

    const message = renderWhatsAppMessage(kind, language, facts);

    return {
      kind,
      language,
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      waNumber,
      message,
      url: buildWaLink(waNumber, message),
    };
  }

  /** The customer's unpaid installments on plans that are still running. */
  private static async openInstallments(req: ComposeRequest): Promise<{
    installments: Installment[];
    plansById: Map<string, InstallmentPlan>;
  }> {
    const plans = await repo.installmentPlans.findByCustomer(req.customer.id);
    const plansById = new Map(plans.map((p) => [p.id, p]));

    const rows = await repo.installments.findMany({
      where: { customerId: req.customer.id, status: { not: 'PAID' } },
      orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
    });

    const installments = rows.filter(
      (i) =>
        OPEN_PLAN(plansById.get(i.planId)) &&
        amountOutstanding(i) > 0 &&
        (!req.planId || i.planId === req.planId) &&
        (!req.installmentId || i.id === req.installmentId)
    );

    return { installments, plansById };
  }

  private static async deviceName(plan: InstallmentPlan | undefined): Promise<string> {
    const device = plan ? await repo.devices.findById(plan.deviceId) : undefined;
    return device ? `${device.brand} ${device.model}` : 'phone';
  }

  private static async dueFacts(req: ComposeRequest) {
    const { installments, plansById } = await this.openInstallments(req);

    // A named installment is taken as asked. Otherwise the next one the
    // overdue engine has not marked late — an installment past its grace date
    // belongs in an overdue notice, not a friendly reminder.
    const next = req.installmentId ? installments[0] : installments.find((i) => i.status !== 'OVERDUE');
    if (!next) {
      throw AppError.badRequest(
        installments.length > 0
          ? 'This customer has no upcoming installment — what they owe is already overdue. Use the overdue notice.'
          : 'This customer has no unpaid installment to be reminded about.'
      );
    }

    return {
      deviceName: await this.deviceName(plansById.get(next.planId)),
      amount: amountOutstanding(next),
      date: next.dueDate,
    };
  }

  private static async overdueFacts(req: ComposeRequest, today: string) {
    const { installments, plansById } = await this.openInstallments(req);

    // OVERDUE is the status the overdue engine sets once the grace period has
    // passed — the same rows, and so the same total, as the dashboard's list.
    let overdue = installments.filter((i) => i.status === 'OVERDUE');
    if (overdue.length === 0) {
      throw AppError.badRequest('This customer has no overdue installment.');
    }

    // One message is about one phone. A customer behind on two handsets gets
    // the one that has been late longest unless a plan was named.
    const planId = overdue[0].planId;
    overdue = overdue.filter((i) => i.planId === planId);
    const plan = plansById.get(planId);

    if (req.kind === 'LOCK_WARNING') {
      const device = plan ? await repo.devices.findById(plan.deviceId) : undefined;
      if (!device || device.noLock) {
        throw AppError.badRequest('This phone was sold without a lock, so a lock warning would not be true.');
      }
      const contract = await repo.contracts.findByDevice(device.id);
      if (contract?.status !== 'SIGNED') {
        throw AppError.badRequest(
          'There is no signed agreement for this phone, so it cannot be locked and a lock warning would not be true.'
        );
      }
    }

    return {
      deviceName: await this.deviceName(plan),
      amount: overdue.reduce((sum, i) => sum + amountOutstanding(i), 0),
      date: overdue[0].dueDate,
      daysOverdue: Math.max(0, daysBetween(overdue[0].dueDate, today)),
      overdueCount: overdue.length,
    };
  }

  private static async receiptFacts(req: ComposeRequest) {
    const payment = req.paymentId
      ? await repo.payments.findById(req.paymentId)
      : (
          await repo.payments.findMany({
            where: { customerId: req.customer.id, status: 'VERIFIED', reversalOfPaymentId: null, reversedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
          })
        )[0];

    if (!payment || payment.customerId !== req.customer.id) {
      throw req.paymentId
        ? AppError.notFound('Payment')
        : AppError.badRequest('This customer has no verified payment to send a receipt for.');
    }
    if (payment.status !== 'VERIFIED' || payment.reversedAt || payment.reversalOfPaymentId) {
      throw AppError.badRequest('Only a verified payment that has not been reversed gets a receipt.');
    }

    const plan = payment.planId ? await repo.installmentPlans.findById(payment.planId) : undefined;

    return {
      deviceName: await this.deviceName(plan),
      amount: payment.amount,
      // The day the shop took the money, on a Pakistani calendar rather than UTC's.
      date: new Date(new Date(payment.verifiedAt ?? payment.createdAt).getTime() + 5 * 3_600_000)
        .toISOString()
        .slice(0, 10),
      receiptNumber: payment.receiptNumber || payment.id,
      remainingBalance: plan?.remainingBalance ?? 0,
    };
  }
}
