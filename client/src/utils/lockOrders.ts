import { MAX_PACK_SIZE, priceForPack } from './packPricing.js';

/**
 * What the dashboard knows about a lock order. The server
 * (server/src/routes/lockOrders.routes.ts) is the authority on every rule
 * here; these copies only let a form speak before it is submitted.
 */

export type LockOrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LockOrder {
  id: string;
  dealerId: string;
  dealerName: string;
  dealerCity: string;
  dealerPhone: string;
  ownerName: string;
  size: number;
  unitPrice: number;
  totalPrice: number;
  status: LockOrderStatus;
  paymentMethod: string;
  transactionId: string;
  amountPaid: number;
  hasProof: boolean;
  note?: string;
  submittedByName: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  packId?: string;
  createdAt: string;
}

/** How a shop may pay the platform. Cash is not on the list: nobody could check it. */
export const ORDER_PAYMENT_METHODS = [
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'RAAST', label: 'Raast' },
] as const;

export const methodLabel = (value: string): string =>
  ORDER_PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;

export const ORDER_STATUS: Record<LockOrderStatus, { label: string; pill: string }> = {
  PENDING: { label: 'Being checked', pill: 'status-pending' },
  APPROVED: { label: 'Locks added', pill: 'status-active' },
  REJECTED: { label: 'Rejected', pill: 'status-locked' },
  CANCELLED: { label: 'Cancelled', pill: 'status-inactive' },
};

export interface LockOrderForm {
  size: number;
  paymentMethod: string;
  transactionId: string;
  amountPaid: number | '';
}

/** Checks the browser can make before bothering the server. Names the first problem. */
export function validateLockOrder(f: LockOrderForm): string | null {
  if (!priceForPack(f.size)) return `Choose between 1 and ${MAX_PACK_SIZE} locks.`;
  if (!ORDER_PAYMENT_METHODS.some((m) => m.value === f.paymentMethod)) return 'Choose how you paid.';
  const tid = f.transactionId.trim();
  if (tid.length < 4) return 'Enter the transaction ID from your transfer.';
  if (tid.length > 60 || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(tid)) {
    return 'A transaction ID is letters and numbers only.';
  }
  if (f.amountPaid === '' || !Number.isInteger(f.amountPaid) || f.amountPaid <= 0) {
    return 'Enter the amount you sent, in whole rupees.';
  }
  return null;
}
