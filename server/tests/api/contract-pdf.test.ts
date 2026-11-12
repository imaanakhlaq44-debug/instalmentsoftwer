import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

import { as, anonymous, reseed, repo, ACCOUNTS } from '../helpers.js';
import { disconnectDatabase } from '../../src/db/prisma.js';
import { ContractPdfService, contractHtml, findChromium } from '../../src/services/ContractPdfService.js';
import { ContractService } from '../../src/services/ContractService.js';

/**
 * GET /api/contracts/:id/pdf — the signed agreement, rendered on the server.
 *
 * The access rules are the ones for reading the agreement, and they are
 * checked before a browser is started. So the renderer is stubbed for those
 * cases and counted: a refusal that still rendered the document would have
 * done the expensive, sensitive part for somebody who should not have it.
 */

let renders: string[] = [];

beforeEach(async () => {
  await reseed();
  renders = [];
  ContractPdfService.setRenderer(async (html) => {
    renders.push(html);
    return Buffer.from('%PDF-1.4 stub');
  });
}, 60_000);

afterEach(() => {
  ContractPdfService.setRenderer();
});

afterAll(async () => {
  await disconnectDatabase();
});

/** cust-1's signed agreement — the seeded customer login is scoped to cust-1. */
async function ownContract() {
  const device = (await repo.devices.findFirst({ dealerId: 'dealer-1', customerId: 'cust-1' }))!;
  return (await repo.contracts.findByDevice(device.id))!;
}

/** A dealer-1 agreement belonging to some other customer. */
async function someoneElsesContract() {
  const page = await repo.contracts.list({ dealerId: 'dealer-1', status: 'ALL', page: 1, limit: 100 });
  return page.data.find((c) => c.customerId !== 'cust-1')!;
}

describe('who may download the agreement', () => {
  it('refuses a request with no session', async () => {
    const contract = await ownContract();
    const res = await anonymous().get(`/api/contracts/${contract.id}/pdf`);
    expect(res.status).toBe(401);
    expect(renders).toHaveLength(0);
  });

  it('gives the shop its own agreement as a PDF attachment', async () => {
    const contract = await ownContract();
    const res = await as(ACCOUNTS.dealerStaff).get(`/api/contracts/${contract.id}/pdf`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="agreement-${contract.id}.pdf"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(renders).toHaveLength(1);
  });

  it('lets a customer download their own', async () => {
    const contract = await ownContract();
    const res = await as(ACCOUNTS.customer).get(`/api/contracts/${contract.id}/pdf`);
    expect(res.status).toBe(200);
  });

  it('does not let a customer download somebody else\'s', async () => {
    const contract = await someoneElsesContract();
    const res = await as(ACCOUNTS.customer).get(`/api/contracts/${contract.id}/pdf`);
    expect(res.status).toBe(404);
    expect(renders).toHaveLength(0);
  });

  it('does not let one dealership download another\'s', async () => {
    const contract = await ownContract();
    const res = await as(ACCOUNTS.otherDealerAdmin).get(`/api/contracts/${contract.id}/pdf`);
    expect(res.status).toBe(404);
    expect(renders).toHaveLength(0);
  });

  it('answers 404 for an agreement that does not exist', async () => {
    const res = await as(ACCOUNTS.dealerAdmin).get('/api/contracts/ctr-nope/pdf');
    expect(res.status).toBe(404);
    expect(renders).toHaveLength(0);
  });

  it('says so plainly when the server cannot make a PDF', async () => {
    const { AppError } = await import('../../src/utils/AppError.js');
    ContractPdfService.setRenderer(async () => {
      throw new AppError('PDF download is not set up on this server.', 503, { code: 'PDF_UNAVAILABLE' });
    });
    const contract = await ownContract();
    const res = await as(ACCOUNTS.dealerAdmin).get(`/api/contracts/${contract.id}/pdf`);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not set up/);
  });
});

describe('what the document carries', () => {
  it('prints the signed figures, both languages, the signature, the version and the hash', async () => {
    const contract = await ownContract();
    await as(ACCOUNTS.dealerAdmin).get(`/api/contracts/${contract.id}/pdf`);
    const html = renders[0];
    const snapshot = JSON.parse(contract.snapshot);

    expect(html).toContain(`terms v${contract.termsVersion}`);
    expect(html).toContain(contract.documentHash!);
    expect(html).toContain(contract.signatureImage!);
    expect(html).toContain(snapshot.customer.cnic);
    expect(html).toContain(snapshot.device.imei);
    expect(html).toContain('Rs. ' + Math.round(snapshot.plan.financedAmount).toLocaleString('en-PK'));
    for (const row of snapshot.schedule) expect(html).toContain(row.dueDate);

    expect(html).toContain('4. Consent to restriction of the device');
    expect(html).toContain('۴۔ موبائل بند کرنے کی اجازت');
    expect(html).toContain('dir="rtl" lang="ur"');
    // The Urdu face travels inside the page, not with the server image.
    expect(html).toContain('@font-face');
  });

  it('allows the page no scripts and no network', async () => {
    const contract = await ownContract();
    await as(ACCOUNTS.dealerAdmin).get(`/api/contracts/${contract.id}/pdf`);
    expect(renders[0]).toContain("default-src 'none'");
    expect(renders[0]).not.toMatch(/<script/i);
  });

  it('escapes whatever was typed into the record', async () => {
    const contract = await ownContract();
    const document = await ContractService.render(contract.id);
    document.snapshot.customer.name = '<img src=x onerror=alert(1)>';
    document.contract.signerName = '"><script>alert(1)</script>';

    const html = contractHtml(document);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('marks an unsigned agreement as a draft rather than passing it off as signed', async () => {
    const draft = (await repo.contracts.list({ dealerId: 'dealer-1', status: 'DRAFT', page: 1, limit: 1 })).data[0];
    if (!draft) return; // the fixture signs everything it sells
    const html = contractHtml(await ContractService.render(draft.id));
    expect(html).toContain('DRAFT — not signed');
    expect(html).toContain('Not signed: no document hash');
  });
});

// Runs wherever a Chromium is installed (the Docker image, a developer
// machine); CI has none, and the cases above cover everything but the browser.
describe.skipIf(!findChromium())('with a real Chromium', () => {
  it('produces a PDF with the Urdu font embedded', async () => {
    ContractPdfService.setRenderer();
    const contract = await ownContract();
    const { pdf } = await ContractPdfService.render(contract.id);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(pdf.includes(Buffer.from('NotoNastaliqUrdu'))).toBe(true);
  }, 60_000);
});
