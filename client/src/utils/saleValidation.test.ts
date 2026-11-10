import { describe, it, expect } from 'vitest';
import {
  SaleForm,
  fieldsFromServer,
  firstBadStep,
  isValidImei,
  validateSaleStep,
} from './saleValidation.js';

const ok: SaleForm = {
  customerName: 'Muhammad Aslam',
  customerPhone: '0300-1234567',
  customerCnic: '35202-1234567-1',
  customerAddress: 'House 5, Street 2, Faisalabad',
  emergencyName: 'Asif Aslam',
  emergencyPhone: '0321-7654321',
  brand: 'Samsung',
  model: 'Galaxy A15',
  imei: '490154203237518',
  serialNumber: '',
  purchasePrice: 54000,
  ramStorage: '6GB / 128GB',
  downPayment: 13500,
  totalInstallments: 6,
  firstDueDate: '2026-12-10',
  gracePeriodDays: 3,
};

describe('register financed device: step checks', () => {
  it('passes a complete sale on every step', () => {
    for (const step of [1, 2, 3]) expect(validateSaleStep(step, ok)).toEqual({});
  });

  it('flags the emergency contact the screen used to treat as optional', () => {
    const e = validateSaleStep(1, { ...ok, emergencyName: '', emergencyPhone: '' });
    expect(Object.keys(e).sort()).toEqual(['emergencyName', 'emergencyPhone']);
  });

  it('accepts the phone formats the server accepts', () => {
    for (const p of ['03001234567', '0300-1234567', '+923001234567', '923001234567']) {
      expect(validateSaleStep(1, { ...ok, customerPhone: p }).customerPhone).toBeUndefined();
    }
    expect(validateSaleStep(1, { ...ok, customerPhone: '0300-123' }).customerPhone).toBeTruthy();
  });

  it('checks CNIC format and short addresses', () => {
    const e = validateSaleStep(1, { ...ok, customerCnic: '3520212345671x', customerAddress: 'Lhr' });
    expect(e.customerCnic).toBeTruthy();
    expect(e.customerAddress).toBeTruthy();
  });

  it('rejects an IMEI with a bad checksum', () => {
    expect(isValidImei('490154203237518')).toBe(true);
    expect(isValidImei('490154203237519')).toBe(false);
    expect(validateSaleStep(2, { ...ok, imei: '123456789012345' }).imei).toBeTruthy();
  });

  it('rejects a down payment that covers the whole price', () => {
    expect(validateSaleStep(3, { ...ok, downPayment: 54000 }).downPayment).toBeTruthy();
  });
});

describe('register financed device: server rejections', () => {
  it('maps server field paths onto the wizard boxes and finds the earliest step', () => {
    const e = fieldsFromServer([
      { field: 'plan.firstDueDate', message: 'Date must be in YYYY-MM-DD format.' },
      { field: 'customer.emergencyContactPhone', message: 'Phone must be a valid Pakistani mobile number.' },
      { field: 'somethingElse', message: 'ignored' },
    ]);
    expect(e).toEqual({
      firstDueDate: 'Date must be in YYYY-MM-DD format.',
      emergencyPhone: 'Phone must be a valid Pakistani mobile number.',
    });
    expect(firstBadStep(e)).toBe(1);
    expect(firstBadStep({})).toBeNull();
  });
});
