import { describe, it, expect } from 'vitest';

import {
  HttpSmsProvider, TwilioSmsProvider, HttpSmsConfig, FetchLike, formatPakistaniMobile,
} from '../../src/services/sms/SmsProvider.js';

/**
 * No real gateway account exists, so these run against a fake HTTP layer: the
 * request the provider builds is captured, and the reply is whatever the test
 * says the gateway answered.
 */
interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeGateway(reply: { status?: number; body?: string } | Error | 'hang') {
  const calls: Captured[] = [];

  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });

    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (reply instanceof Error) return Promise.reject(reply);

    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: async () => reply.body ?? '',
    });
  };

  return { fetchImpl, calls };
}

const BASE: HttpSmsConfig = {
  url: 'https://gateway.example/api/send',
  method: 'GET',
  bodyFormat: 'form',
  username: 'shopuser',
  password: 'hunter2-secret',
  senderMask: 'ALMAS SDM',
  paramUsername: 'id',
  paramPassword: 'pass',
  paramApiKey: 'api_key',
  paramSender: 'mask',
  paramTo: 'to',
  paramMessage: 'msg',
  phoneFormat: 'international',
  timeoutMs: 1000,
};

const SMS = { to: '0300-1234567', message: 'Aap ki qist kal due hai.' };

describe('writing a Pakistani mobile number the way a gateway wants it', () => {
  it('accepts every form a number is stored or typed in', () => {
    for (const raw of ['0300-1234567', '03001234567', '+92 300 1234567', '923001234567', '00923001234567']) {
      expect(formatPakistaniMobile(raw, 'international')).toBe('923001234567');
    }
    expect(formatPakistaniMobile('0300-1234567', 'plus')).toBe('+923001234567');
    expect(formatPakistaniMobile('0300-1234567', 'local')).toBe('03001234567');
  });

  it('rejects what is not a mobile number', () => {
    for (const raw of ['', 'N/A', '042-35761234', '0300-12345', '12345678901']) {
      expect(formatPakistaniMobile(raw, 'international')).toBeUndefined();
    }
  });
});

