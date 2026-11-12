import { repo } from '../../db/repositories/index.js';
import { config } from '../../config.js';
import { Notification } from '../../types/index.js';
import { toWhatsAppNumber } from './phone.js';
import { CloudApiWhatsAppProvider, WhatsAppProvider, WhatsAppSendError } from './WhatsAppProvider.js';

/**
 * Sends the WHATSAPP channel of the notification queue through the configured
 * provider.
 *
 * Off unless credentials exist. The rule is the one the SMS relay follows: a
 * message is SENT only once the provider has accepted it, and "accepted" is
 * all SENT claims — delivery receipts arrive by webhook, which is not built.
 *
 * The approved template is expected to have exactly three body placeholders:
 *   {{1}} the customer's name
 *   {{2}} the message text from the queue
 *   {{3}} the shop's name and phone
 */

const LEASE_SECONDS = 180;
const MAX_ATTEMPTS = 5;

export interface DispatchResult {
  enabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
  requeued: number;
  /** Set when the run stopped early because the account or template is wrong. */
  fatalError?: string;
}

let provider: WhatsAppProvider | null | undefined;
let templates: { name: string; language: string; byType: Record<string, string> } | undefined;

function ensureProvider(): WhatsAppProvider | null {
  if (provider === undefined) {
    const cfg = config.whatsappCloud;
    provider = cfg ? new CloudApiWhatsAppProvider(cfg) : null;
    if (cfg) templates = { name: cfg.templateName, language: cfg.templateLanguage, byType: cfg.templatesByType };
  }
  return provider;
}

export class WhatsAppDispatchService {
  /** Whether a WhatsApp provider is configured. The UI and the settings route ask this. */
  public static isEnabled(): boolean {
    return ensureProvider() !== null;
  }

  /** Tests swap in a provider (or `null` for "not configured"); `undefined` restores the real one. */
  public static setProviderForTests(
    next: WhatsAppProvider | null | undefined,
    template: { name: string; language: string; byType?: Record<string, string> } = { name: 'almas_reminder', language: 'ur' }
  ): void {
    provider = next;
    templates = next ? { name: template.name, language: template.language, byType: template.byType ?? {} } : undefined;
  }

  public static async dispatchQueued(limit = 20): Promise<DispatchResult> {
    const active = ensureProvider();
    const result: DispatchResult = { enabled: active !== null, claimed: 0, sent: 0, failed: 0, requeued: 0 };
    if (!active || !templates) return result;

    const claimed = await repo.notifications.claimQueued({
      channel: 'WHATSAPP',
      limit,
      leaseUntil: new Date(Date.now() + LEASE_SECONDS * 1000),
    });
    result.claimed = claimed.length;
    if (claimed.length === 0) return result;

    const customers = await repo.customers.findByIds(
      [...new Set(claimed.map((n) => n.customerId).filter(Boolean))] as string[]
    );
    const customersById = new Map(customers.map((c) => [c.id, c]));
    const dealers = await repo.dealers.findMany({ where: { id: { in: [...new Set(claimed.map((n) => n.dealerId))] } } });
    const dealersById = new Map(dealers.map((d) => [d.id, d]));

    for (let i = 0; i < claimed.length; i++) {
      const notification = claimed[i];
      const customer = notification.customerId ? customersById.get(notification.customerId) : undefined;
      const to = toWhatsAppNumber(customer?.phone);

      if (!customer || !to) {
        await repo.notifications.update(notification.id, {
          status: 'FAILED',
          leaseUntil: undefined,
          failureReason: 'No valid Pakistani mobile number is on file for this customer.',
        });
        result.failed++;
        continue;
      }

      const dealer = dealersById.get(notification.dealerId);

      try {
        await active.sendTemplate({
          to,
          templateName: templates.byType[notification.type] ?? templates.name,
          languageCode: templates.language,
          bodyParameters: [
            customer.name,
            notification.message,
            dealer ? `${dealer.name} — ${dealer.phone}` : 'Almas SDM',
          ],
        });

        await repo.notifications.update(notification.id, {
          status: 'SENT',
          sentAt: new Date().toISOString(),
          leaseUntil: undefined,
          failureReason: undefined,
        });
        result.sent++;
      } catch (err) {
        const reason = (err instanceof Error ? err.message : 'Unknown WhatsApp error.').slice(0, 300);

        if (err instanceof WhatsAppSendError && err.fatal) {
          // Our account or template is wrong. Every remaining message would
          // fail identically, so they all go back untouched — attempt not
          // counted — and the run stops where somebody will see it.
          for (const pending of claimed.slice(i)) {
            await this.release(pending, reason, false);
            result.requeued++;
          }
          result.fatalError = reason;
          console.error(
            '\n[whatsapp] DELIVERY IS FAILING — the WhatsApp Cloud API rejected this server\'s credentials or template.\n' +
              `           ${reason}\n` +
              '           No WhatsApp message will go out until this is fixed. Messages stay queued.\n'
          );
          return result;
        }

        const exhausted = (notification.attempts ?? 0) >= MAX_ATTEMPTS;
        await this.release(notification, reason, true, exhausted);
        if (exhausted) result.failed++;
        else result.requeued++;
        console.error(`[whatsapp] Message ${notification.id} was not accepted: ${reason}`);
      }
    }

    return result;
  }

  private static async release(
    notification: Notification,
    reason: string,
    countAttempt: boolean,
    exhausted = false
  ): Promise<void> {
    await repo.notifications.update(notification.id, {
      status: exhausted ? 'FAILED' : 'QUEUED',
      leaseUntil: undefined,
      failureReason: reason,
      ...(countAttempt ? {} : { attempts: Math.max(0, (notification.attempts ?? 1) - 1) }),
    });
  }
}
