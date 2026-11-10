/**
 * Counter-side checks for the "Register Financed Device" wizard.
 *
 * They mirror the server's create-sale schema (server/src/routes/customers.routes.ts)
 * so a shop finds out which box is wrong on the step where it typed it, instead of
 * filling in all four steps and getting one generic "not valid" at the end.
 * The server still has the final say; `fieldsFromServer` maps whatever it rejects
 * back onto these same boxes.
 */

export interface SaleForm {
  customerName: string;
  customerPhone: string;
  customerCnic: string;
  customerAddress: string;
  emergencyName: string;
  emergencyPhone: string;
  brand: string;
  model: string;
  imei: string;
  serialNumber: string;
  purchasePrice: number;
  ramStorage: string;
  downPayment: number;
  totalInstallments: number;
  firstDueDate: string;
  gracePeriodDays: number;
}

export type SaleField = keyof SaleForm;
export type SaleErrors = Partial<Record<SaleField, string>>;

const PHONE_MSG = 'Enter a Pakistani mobile number, e.g. 0300-1234567.';

export function isPakistaniMobile(v: string): boolean {
  const s = v.trim();
  return /^03\d{2}-?\d{7}$/.test(s) || /^\+?923\d{9}$/.test(s);
}

export function isValidCnic(v: string): boolean {
  const s = v.trim();
  return /^\d{5}-\d{7}-\d$/.test(s) || /^\d{13}$/.test(s);
}

/** 15 digits whose last digit is a Luhn checksum — the same test the server applies. */
export function isValidImei(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function customerErrors(f: SaleForm): SaleErrors {
  const e: SaleErrors = {};
  const name = f.customerName.trim();
  if (name.length < 3) e.customerName = 'Customer name must be at least 3 characters.';
  else if (name.length > 120) e.customerName = 'Customer name is too long.';
  if (!isPakistaniMobile(f.customerPhone)) e.customerPhone = PHONE_MSG;
  if (!isValidCnic(f.customerCnic)) e.customerCnic = 'CNIC must be 13 digits, e.g. 35202-1234567-1.';
  const address = f.customerAddress.trim();
  if (address.length < 5) e.customerAddress = 'Please enter a complete address.';
  else if (address.length > 300) e.customerAddress = 'Address is too long.';
  const emName = f.emergencyName.trim();
  if (emName.length < 3) e.emergencyName = 'Emergency contact name is required (at least 3 characters).';
  else if (emName.length > 120) e.emergencyName = 'Emergency contact name is too long.';
  if (!isPakistaniMobile(f.emergencyPhone)) e.emergencyPhone = PHONE_MSG;
  return e;
}

function deviceErrors(f: SaleForm): SaleErrors {
  const e: SaleErrors = {};
  const model = f.model.trim();
  if (!model) e.model = 'Please enter the phone model.';
  else if (model.length > 60) e.model = 'Model name is too long.';
  if (!isValidImei(f.imei)) {
    e.imei = 'IMEI must be 15 digits with a valid checksum. Dial *#06# on the phone and re-check.';
  }
  if (f.serialNumber.trim().length > 64) e.serialNumber = 'Serial number is too long.';
  if (!Number.isFinite(f.purchasePrice) || f.purchasePrice <= 0) {
    e.purchasePrice = 'Price must be greater than zero.';
  }
  if (f.ramStorage.trim().length > 40) e.ramStorage = 'Keep this under 40 characters.';
  return e;
}

function planErrors(f: SaleForm): SaleErrors {
  const e: SaleErrors = {};
  if (!Number.isFinite(f.downPayment) || f.downPayment < 0) {
    e.downPayment = 'Down payment cannot be negative.';
  } else if (f.downPayment >= f.purchasePrice) {
    e.downPayment = 'Down payment must be less than the phone price.';
  }
  if (!Number.isInteger(f.totalInstallments) || f.totalInstallments < 1 || f.totalInstallments > 60) {
    e.totalInstallments = 'Choose between 1 and 60 months.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.firstDueDate) || Number.isNaN(new Date(f.firstDueDate).getTime())) {
    e.firstDueDate = 'Pick the first due date.';
  }
  if (!Number.isInteger(f.gracePeriodDays) || f.gracePeriodDays < 0 || f.gracePeriodDays > 30) {
    e.gracePeriodDays = 'Grace period must be 0 to 30 days.';
  }
  return e;
}

/** Problems on one wizard step (1 customer, 2 device, 3 plan). Empty object = OK. */
export function validateSaleStep(step: number, f: SaleForm): SaleErrors {
  if (step === 1) return customerErrors(f);
  if (step === 2) return deviceErrors(f);
  if (step === 3) return planErrors(f);
  return {};
}

/** Which wizard step a field lives on. */
export function stepOf(field: SaleField): 1 | 2 | 3 {
  if (field.startsWith('customer') || field.startsWith('emergency')) return 1;
  if (['downPayment', 'totalInstallments', 'firstDueDate', 'gracePeriodDays'].includes(field)) return 3;
  return 2;
}

const SERVER_FIELD: Record<string, SaleField> = {
  'customer.name': 'customerName',
  'customer.phone': 'customerPhone',
  'customer.cnic': 'customerCnic',
  'customer.address': 'customerAddress',
  'customer.emergencyContactName': 'emergencyName',
  'customer.emergencyContactPhone': 'emergencyPhone',
  'device.brand': 'brand',
  'device.model': 'model',
  'device.imei': 'imei',
  'device.serialNumber': 'serialNumber',
  'device.purchasePrice': 'purchasePrice',
  'device.ramStorage': 'ramStorage',
  'plan.downPayment': 'downPayment',
  'plan.totalInstallments': 'totalInstallments',
  'plan.firstDueDate': 'firstDueDate',
  'plan.gracePeriodDays': 'gracePeriodDays',
};

/** Maps the server's 422 `details` onto the wizard's boxes. Unknown fields are dropped. */
export function fieldsFromServer(details: { field: string; message: string }[] | undefined): SaleErrors {
  const e: SaleErrors = {};
  for (const d of details ?? []) {
    const key = SERVER_FIELD[d.field];
    if (key && !e[key]) e[key] = d.message;
  }
  return e;
}

/** The earliest step that has a problem, or null. */
export function firstBadStep(errors: SaleErrors): 1 | 2 | 3 | null {
  const steps = (Object.keys(errors) as SaleField[]).map(stepOf);
  return steps.length ? (Math.min(...steps) as 1 | 2 | 3) : null;
}
