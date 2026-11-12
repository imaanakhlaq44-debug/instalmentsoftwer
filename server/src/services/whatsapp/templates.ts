/**
 * The messages a shop opens in its own WhatsApp.
 *
 * Every figure comes from the plan — the caller passes facts, never prose — so
 * a reminder cannot quote an amount the ledger does not hold. Three languages,
 * chosen per shop: Urdu script, Roman Urdu, and English.
 */

export const WHATSAPP_KINDS = ['DUE_REMINDER', 'OVERDUE', 'PAYMENT_RECEIVED', 'LOCK_WARNING'] as const;
export type WhatsAppKind = (typeof WHATSAPP_KINDS)[number];

export const WHATSAPP_LANGUAGES = ['UR', 'ROMAN_UR', 'EN'] as const;
export type WhatsAppLanguage = (typeof WHATSAPP_LANGUAGES)[number];

export const DEFAULT_WHATSAPP_LANGUAGE: WhatsAppLanguage = 'ROMAN_UR';

export interface WhatsAppFacts {
  customerName: string;
  shopName: string;
  shopPhone: string;
  deviceName: string;
  /** Rupees: the amount due, overdue, or received, depending on the kind. */
  amount: number;
  /** YYYY-MM-DD: the due date, the oldest overdue date, or the payment date. */
  date: string;
  /** OVERDUE and LOCK_WARNING: days since the oldest unpaid due date. */
  daysOverdue?: number;
  /** OVERDUE and LOCK_WARNING: how many installments are behind. */
  overdueCount?: number;
  /** PAYMENT_RECEIVED. */
  receiptNumber?: string;
  remainingBalance?: number;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_UR = [
  'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون',
  'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
];

/** `Rs. 6,250` — the same in every language, because that is how a receipt reads. */
export function formatRupees(amount: number): string {
  return `Rs. ${Math.round(amount).toLocaleString('en-US')}`;
}

/** `2026-11-15` → `15 Nov 2026` (or the Urdu month). Built by hand so no timezone can move the day. */
export function formatDate(dateOnly: string, language: WhatsAppLanguage): string {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  const month = (language === 'UR' ? MONTHS_UR : MONTHS_EN)[(m || 1) - 1];
  return `${d} ${month} ${y}`;
}

type Body = (f: WhatsAppFacts, date: string, amount: string) => string;

const BODIES: Record<WhatsAppKind, Record<WhatsAppLanguage, Body>> = {
  DUE_REMINDER: {
    EN: (f, date, amount) =>
      `This is a reminder from ${f.shopName}. Your installment of ${amount} for ${f.deviceName} is due on ${date}. Please pay on time.`,
    ROMAN_UR: (f, date, amount) =>
      `${f.shopName} ki taraf se yaad dehani: aap ke ${f.deviceName} ki qist ${amount}, ${date} ko due hai. Meharbani kar ke waqt par ada kar dein.`,
    UR: (f, date, amount) =>
      `${f.shopName} کی طرف سے یاد دہانی: آپ کے ${f.deviceName} کی قسط ${amount} مورخہ ${date} کو واجب الادا ہے۔ براہِ کرم وقت پر ادا کر دیں۔`,
  },
  OVERDUE: {
    EN: (f, date, amount) =>
      `Your payment for ${f.deviceName} is overdue: ${amount} (${f.overdueCount ?? 1} installment(s)), due since ${date} — ${f.daysOverdue ?? 0} day(s) late. Please pay as soon as possible or contact us.`,
    ROMAN_UR: (f, date, amount) =>
      `Aap ke ${f.deviceName} ki ${f.overdueCount ?? 1} qist(ein), kul ${amount}, late hain. Yeh raqam ${date} se due hai (${f.daysOverdue ?? 0} din late). Meharbani kar ke jald ada karein ya hum se rabta karein.`,
    UR: (f, date, amount) =>
      `آپ کے ${f.deviceName} کی ${f.overdueCount ?? 1} قسط(یں)، کل ${amount}، تاخیر کا شکار ہیں۔ یہ رقم ${date} سے واجب الادا ہے (${f.daysOverdue ?? 0} دن تاخیر)۔ براہِ کرم جلد ادا کریں یا ہم سے رابطہ کریں۔`,
  },
  PAYMENT_RECEIVED: {
    EN: (f, date, amount) =>
      `We have received your payment of ${amount} on ${date}. Receipt no: ${f.receiptNumber ?? '-'}. Remaining balance: ${formatRupees(f.remainingBalance ?? 0)}. Thank you.`,
    ROMAN_UR: (f, date, amount) =>
      `Aap ki payment ${amount}, ${date} ko mil gayi hai. Raseed number: ${f.receiptNumber ?? '-'}. Baqi raqam: ${formatRupees(f.remainingBalance ?? 0)}. Shukriya.`,
    UR: (f, date, amount) =>
      `آپ کی ادائیگی ${amount} مورخہ ${date} کو موصول ہو گئی ہے۔ رسید نمبر: ${f.receiptNumber ?? '-'}۔ بقایا رقم: ${formatRupees(f.remainingBalance ?? 0)}۔ شکریہ۔`,
  },
  LOCK_WARNING: {
    EN: (f, date, amount) =>
      `${amount} is overdue on your ${f.deviceName} (since ${date}). If it is not paid, the phone may be locked as per your signed agreement. Please pay now or contact us to avoid this.`,
    ROMAN_UR: (f, date, amount) =>
      `Aap ke ${f.deviceName} par ${amount} late hain (${date} se). Agar ada na kiye gaye to aap ke dastakhat shuda muahiday ke mutabiq phone lock ho sakta hai. Is se bachne ke liye abhi ada karein ya hum se rabta karein.`,
    UR: (f, date, amount) =>
      `آپ کے ${f.deviceName} پر ${amount} واجب الادا ہیں (${date} سے)۔ اگر ادائیگی نہ ہوئی تو آپ کے دستخط شدہ معاہدے کے مطابق فون لاک ہو سکتا ہے۔ اس سے بچنے کے لیے ابھی ادا کریں یا ہم سے رابطہ کریں۔`,
  },
};

const GREETING: Record<WhatsAppLanguage, (name: string) => string> = {
  EN: (name) => `Assalam o Alaikum ${name},`,
  ROMAN_UR: (name) => `Assalam o Alaikum ${name},`,
  UR: (name) => `السلام علیکم ${name}،`,
};

/** What the audit trail and the dashboard call each kind. */
export const WHATSAPP_KIND_LABEL: Record<WhatsAppKind, string> = {
  DUE_REMINDER: 'due reminder',
  OVERDUE: 'overdue notice',
  PAYMENT_RECEIVED: 'payment receipt',
  LOCK_WARNING: 'lock warning',
};

export function renderWhatsAppMessage(
  kind: WhatsAppKind,
  language: WhatsAppLanguage,
  facts: WhatsAppFacts
): string {
  const body = BODIES[kind][language](facts, formatDate(facts.date, language), formatRupees(facts.amount));
  return [GREETING[language](facts.customerName), body, `${facts.shopName} — ${facts.shopPhone}`].join('\n');
}

/** The click-to-chat link. The shop's own WhatsApp opens with the text typed in, unsent. */
export function buildWaLink(waNumber: string, message: string): string {
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}