describe('the generic HTTP gateway', () => {
  it('sends credentials, mask, number and text under the names the gateway uses', async () => {
    const { fetchImpl, calls } = fakeGateway({ body: 'OK id=88421' });
    const provider = new HttpSmsProvider({ ...BASE, messageIdPattern: 'id=(\\d+)' }, fetchImpl);

    const result = await provider.send(SMS);

    expect(result).toEqual({ accepted: true, providerMessageId: '88421' });
    expect(calls).toHaveLength(1);

    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe('GET');
    expect(url.origin + url.pathname).toBe('https://gateway.example/api/send');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: 'shopuser',
      pass: 'hunter2-secret',
      mask: 'ALMAS SDM',
      to: '923001234567',
      msg: SMS.message,
    });
  });

  it('posts a form, or JSON, when the gateway wants that', async () => {
    const form = fakeGateway({ body: 'sent' });
    await new HttpSmsProvider({ ...BASE, method: 'POST' }, form.fetchImpl).send(SMS);

    expect(form.calls[0].url).toBe(BASE.url);
    expect(form.calls[0].headers['Content-Type']).toMatch(/x-www-form-urlencoded/);
    expect(new URLSearchParams(form.calls[0].body).get('to')).toBe('923001234567');

    const json = fakeGateway({ body: '{"status":"ok","message_id":"abc-1"}' });
    const result = await new HttpSmsProvider(
      { ...BASE, method: 'POST', bodyFormat: 'json', authHeader: 'Authorization: Bearer tok-123' },
      json.fetchImpl
    ).send(SMS);

    expect(json.calls[0].headers['Content-Type']).toBe('application/json');
    expect(json.calls[0].headers.Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(json.calls[0].body!)).toMatchObject({ to: '923001234567', msg: SMS.message, mask: 'ALMAS SDM' });
    expect(result).toEqual({ accepted: true, providerMessageId: 'abc-1' });
  });

  it('tells the gateway when a message is Urdu, and sends the text intact', async () => {
    const urdu = 'آپ کی قسط کل واجب الادا ہے';
    const cfg = { ...BASE, extraParams: 'format=text', unicodeParams: 'type=unicode' };

    const plain = fakeGateway({ body: 'OK' });
    await new HttpSmsProvider(cfg, plain.fetchImpl).send(SMS);
    expect(new URL(plain.calls[0].url).searchParams.get('type')).toBeNull();
    expect(new URL(plain.calls[0].url).searchParams.get('format')).toBe('text');

    const unicode = fakeGateway({ body: 'OK' });
    await new HttpSmsProvider(cfg, unicode.fetchImpl).send({ to: SMS.to, message: urdu });
    const params = new URL(unicode.calls[0].url).searchParams;
    expect(params.get('type')).toBe('unicode');
    expect(params.get('msg')).toBe(urdu);
  });

  it('does not call a refusal inside an HTTP 200 a success', async () => {
    // The gateway habit this guards against: 200 OK to everything, with the
    // truth in the body. Marking that SENT would claim a warning nobody got.
    const { fetchImpl } = fakeGateway({ body: 'Error 204: Insufficient balance' });
    const result = await new HttpSmsProvider(BASE, fetchImpl).send(SMS);

    expect(result.accepted).toBe(false);
    expect(result).toMatchObject({ retryable: true });
    expect((result as { reason: string }).reason).toMatch(/Insufficient balance/);
  });

  it('requires the success pattern when one is configured', async () => {
    const cfg = { ...BASE, successPattern: 'sent successfully' };

    const vague = await new HttpSmsProvider(cfg, fakeGateway({ body: 'queued?' }).fetchImpl).send(SMS);
    expect(vague.accepted).toBe(false);

    const clear = await new HttpSmsProvider(cfg, fakeGateway({ body: 'Message Sent Successfully' }).fetchImpl).send(SMS);
    expect(clear.accepted).toBe(true);
  });

  it('retries a gateway that is down but not a request it rejected', async () => {
    const down = await new HttpSmsProvider(BASE, fakeGateway({ status: 503, body: 'busy' }).fetchImpl).send(SMS);
    expect(down).toMatchObject({ accepted: false, retryable: true });

    const rejected = await new HttpSmsProvider(BASE, fakeGateway({ status: 401, body: 'bad login' }).fetchImpl).send(SMS);
    expect(rejected).toMatchObject({ accepted: false, retryable: false });
    expect((rejected as { reason: string }).reason).toMatch(/HTTP 401/);
  });

  it('reports a dead connection and a timeout as failures, not as sent', async () => {
    const dead = await new HttpSmsProvider(BASE, fakeGateway(new TypeError('fetch failed')).fetchImpl).send(SMS);
    expect(dead).toMatchObject({ accepted: false, retryable: true });

    const slow = await new HttpSmsProvider({ ...BASE, timeoutMs: 30 }, fakeGateway('hang').fetchImpl).send(SMS);
    expect(slow).toMatchObject({ accepted: false, retryable: true });
    expect((slow as { reason: string }).reason).toMatch(/did not answer/);
  });

  it('never calls the gateway for a number that cannot be a mobile', async () => {
    const { fetchImpl, calls } = fakeGateway({ body: 'OK' });
    const result = await new HttpSmsProvider(BASE, fetchImpl).send({ to: '042-35761234', message: 'x' });

    expect(result).toMatchObject({ accepted: false, retryable: false });
    expect(calls).toHaveLength(0);
  });

  it('keeps the password out of the failure reason even if the gateway echoes it', async () => {
    const { fetchImpl } = fakeGateway({ status: 400, body: 'bad request: pass=hunter2-secret&to=92300' });
    const result = await new HttpSmsProvider(BASE, fetchImpl).send(SMS);

    expect(JSON.stringify(result)).not.toContain('hunter2-secret');
  });
});

describe('Twilio', () => {
  const cfg = { accountSid: 'ACtest', authToken: 'tok-secret', from: 'ALMAS SDM', timeoutMs: 1000 };

  it('creates a message with basic auth and an E.164 number', async () => {
    const { fetchImpl, calls } = fakeGateway({ status: 201, body: '{"sid":"SM123","status":"queued"}' });
    const result = await new TwilioSmsProvider(cfg, fetchImpl).send(SMS);

    expect(result).toEqual({ accepted: true, providerMessageId: 'SM123' });
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    expect(calls[0].headers.Authorization).toBe('Basic ' + Buffer.from('ACtest:tok-secret').toString('base64'));

    const body = new URLSearchParams(calls[0].body);
    expect(body.get('To')).toBe('+923001234567');
    expect(body.get('From')).toBe('ALMAS SDM');
    expect(body.get('Body')).toBe(SMS.message);
  });

  it('reports Twilio\'s own reason for a refusal', async () => {
    const { fetchImpl } = fakeGateway({
      status: 400,
      body: '{"code":21211,"message":"The \'To\' number is not a valid phone number."}',
    });
    const result = await new TwilioSmsProvider(cfg, fetchImpl).send(SMS);

    expect(result).toMatchObject({ accepted: false, retryable: false });
    expect((result as { reason: string }).reason).toMatch(/21211/);
    expect((result as { reason: string }).reason).toMatch(/not a valid phone number/);
  });

  it('does not accept a 2xx reply that carries no message id', async () => {
    const result = await new TwilioSmsProvider(cfg, fakeGateway({ status: 200, body: '<html>proxy</html>' }).fetchImpl).send(SMS);
    expect(result.accepted).toBe(false);
  });
});
