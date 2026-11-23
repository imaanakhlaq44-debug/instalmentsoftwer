import nodemailer from 'nodemailer';

import { config } from '../config.js';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  accepted: boolean;
  reason?: string;
}

/** Anything that can deliver one email. SMTP in production, a fake in tests. */
export interface MailTransport {
  send(email: OutboundEmail): Promise<EmailSendResult>;
}

class SmtpTransport implements MailTransport {
  private readonly transporter;

  constructor(private readonly mail: NonNullable<typeof config.mail>) {
    this.transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: { user: mail.user, pass: mail.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }

  public async send(email: OutboundEmail): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({ from: this.mail.from, ...email });
      return info.accepted.length > 0 ? { accepted: true } : { accepted: false, reason: 'rejected by the mail server' };
    } catch (err) {
      return { accepted: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Sends email straight away (no queue). Used for password-reset links, which
 * are useless if they arrive late.
 */
export class EmailService {
  private static transport: MailTransport | null = config.mail ? new SmtpTransport(config.mail) : null;

  /** Swap the transport — tests pass a fake, `null` switches email off. */
  public static useTransport(transport: MailTransport | null): void {
    this.transport = transport;
  }

  public static isConfigured(): boolean {
    return this.transport !== null;
  }

  public static async sendNow(email: OutboundEmail): Promise<EmailSendResult> {
    if (!this.transport) return { accepted: false, reason: 'email is not configured' };
    return this.transport.send(email);
  }
}
