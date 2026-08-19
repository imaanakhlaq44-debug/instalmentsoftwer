/**
 * The words the customer actually agrees to.
 *
 * This file is the substance of the feature. Everything else — the table, the
 * hash, the signature pad — exists to record that a specific person read a
 * specific version of this text and accepted it. So it is kept in source, under
 * a version number, and never edited in place: changing an existing version
 * would silently rewrite what people have already signed.
 *
 * **To change the terms, add a new version.** Contracts signed under an older
 * one keep rendering from it, which is the only way an old signature can still
 * mean anything.
 *
 * Both languages are shown side by side on the printed contract. In a Pakistani
 * shop the customer's language is usually Urdu and the system's is English;
 * presenting only one of them would make "the customer agreed" a technicality.
 */

export const CURRENT_TERMS_VERSION = '1.0';

/** The facts the document is rendered from, frozen at signing. */
export interface ContractSnapshot {
  dealer: { name: string; code: string; phone: string; address: string; city: string };
  customer: { name: string; cnic: string; phone: string; address: string };
  device: { brand: string; model: string; imei: string; color?: string; ramStorage?: string };
  plan: {
    totalAmount: number;
    downPayment: number;
    financedAmount: number;
    monthlyInstallment: number;
    totalInstallments: number;
    firstDueDate: string;
    gracePeriodDays: number;
  };
  lateFee: {
    enabled: boolean;
    type: 'FIXED' | 'PERCENTAGE';
    amount: number;
    frequency: 'ONE_TIME' | 'DAILY';
    maxPerInstallment?: number;
  };
  schedule: { installmentNumber: number; amountDue: number; dueDate: string }[];
  preparedAt: string;
}

export interface ContractClause {
  heading: string;
  headingUr: string;
  body: string;
  bodyUr: string;
}

const rs = (amount: number) => 'Rs. ' + Math.round(amount).toLocaleString('en-PK');

/**
 * The clauses, rendered against one customer's figures.
 *
 * Every number here is the real one from the plan. A contract that said
 * "as per the schedule" while the schedule lived only in a database would be
 * worth nothing to the person signing it.
 */
