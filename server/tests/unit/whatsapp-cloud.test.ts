import { describe, it, expect, vi } from 'vitest';

import { resolveWhatsAppCloudConfig, WhatsAppConfigError } from '../../src/services/whatsapp/cloudConfig.js';
import {
  CloudApiWhatsAppProvider, WhatsAppSendError, sanitizeParameter,
} from '../../src/services/whatsapp/WhatsAppProvider.js';

// Obviously not credentials: a placeholder the tests can look for in a request.
const ENV = {
  WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-token-not-a-real-one',
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: '100000000000001',
  WHATSAPP_CLOUD_API_VERSION: 'v21.0',
  WHATSAPP_CLOUD_TEMPLATE_NAME: 'almas_reminder',
  WHATSAPP_CLOUD_TEMPLATE_LANGUAGE: 'ur',
};

describe('WhatsApp Cloud API configuration', () => {
  it('is off when nothing is set', () => {
    expect(resolveWhatsAppCloudConfig({})).toBeNull();
    expect(resolveWhatsAppCloudConfig({ WHATSAPP_CLOUD_ACCESS_TOKEN: '  ', JWT_SECRET: 'x' })).toBeNull();
  });

  it('is on when everything is set', () => {
    const cfg = resolveWhatsAppCloudConfig({ ...ENV, WHATSAPP_CLOUD_TEMPLATE_PAYMENT_OVERDUE: 'almas_overdue' })!;

    expect(cfg.phoneNumberId).toBe('100000000000001');
    expect(cfg.baseUrl).toBe('https://graph.facebook.com');
    expect(cfg.templateName).toBe('almas_reminder');
    expect(cfg.templatesByType).toEqual({ PAYMENT_OVERDUE: 'almas_overdue' });
  });

  it.each(Object.keys(ENV))('refuses to start half-configured: %s missing', (name) => {
    const env = { ...ENV, [name]: '' };

    expect(() => resolveWhatsAppCloudConfig(env)).toThrow(WhatsAppConfigError);
    expect(() => resolveWhatsAppCloudConfig(env)).toThrow(name);
  });

  it('names the mistake when only a token was pasted in', () => {
    expect(() => resolveWhatsAppCloudConfig({ WHATSAPP_CLOUD_ACCESS_TOKEN: 'abc' })).toThrow(
      /partly configured.*WHATSAPP_CLOUD_PHONE_NUMBER_ID/
    );
  });

  it('never repeats the token in an error', () => {
    try {
      resolveWhatsAppCloudConfig({ ...ENV, WHATSAPP_CLOUD_PHONE_NUMBER_ID: '+92 300 1234567' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('Phone number ID');
      expect((err as Error).message).not.toContain(ENV.WHATSAPP_CLOUD_ACCESS_TOKEN);
    }
  });

  it.each([
    ['WHATSAPP_CLOUD_API_VERSION', '21'],
    ['WHATSAPP_CLOUD_TEMPLATE_NAME', 'Almas Reminder'],
    ['WHATSAPP_CLOUD_TEMPLATE_LANGUAGE', 'Urdu'],
    ['WHATSAPP_CLOUD_API_BASE_URL', 'http://graph.facebook.com'],
    ['WHATSAPP_CLOUD_TEMPLATE_PAYMENT_DUE', 'Not A Name'],
  ])('rejects a malformed %s', (name, value) => {
    expect(() => resolveWhatsAppCloudConfig({ ...ENV, [name]: value })).toThrow(WhatsAppConfigError);
  });
});

const cfg = resolveWhatsAppCloudConfig(ENV)!;

const message = {
  to: '923001234567',
  templateName: 'almas_reminder',
  languageCode: 'ur',
  bodyParameters: ['Kashif Mehmood', 'Line one\nline   two', 'Al-Madina Mobile Hub — 0300-8451299'],
};

/** Stands in for Meta: answers with the given status and JSON body. */
function metaAnswers(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
}

describe('the Cloud API adapter', () => {
  it('posts an approved template to the right number and returns Meta’s id', async () => {
    const fetchMock = metaAnswers(200, {
      messaging_product: 'whatsapp',
      contacts: [{ input: '923001234567', wa_id: '923001234567' }],
      messages: [{ id: 'wamid.TEST123' }],
    });
    const provider = new CloudApiWhatsAppProvider(cfg, fetchMock);

    await expect(provider.sendTemplate(message)).resolves.toEqual({ providerMessageId: 'wamid.TEST123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];

    expect(url).toBe('https://graph.facebook.com/v21.0/100000000000001/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token-not-a-real-one');

    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      messaging_product: 'whatsapp',
      to: '923001234567',
      type: 'template',
      template: { name: 'almas_reminder', language: { code: 'ur' } },
    });
    expect(sent.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Kashif Mehmood' },
      // Meta rejects newlines and runs of spaces inside a placeholder.
      { type: 'text', text: 'Line one line two' },
      { type: 'text', text: 'Al-Madina Mobile Hub — 0300-8451299' },
    ]);
  });

  it('does not call a 200 with no message id an acceptance', async () => {
    const provider = new CloudApiWhatsAppProvider(cfg, metaAnswers(200, { messaging_product: 'whatsapp' }));

    await expect(provider.sendTemplate(message)).rejects.toThrow(/without a message id/);
  });

  it('treats an expired token as fatal, and says so', async () => {
    const provider = new CloudApiWhatsAppProvider(
      cfg,
      metaAnswers(401, { error: { message: 'Error validating access token: Session has expired', code: 190 } })
    );

    const err = await provider.sendTemplate(message).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect(err.fatal).toBe(true);
    expect(err.message).toContain('Session has expired');
    expect(err.message).not.toContain('test-token-not-a-real-one');
  });

  it('treats an unapproved or missing template as fatal', async () => {
    const provider = new CloudApiWhatsAppProvider(
      cfg,
      metaAnswers(404, { error: { message: '(#132001) Template name does not exist in the translation', code: 132001 } })
    );

    const err = await provider.sendTemplate(message).catch((e) => e);
    expect(err.fatal).toBe(true);
  });

  it('treats a wrong phone-number id as fatal', async () => {
    const provider = new CloudApiWhatsAppProvider(
      cfg,
      metaAnswers(400, { error: { message: 'Unsupported post request.', code: 100, error_subcode: 33 } })
    );

    expect((await provider.sendTemplate(message).catch((e) => e)).fatal).toBe(true);
  });

  it('treats one unreachable recipient as that message’s problem only', async () => {
    const provider = new CloudApiWhatsAppProvider(
      cfg,
      metaAnswers(400, {
        error: { message: '(#131026) Message undeliverable', code: 131026, error_data: { details: 'Receiver is incapable of receiving this message.' } },
      })
    );

    const err = await provider.sendTemplate(message).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect(err.fatal).toBe(false);
    expect(err.message).toContain('Receiver is incapable');
  });

  it('treats a server error and a dead network as retryable', async () => {
    const down = new CloudApiWhatsAppProvider(cfg, metaAnswers(503, '<html>Service Unavailable</html>'));
    expect((await down.sendTemplate(message).catch((e) => e)).fatal).toBe(false);

    const offline = new CloudApiWhatsAppProvider(cfg, vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND graph.facebook.com'); }));
    const err = await offline.sendTemplate(message).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect(err.fatal).toBe(false);
    expect(err.message).toContain('Could not reach');
  });

  it('flattens what goes into a placeholder', () => {
    expect(sanitizeParameter('  a\n\nb\t c     d  ')).toBe('a b c d');
  });
});
