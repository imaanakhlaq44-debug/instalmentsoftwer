import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

import { anonymous, reseed, SEED_PASSWORD } from '../helpers.js';
import { disconnectDatabase, prisma } from '../../src/db/prisma.js';
import { SmsAggregatorService } from '../../src/services/SmsAggregatorService.js';
import { OutboundSms, SmsProvider, SmsSendResult } from '../../src/services/sms/SmsProvider.js';
import { EmailService, EmailSendResult, MailTransport, OutboundEmail } from '../../src/services/EmailService.js';

/**
 * "Forgot password": a code by SMS to the account's own mobile number, and a
 * new password with it — no platform owner in the loop.
 */

class FakeGateway implements SmsProvider {
  public readonly name = 'fake';
  public readonly received: OutboundSms[] = [];
  public answer: SmsSendResult = { accepted: true, providerMessageId: 'gw-1' };
  public async send(sms: OutboundSms): Promise<SmsSendResult> {
    this.received.push(sms);
    return this.answer;
  }
}

const OWNER_EMAIL = 'tariq@almadinamobiles.pk';
const OWNER_PHONE = '0300-8451299';
const NEW_PASSWORD = 'NewShopPass#2026';

let gateway: FakeGateway;

beforeEach(async () => {
  await reseed();
  gateway = new FakeGateway();
  SmsAggregatorService.useProvider(gateway);
}, 60_000);

afterEach(() => {
  SmsAggregatorService.useProvider(null);
});

afterAll(async () => {
  await disconnectDatabase();
});

const codeFrom = (sms: OutboundSms) => sms.message.match(/\b(\d{6})\b/)![1];

const forgot = (email: string) => anonymous().post('/api/auth/forgot-password').send({ email });
const reset = (email: string, code: string, newPassword = NEW_PASSWORD) =>
  anonymous().post('/api/auth/reset-password').send({ email, code, newPassword });
const login = (email: string, password: string) => anonymous().post('/api/auth/login').send({ email, password });

/** Lets the next request through the one-minute resend wait. */
const ageCodes = () =>
  prisma.passwordReset.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 60_000) } });

describe('forgot password', () => {
  it('sends a code to the account phone and lets the owner choose a new password', async () => {
    const res = await forgot(OWNER_EMAIL).expect(200);
    expect(res.body.available).toBe(true);

    expect(gateway.received).toHaveLength(1);
    expect(gateway.received[0].to).toBe(OWNER_PHONE);
    const code = codeFrom(gateway.received[0]);

    // Only a hash is stored.
    const row = await prisma.passwordReset.findFirstOrThrow();
    expect(row.codeHash).not.toContain(code);

    await reset(OWNER_EMAIL, code).expect(200);
    await login(OWNER_EMAIL, NEW_PASSWORD).expect(200);
    await login(OWNER_EMAIL, SEED_PASSWORD).expect(401);

    // Used once only.
    await reset(OWNER_EMAIL, code, 'AnotherPass#2026').expect(400);

    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'PASSWORD_RESET_' } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_SELF']);
  });

  it('gives the same answer for an unknown email and sends nothing', async () => {
    const known = await forgot(OWNER_EMAIL).expect(200);
    const unknown = await forgot('nobody@example.com').expect(200);
    expect(unknown.body).toEqual(known.body);
    expect(gateway.received).toHaveLength(1);
  });

  it('never resets a super admin by SMS', async () => {
    await forgot('admin@almassdm.pk').expect(200);
    expect(gateway.received).toHaveLength(0);
  });

  it('kills a code after five wrong guesses', async () => {
    await forgot(OWNER_EMAIL).expect(200);
    const code = codeFrom(gateway.received[0]);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await reset(OWNER_EMAIL, wrong).expect(400);
    await reset(OWNER_EMAIL, code).expect(400);
    await login(OWNER_EMAIL, SEED_PASSWORD).expect(200);
  });

  it('refuses an expired code', async () => {
    await forgot(OWNER_EMAIL).expect(200);
    await prisma.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await reset(OWNER_EMAIL, codeFrom(gateway.received[0])).expect(400);
  });

  it('a new code replaces the old one, and codes are not resent within a minute', async () => {
    await forgot(OWNER_EMAIL).expect(200);
    await forgot(OWNER_EMAIL).expect(200);
    expect(gateway.received).toHaveLength(1);

    await ageCodes();
    await forgot(OWNER_EMAIL).expect(200);
    expect(gateway.received).toHaveLength(2);

    await reset(OWNER_EMAIL, codeFrom(gateway.received[0])).expect(400);
    await reset(OWNER_EMAIL, codeFrom(gateway.received[1])).expect(200);
  });

  it('checks the new password is strong enough', async () => {
    await forgot(OWNER_EMAIL).expect(200);
    await reset(OWNER_EMAIL, codeFrom(gateway.received[0]), 'password').expect(400);
  });

  it('does not keep a code the gateway refused', async () => {
    gateway.answer = { accepted: false, reason: 'down', retryable: true };
    await forgot(OWNER_EMAIL).expect(503);
    expect(await prisma.passwordReset.count({ where: { usedAt: null } })).toBe(0);
  });

  it('says plainly when this server has no SMS gateway', async () => {
    SmsAggregatorService.useProvider(null);
    expect((await anonymous().get('/api/auth/password-reset/status').expect(200)).body).toEqual({ available: false, channel: null });
    expect((await forgot(OWNER_EMAIL).expect(200)).body.available).toBe(false);
  });
});