export function renderClauses(snapshot: ContractSnapshot): ContractClause[] {
  const { plan, lateFee, device, dealer } = snapshot;

  const lateFeeDescription = !lateFee.enabled
    ? 'No late fee is charged on this agreement.'
    : lateFee.type === 'FIXED'
      ? `A late fee of ${rs(lateFee.amount)} applies ${lateFee.frequency === 'DAILY' ? 'for each day' : 'once'} an installment remains unpaid after the grace period` +
        (lateFee.maxPerInstallment ? `, capped at ${rs(lateFee.maxPerInstallment)} per installment.` : '.')
      : `A late fee of ${lateFee.amount}% of the overdue installment applies ${lateFee.frequency === 'DAILY' ? 'for each day' : 'once'} it remains unpaid after the grace period` +
        (lateFee.maxPerInstallment ? `, capped at ${rs(lateFee.maxPerInstallment)} per installment.` : '.');

  const lateFeeDescriptionUr = !lateFee.enabled
    ? 'اس معاہدے پر کوئی جرمانہ عائد نہیں ہوتا۔'
    : lateFee.type === 'FIXED'
      ? `مہلت کے بعد قسط ادا نہ ہونے پر ${rs(lateFee.amount)} جرمانہ ${lateFee.frequency === 'DAILY' ? 'روزانہ' : 'ایک بار'} عائد ہوگا` +
        (lateFee.maxPerInstallment ? `، فی قسط زیادہ سے زیادہ ${rs(lateFee.maxPerInstallment)}۔` : '۔')
      : `مہلت کے بعد قسط ادا نہ ہونے پر بقایا رقم کا ${lateFee.amount}% جرمانہ ${lateFee.frequency === 'DAILY' ? 'روزانہ' : 'ایک بار'} عائد ہوگا` +
        (lateFee.maxPerInstallment ? `، فی قسط زیادہ سے زیادہ ${rs(lateFee.maxPerInstallment)}۔` : '۔');

  return [
    {
      heading: '1. What is being financed',
      headingUr: '۱۔ کس چیز کی مالی معاونت ہو رہی ہے',
      body:
        `${dealer.name} is selling a ${device.brand} ${device.model} (IMEI ${device.imei}) at a total price of ` +
        `${rs(plan.totalAmount)}. A down payment of ${rs(plan.downPayment)} has been received, leaving ` +
        `${rs(plan.financedAmount)} to be paid in installments.`,
      bodyUr:
        `${dealer.name} ${device.brand} ${device.model} (آئی ایم ای آئی ${device.imei}) کل ${rs(plan.totalAmount)} میں فروخت کر رہا ہے۔ ` +
        `${rs(plan.downPayment)} ایڈوانس وصول ہو چکا ہے، باقی ${rs(plan.financedAmount)} اقساط میں ادا کرنا ہے۔`,
    },
    {
      heading: '2. The repayment schedule',
      headingUr: '۲۔ اقساط کا شیڈول',
      body:
        `${plan.totalInstallments} monthly installments of approximately ${rs(plan.monthlyInstallment)}, ` +
        `the first falling due on ${plan.firstDueDate}. The exact amount of each installment is listed in the ` +
        `schedule attached to this agreement; the final installment may differ slightly so that the total matches ` +
        `${rs(plan.financedAmount)} exactly. A grace period of ${plan.gracePeriodDays} day(s) applies after each due date.`,
      bodyUr:
        `${plan.totalInstallments} ماہانہ اقساط، تقریباً ${rs(plan.monthlyInstallment)} فی قسط، پہلی قسط ${plan.firstDueDate} کو واجب الادا ہے۔ ` +
        `ہر قسط کی درست رقم اس معاہدے کے ساتھ منسلک شیڈول میں درج ہے؛ آخری قسط تھوڑی مختلف ہو سکتی ہے تاکہ کل رقم ` +
        `${rs(plan.financedAmount)} کے برابر رہے۔ ہر تاریخ کے بعد ${plan.gracePeriodDays} دن کی مہلت دی جائے گی۔`,
    },
    {
      heading: '3. Late payment',
      headingUr: '۳۔ تاخیر سے ادائیگی',
      body: lateFeeDescription,
      bodyUr: lateFeeDescriptionUr,
    },
    {
      /**
       * The clause the whole feature exists for. It is written plainly and it
       * states the limits as clearly as the power, because a consent that
       * conceals what it permits is not consent.
       */
      heading: '4. Consent to restriction of the device',
      headingUr: '۴۔ موبائل بند کرنے کی اجازت',
      body:
        `The customer consents to management software being installed on this handset by ${dealer.name}. ` +
        `If an installment remains unpaid after its grace period, the software may restrict the handset so that it ` +
        `cannot be used for ordinary purposes until the overdue amount is paid.\n\n` +
        `While restricted, the handset will continue to allow emergency calls, and will display the amount owed and ` +
        `the shop's contact number. The restriction is lifted as soon as the overdue payment is recorded.\n\n` +
        `The software does not read the customer's messages, calls, photographs or contacts, does not track the ` +
        `handset's location, and cannot erase any data on it. Once the final installment is paid, management is ` +
        `removed and the handset is the customer's without restriction.`,
      bodyUr:
        `گاہک اس بات کی اجازت دیتا ہے کہ ${dealer.name} اس موبائل پر مینجمنٹ سافٹ ویئر انسٹال کرے۔ ` +
        `اگر کوئی قسط مہلت گزرنے کے بعد بھی ادا نہ ہو، تو یہ سافٹ ویئر موبائل کو محدود کر سکتا ہے، یعنی بقایا رقم کی ادائیگی تک ` +
        `موبائل عام استعمال کے لیے نہیں کھلے گا۔\n\n` +
        `بند ہونے کی حالت میں بھی موبائل سے ایمرجنسی کال کی جا سکے گی، اور اسکرین پر بقایا رقم اور دکان کا نمبر دکھایا جائے گا۔ ` +
        `ادائیگی درج ہوتے ہی پابندی ختم ہو جائے گی۔\n\n` +
        `یہ سافٹ ویئر گاہک کے پیغامات، کالیں، تصاویر یا رابطے نہیں پڑھتا، موبائل کی لوکیشن ٹریک نہیں کرتا، اور اس کا کوئی ڈیٹا ` +
        `مٹا نہیں سکتا۔ آخری قسط کی ادائیگی کے بعد مینجمنٹ ہٹا دی جائے گی اور موبائل مکمل طور پر گاہک کا ہو جائے گا۔`,
    },
    {
      heading: '5. Ownership',
      headingUr: '۵۔ ملکیت',
      body:
        `The handset is handed over to the customer today. ${dealer.name} retains a security interest in it until the ` +
        `financed amount of ${rs(plan.financedAmount)} is paid in full. The customer may not sell, pawn or transfer ` +
        `the handset before then.`,
      bodyUr:
        `موبائل آج گاہک کے حوالے کیا جا رہا ہے۔ ${rs(plan.financedAmount)} کی مکمل ادائیگی تک ${dealer.name} کا اس پر ` +
        `حقِ ضمانت برقرار رہے گا۔ اس سے پہلے گاہک موبائل فروخت، گروی یا منتقل نہیں کر سکتا۔`,
    },
    {
      heading: '6. Early settlement, and if circumstances change',
      headingUr: '۶۔ قبل از وقت ادائیگی، اور حالات بدلنے کی صورت میں',
      body:
        `The customer may settle the remaining balance at any time and have the restriction software removed. ` +
        `If the customer is unable to pay on time, they should contact ${dealer.name} on ${dealer.phone} before the ` +
        `due date; the schedule can be restructured by agreement.`,
      bodyUr:
        `گاہک کسی بھی وقت باقی رقم ادا کر کے پابندی والا سافٹ ویئر ہٹوا سکتا ہے۔ ` +
        `اگر گاہک وقت پر ادائیگی نہ کر سکے تو تاریخ سے پہلے ${dealer.name} سے ${dealer.phone} پر رابطہ کرے؛ ` +
        `باہمی رضامندی سے شیڈول دوبارہ ترتیب دیا جا سکتا ہے۔`,
    },
    {
      heading: '7. Records',
      headingUr: '۷۔ ریکارڈ',
      body:
        `A copy of this agreement, with the signature below, is held by ${dealer.name} and is available to the ` +
        `customer on request. Every payment is receipted.`,
      bodyUr:
        `اس معاہدے کی نقل، نیچے دیے گئے دستخط سمیت، ${dealer.name} کے پاس محفوظ ہے اور گاہک کے مطالبے پر فراہم کی جائے گی۔ ` +
        `ہر ادائیگی کی رسید دی جاتی ہے۔`,
    },
  ];
}

/** Shown immediately above the signature, in both languages. */
export const DECLARATION = {
  en:
    'I have read and understood the terms above, including clause 4, which permits this handset to be ' +
    'restricted if my installments fall overdue. I accept them.',
  ur:
    'میں نے اوپر دی گئی تمام شرائط پڑھ اور سمجھ لی ہیں، بشمول شق نمبر ۴، جس کے تحت اقساط بقایا ہونے کی صورت میں ' +
    'یہ موبائل بند کیا جا سکتا ہے۔ مجھے یہ شرائط منظور ہیں۔',
};
