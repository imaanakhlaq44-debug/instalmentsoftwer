import { WhatsAppCloudConfig } from './cloudConfig.js';

/**
 * The seam a WhatsApp delivery service attaches at.
 *
 * WhatsApp does not let a business open a conversation with free text: the
 * first message must be a template Meta has approved. So the unit of sending
 * is a template name and the values for its placeholders, not a string.
 */
export interface WhatsAppTemplateMessage {
  /** 923XXXXXXXXX — digits, country code first. */
  to: string;
  templateName: string;
  languageCode: string;
  /** Values for {{1}}, {{2}}, … in the template body, in order. */
  bodyParameters: string[];
}

export interface WhatsAppProvider {
  readonly name: string;
  /**
   * Resolves only when the provider has ACCEPTED the message, with its id for
   * it. Anything else throws a `WhatsAppSendError`. Accepted is not delivered.
   */
  sendTemplate(message: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }>;
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    /**
     * True when the fault is ours — a bad token, a wrong phone-number id, an
     * unapproved template. Every other message in the queue would fail the same
     * way, so the dispatcher stops rather than burning each one's retries.
     */
    public readonly fatal: boolean,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Meta error codes that mean the account or template is wrong, not the recipient. */
const FATAL_ERROR_CODES = new Set([
  190,    // access token expired or invalid
  10,     // permission denied
  200,    // permission denied
  132000, // template parameter count mismatch
  132001, // template does not exist in that language
  132007, // template violates policy
  132012, // template parameter format mismatch
  132015, // template paused
  132016, // template disabled
  131031, // business account locked
  131042, // payment issue on the business account
]);

/** Placeholders may not carry newlines, tabs or runs of spaces — Meta rejects the message. */
export function sanitizeParameter(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1000);
}

/**
 * WhatsApp Business Cloud API (Meta's hosted Graph API).
 *
 * `POST {base}/{version}/{phone-number-id}/messages` with a bearer token. `fetch`
 * is a constructor argument so the tests can stand in for Meta; nothing here
 * reaches the network on its own.
 */
export class CloudApiWhatsAppProvider implements WhatsAppProvider {
  public readonly name = 'whatsapp-cloud-api';

  constructor(
    private readonly cfg: WhatsAppCloudConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly timeoutMs = 15_000
  ) {}

  public async sendTemplate(message: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }> {
    const url = `${this.cfg.baseUrl}/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        components: [
          {
            type: 'body',
            parameters: message.bodyParameters.map((text) => ({ type: 'text', text: sanitizeParameter(text) })),
          },
        ],
      },
    };

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Never the request itself in the message: it carries the token.
      throw new WhatsAppSendError(
        `Could not reach the WhatsApp Cloud API: ${err instanceof Error ? err.message : 'network error'}.`,
        false
      );
    }

    const raw = await res.text().catch(() => '');
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }

    if (!res.ok) {
      const code = Number(body?.error?.code);
      const detail = body?.error?.error_data?.details || body?.error?.message || `HTTP ${res.status}`;
      // Code 100 / subcode 33 is "object does not exist": the phone-number id is wrong.
      const wrongSender = code === 100 && Number(body?.error?.error_subcode) === 33;
      const fatal = res.status === 401 || res.status === 403 || wrongSender || FATAL_ERROR_CODES.has(code);
      throw new WhatsAppSendError(
        `WhatsApp Cloud API refused the message (HTTP ${res.status}${Number.isFinite(code) ? `, code ${code}` : ''}): ${detail}`,
        fatal,
        res.status
      );
    }

    const id = body?.messages?.[0]?.id;
    if (typeof id !== 'string' || !id) {
      // A 200 that names no message is not an acceptance. Treat it as unsent.
      throw new WhatsAppSendError('WhatsApp Cloud API answered without a message id, so nothing was accepted.', false, res.status);
    }

    return { providerMessageId: id };
  }
}