class FakeMailbox implements MailTransport {
  public readonly received: OutboundEmail[] = [];
  public answer: EmailSendResult = { accepted: true };
  public async send(email: OutboundEmail): Promise<EmailSendResult> {
    this.received.push(email);
    return this.answer;
  }
}

describe('forgot password by email link', () => {
  let mailbox: FakeMailbox;

  beforeEach(() => {
    mailbox = new FakeMailbox();
    EmailService.useTransport(mailbox);
  });

  afterEach(() => {
    EmailService.useTransport(null);
  });

  const linkFrom = (email: OutboundEmail) => {
    const url = new URL(email.text.match(/https?:\/\/\S+\/reset-password\?\S+/)![0]);
    return { id: url.searchParams.get('id')!, token: url.searchParams.get('token')! };
  };
  const useLink = (link: { id: string; token: string }, newPassword = NEW_PASSWORD) =>
    anonymous().post('/api/auth/reset-password/link').send({ ...link, newPassword });

  it('emails a link to the sign-in address instead of an SMS, and the link sets a new password once', async () => {
    const status = await anonymous().get('/api/auth/password-reset/status').expect(200);
    expect(status.body).toEqual({ available: true, channel: 'email' });

    const res = await forgot(OWNER_EMAIL).expect(200);
    expect(res.body.channel).toBe('email');
    expect(gateway.received).toHaveLength(0);
    expect(mailbox.received).toHaveLength(1);
    expect(mailbox.received[0].to).toBe(OWNER_EMAIL);

    const link = linkFrom(mailbox.received[0]);
    expect((await prisma.passwordReset.findFirstOrThrow()).codeHash).not.toContain(link.token);

    const done = await useLink(link).expect(200);
    expect(done.body.email).toBe(OWNER_EMAIL);
    await login(OWNER_EMAIL, NEW_PASSWORD).expect(200);
    await login(OWNER_EMAIL, SEED_PASSWORD).expect(401);

    await useLink(link, 'AnotherPass#2026').expect(400);
  });

  it('gives the same answer for an unknown email and sends nothing', async () => {
    const known = await forgot(OWNER_EMAIL).expect(200);
    const unknown = await forgot('nobody@example.com').expect(200);
    expect(unknown.body).toEqual(known.body);
    expect(mailbox.received).toHaveLength(1);
  });

  it('never emails a super admin a link', async () => {
    await forgot('admin@almassdm.pk').expect(200);
    expect(mailbox.received).toHaveLength(0);
  });

  it('refuses a wrong token, an expired link and a typed SMS code', async () => {
    await forgot(OWNER_EMAIL).expect(200);
    const link = linkFrom(mailbox.received[0]);
    await useLink({ id: link.id, token: 'a'.repeat(64) }).expect(400);
    await reset(OWNER_EMAIL, '123456').expect(400);

    await prisma.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await useLink(link).expect(400);
    await login(OWNER_EMAIL, SEED_PASSWORD).expect(200);
  });

  it('does not keep a link the mail server refused', async () => {
    mailbox.answer = { accepted: false, reason: 'down' };
    await forgot(OWNER_EMAIL).expect(503);
    expect(await prisma.passwordReset.count({ where: { usedAt: null } })).toBe(0);
  });
});
