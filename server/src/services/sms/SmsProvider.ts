import { isGsm7 } from '../../utils/smsSegments.js';

/**
 * Outbound SMS through an aggregator account.
 *
 * A provider does one thing: hand one message to a gateway and say, truthfully,
 * whether the gateway took it. `accepted` means the gateway answered that it
 * accepted the message for sending — not that a handset received it. Anything
 * short of that is a refusal with a reason, and the queue decides what to do
 * with it.
 *
 * `fetch` is injected so the whole exchange can be tested against a fake HTTP
 * layer; no real account is needed to prove what is sent and how a reply is
 * read.
 */

export interface OutboundSms {
  /** The customer's number as stored (03XX-XXXXXXX, or anything normalisable). */
  to: string;
  message: string;
}

export type SmsSendResult =
  | { accepted: true; providerMessageId?: string }
  | {
      accepted: false;
      reason: string;
      /** False when trying the same message again cannot help (a bad number, a refused request). */
      retryable: boolean;
    };

export interface SmsProvider {
  /** Short name for logs and the dashboard: "http" or "twilio". */
  readonly name: string;
  /** The sender mask customers see, when one is configured. */
  readonly senderMask?: string;
  send(sms: OutboundSms): Promise<SmsSendResult>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type PhoneFormat = 'international' | 'plus' | 'local';

/**
 * A Pakistani mobile number in the shape a gateway wants.
 *
 *   international  923001234567   (what most local corporate gateways take)
 *   plus           +923001234567  (E.164 — Twilio)
 *   local          03001234567
 *
 * Returns `undefined` for anything that is not a Pakistani mobile number, so a
 * typo fails here with a clear reason instead of being billed and bounced.
 */
export function formatPakistaniMobile(raw: string, format: PhoneFormat): string | undefined {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  if (!/^3\d{9}$/.test(digits)) return undefined;

  if (format === 'local') return `0${digits}`;
  if (format === 'plus') return `+92${digits}`;
  return `92${digits}`;
}

/** Runs one request, turning a timeout or a dead connection into a plain result. */
async function request(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs: number
): Promise<{ ok: true; status: number; httpOk: boolean; body: string } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = (await res.text()).slice(0, 2000);
    return { ok: true, status: res.status, httpOk: res.ok, body };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, reason: `The SMS gateway did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    }
    // Only the error's name: a fetch failure message can carry the URL, and on
    // a GET gateway the URL carries the password.
    const name = err instanceof Error ? err.name : 'Error';
    return { ok: false, reason: `Could not reach the SMS gateway (${name}).` };
  } finally {
    clearTimeout(timer);
  }
}

/** An HTTP status worth trying again: the gateway's trouble, not the message's. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function oneLine(text: string, max = 160): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Generic HTTP gateway
// ---------------------------------------------------------------------------

export interface HttpSmsConfig {
  url: string;
  method: 'GET' | 'POST';
  /** For POST: `form` (application/x-www-form-urlencoded) or `json`. */
  bodyFormat: 'form' | 'json';

  username?: string;
  password?: string;
  apiKey?: string;
  senderMask?: string;

  /** What this gateway calls each field. A blank name leaves the field out. */
  paramUsername: string;
  paramPassword: string;
  paramApiKey: string;
  paramSender: string;
  paramTo: string;
  paramMessage: string;

  /** Fixed extras sent with every message, as a query string: `format=json&type=text`. */
  extraParams?: string;
  /** Extras sent only when the message is not plain GSM-7 (Urdu script): `type=unicode`. */
  unicodeParams?: string;
  /** One extra header, `Name: value` — for gateways that take a bearer token. */
  authHeader?: string;

  phoneFormat: PhoneFormat;

  /** When set, the reply must match this for the message to count as accepted. */
  successPattern?: string;
  /** A reply matching this is a refusal even on HTTP 200. */
  failurePattern?: string;
  /** A regex whose first group is the gateway's message id. */
  messageIdPattern?: string;

  timeoutMs: number;
}

/**
 * Many gateways answer HTTP 200 to everything and put the truth in the body.
 * Without a success pattern from the operator's documentation, a reply that
 * reads like an error is treated as one.
 */
const DEFAULT_FAILURE_PATTERN = 'error|fail|invalid|denied|unauthori[sz]ed|insufficient|expired|not allowed|blocked';

/**
 * The shape nearly every Pakistani corporate/branded SMS gateway shares: one
 * URL, credentials and a sender mask as parameters, the number and the text
 * beside them. What differs between operators is only what the parameters are
 * called and how the reply reads, so those are configuration, not code.
 */
export class HttpSmsProvider implements SmsProvider {
  public readonly name = 'http';
  public readonly senderMask?: string;

  private readonly success?: RegExp;
  private readonly failure: RegExp;
  private readonly messageId?: RegExp;

  constructor(
    private readonly cfg: HttpSmsConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {
    this.senderMask = cfg.senderMask || undefined;
    this.success = cfg.successPattern ? new RegExp(cfg.successPattern, 'i') : undefined;
    this.failure = new RegExp(cfg.failurePattern || DEFAULT_FAILURE_PATTERN, 'i');
    this.messageId = cfg.messageIdPattern ? new RegExp(cfg.messageIdPattern, 'i') : undefined;
  }

  public async send(sms: OutboundSms): Promise<SmsSendResult> {
    const to = formatPakistaniMobile(sms.to, this.cfg.phoneFormat);
    if (!to) {
      return { accepted: false, retryable: false, reason: `"${oneLine(sms.to, 20)}" is not a valid mobile number.` };
    }

    const params = new URLSearchParams(this.cfg.extraParams ?? '');
    if (!isGsm7(sms.message)) {
      for (const [k, v] of new URLSearchParams(this.cfg.unicodeParams ?? '')) params.set(k, v);
    }

    const put = (name: string, value: string | undefined) => {
      if (name && value) params.set(name, value);
    };
    put(this.cfg.paramUsername, this.cfg.username);
    put(this.cfg.paramPassword, this.cfg.password);
    put(this.cfg.paramApiKey, this.cfg.apiKey);
    put(this.cfg.paramSender, this.cfg.senderMask);
    put(this.cfg.paramTo, to);
    put(this.cfg.paramMessage, sms.message);

    const headers: Record<string, string> = { Accept: '*/*' };
    if (this.cfg.authHeader) {
      const at = this.cfg.authHeader.indexOf(':');
      if (at > 0) headers[this.cfg.authHeader.slice(0, at).trim()] = this.cfg.authHeader.slice(at + 1).trim();
    }

    let url = this.cfg.url;
    let body: string | undefined;

    if (this.cfg.method === 'GET') {
      url += (url.includes('?') ? '&' : '?') + params.toString();
    } else if (this.cfg.bodyFormat === 'json') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(Object.fromEntries(params));
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = params.toString();
    }

    const res = await request(this.fetchImpl, url, { method: this.cfg.method, headers, body }, this.cfg.timeoutMs);
    if (!res.ok) return { accepted: false, retryable: true, reason: res.reason };

    const said = this.scrub(oneLine(res.body)) || '(empty reply)';

    if (!res.httpOk) {
      return {
        accepted: false,
        retryable: isRetryableStatus(res.status),
        reason: `The SMS gateway refused the message (HTTP ${res.status}): ${said}`,
      };
    }

    const refused = this.success ? !this.success.test(res.body) : this.failure.test(res.body);
    if (refused) {
      // Retryable: the gateway did not take it, so trying again cannot send it
      // twice — and "insufficient balance" is fixed by a top-up, not a rewrite.
      return { accepted: false, retryable: true, reason: `The SMS gateway did not accept the message: ${said}` };
    }

    return { accepted: true, providerMessageId: this.extractId(res.body) };
  }

  private extractId(body: string): string | undefined {
    if (this.messageId) {
      const id = this.messageId.exec(body)?.[1];
      return id ? id.slice(0, 120) : undefined;
    }

    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      for (const key of ['message_id', 'messageId', 'messageid', 'msgid', 'msg_id', 'id', 'sid']) {
        const value = json?.[key];
        if (typeof value === 'string' || typeof value === 'number') return String(value).slice(0, 120);
      }
    } catch {
      // A plain-text reply has no id to offer unless a pattern says where it is.
    }
    return undefined;
  }

  /** A gateway that echoes the request back must not write the password into the queue. */
  private scrub(text: string): string {
    let out = text;
    for (const secret of [this.cfg.password, this.cfg.apiKey]) {
      if (secret && secret.length >= 4) out = out.split(secret).join('***');
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  /** An alphanumeric sender id or a Twilio number. One of this or the service sid. */
  from?: string;
  messagingServiceSid?: string;
  timeoutMs: number;
  /** Overridable for tests only. */
  baseUrl?: string;
}

export class TwilioSmsProvider implements SmsProvider {
  public readonly name = 'twilio';
  public readonly senderMask?: string;

  constructor(
    private readonly cfg: TwilioSmsConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {
    this.senderMask = cfg.from || undefined;
  }

  public async send(sms: OutboundSms): Promise<SmsSendResult> {
    const to = formatPakistaniMobile(sms.to, 'plus');
    if (!to) {
      return { accepted: false, retryable: false, reason: `"${oneLine(sms.to, 20)}" is not a valid mobile number.` };
    }

    const params = new URLSearchParams({ To: to, Body: sms.message });
    if (this.cfg.messagingServiceSid) params.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else if (this.cfg.from) params.set('From', this.cfg.from);

    const base = this.cfg.baseUrl ?? 'https://api.twilio.com';
    const url = `${base}/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`;

    const res = await request(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json',
        },
        body: params.toString(),
      },
      this.cfg.timeoutMs
    );
    if (!res.ok) return { accepted: false, retryable: true, reason: res.reason };

    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      // Handled below: a reply that is not JSON is not an acceptance.
    }

    if (!res.httpOk) {
      const detail = typeof json.message === 'string' ? json.message : oneLine(res.body) || '(empty reply)';
      const code = json.code !== undefined ? ` [${String(json.code)}]` : '';
      return {
        accepted: false,
        retryable: isRetryableStatus(res.status),
        reason: `Twilio refused the message (HTTP ${res.status})${code}: ${oneLine(detail)}`,
      };
    }

    // Twilio accepts a message by creating it. No sid, or a status that already
    // says it failed, is not an acceptance whatever the HTTP status was.
    const sid = typeof json.sid === 'string' ? json.sid : undefined;
    const status = typeof json.status === 'string' ? json.status : '';
    if (!sid || status === 'failed' || status === 'undelivered') {
      return {
        accepted: false,
        retryable: true,
        reason: `Twilio did not accept the message: ${oneLine(String(json.error_message ?? status ?? res.body)) || 'no message id returned'}`,
      };
    }

    return { accepted: true, providerMessageId: sid };
  }
}
