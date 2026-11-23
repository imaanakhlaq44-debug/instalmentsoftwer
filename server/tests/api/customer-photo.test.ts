import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { as, reseed, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase, prisma } from '../../src/db/prisma.js';

/**
 * The customer's photo, taken at the counter: sent with the sale, kept out of
 * the customer list, and shown, replaced or removed from the customer's page.
 */

beforeEach(async () => {
  await reseed();
}, 60_000);

afterAll(async () => {
  await disconnectDatabase();
});

/** A real (1×1 pixel) JPEG, as the browser sends it. */
const PHOTO =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const OTHER_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const sale = (photo?: string) => ({
  customer: {
    name: 'Photo Test Customer',
    phone: '0300-1112233',
    cnic: '35202-7654321-1',
    address: 'House 9, Photo Street, Gulberg, Lahore',
    emergencyContactName: 'Photo Contact',
    emergencyContactPhone: '0300-4445566',
    ...(photo ? { photo } : {}),
  },
  device: { brand: 'Tecno', model: 'Spark 20', imei: '359871080012348', purchasePrice: 38_000 },
  plan: { downPayment: 8_000, totalInstallments: 6, firstDueDate: '2026-12-20', gracePeriodDays: 3 },
});

describe('customer photo', () => {
  it('is saved with the sale and served on its own', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(sale(PHOTO)).expect(201);
    const id = res.body.customer.id;

    const detail = await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${id}`).expect(200);
    expect(detail.body.customer.hasPhoto).toBe(true);
    expect(JSON.stringify(detail.body)).not.toContain('base64');

    const list = await as(ACCOUNTS.dealerAdmin).get('/api/customers').expect(200);
    expect(JSON.stringify(list.body)).not.toContain('base64');

    const photo = await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${id}/photo`).expect(200);
    expect(photo.body.photo).toBe(PHOTO);
    expect(photo.headers['cache-control']).toContain('no-store');
  });

  it('is optional', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(sale()).expect(201);
    const id = res.body.customer.id;
    expect((await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${id}`)).body.customer.hasPhoto).toBe(false);
    await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${id}/photo`).expect(404);
  });

  it('is replaced when a returning customer is photographed again', async () => {
    const first = await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(sale(PHOTO)).expect(201);
    await as(ACCOUNTS.dealerAdmin)
      .post('/api/customers')
      .send({
        ...sale(),
        customer: { name: 'Photo Test Customer', cnic: '35202-7654321-1', photo: OTHER_PHOTO },
        device: { ...sale().device, imei: '490154203237518' },
      })
      .expect(201);
    const photo = await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${first.body.customer.id}/photo`).expect(200);
    expect(photo.body.photo).toBe(OTHER_PHOTO);
  });

  it('refuses something that is not an image, or is too large', async () => {
    await as(ACCOUNTS.dealerAdmin)
      .post('/api/customers')
      .send(sale('data:text/html;base64,PHNjcmlwdD4='))
      .expect(422);
    await as(ACCOUNTS.dealerAdmin)
      .post('/api/customers')
      .send(sale(`data:image/jpeg;base64,${'A'.repeat(200_000)}`))
      .expect(422);
    expect(await prisma.customerPhoto.count()).toBe(0);
  });

  it('can be added, replaced and removed from the customer page, and each is audited', async () => {
    const id = (await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(sale()).expect(201)).body.customer.id;

    await as(ACCOUNTS.dealerAdmin).put(`/api/customers/${id}/photo`).send({ photo: PHOTO }).expect(200);
    await as(ACCOUNTS.dealerAdmin).put(`/api/customers/${id}/photo`).send({ photo: OTHER_PHOTO }).expect(200);
    expect((await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${id}/photo`)).body.photo).toBe(OTHER_PHOTO);

    await as(ACCOUNTS.dealerAdmin).delete(`/api/customers/${id}/photo`).expect(200);
    await as(ACCOUNTS.dealerAdmin).get(`/api/customers/${id}/photo`).expect(404);
    await as(ACCOUNTS.dealerAdmin).delete(`/api/customers/${id}/photo`).expect(404);

    const actions = (
      await prisma.auditLog.findMany({ where: { targetId: id, action: { startsWith: 'CUSTOMER_PHOTO' } } })
    ).map((a) => a.action);
    expect(actions.sort()).toEqual(['CUSTOMER_PHOTO_REMOVED', 'CUSTOMER_PHOTO_UPDATED', 'CUSTOMER_PHOTO_UPDATED']);
  });

  it("is not visible to another shop or to a customer login", async () => {
    const id = (await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(sale(PHOTO)).expect(201)).body.customer.id;
    await as(ACCOUNTS.otherDealerAdmin).get(`/api/customers/${id}/photo`).expect(404);
    await as(ACCOUNTS.otherDealerAdmin).put(`/api/customers/${id}/photo`).send({ photo: OTHER_PHOTO }).expect(404);
    await as(ACCOUNTS.customer).get(`/api/customers/${id}/photo`).expect(403);
  });
});
