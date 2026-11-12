/**
 * Configuration for the WhatsApp Business Cloud API, read from the environment.
 *
 * Three states, and only three:
 *   - nothing set            → the feature is off (`null`);
 *   - everything set and sane → it is on;
 *   - anything in between     → an error, at boot.
 *
 * The middle state is deliberately not "off". A token with no phone-number id
 * is somebody who believes reminders are going out; quietly disabling the
 * channel would leave them believing it.
 */

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  /** Graph API version, e.g. `v21.0`. */
  apiVersion: string;
  baseUrl: string;
  /** The approved template used when a notification type has none of its own. */
  templateName: string;
  /** Language code the template was approved in, e.g. `ur`, `en`, `en_US`. */
  templateLanguage: string;
  /** Per notification type overrides: `PAYMENT_DUE` → template name. */
  templatesByType: Record<string, string>;
}

export class WhatsAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppConfigError';
  }
}

const PREFIX = 'WHATSAPP_CLOUD_';

const REQUIRED = [
  'WHATSAPP_CLOUD_ACCESS_TOKEN',
  'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
  'WHATSAPP_CLOUD_API_VERSION',
  'WHATSAPP_CLOUD_TEMPLATE_NAME',
  'WHATSAPP_CLOUD_TEMPLATE_LANGUAGE',
] as const;

/** Notification types that may carry their own approved template. */
export const TEMPLATE_OVERRIDE_TYPES = [
  'PAYMENT_DUE', 'PAYMENT_OVERDUE', 'DEVICE_LOCKED', 'DEVICE_UNLOCKED',
  'DEVICE_OFFLINE', 'ENROLLMENT_SUCCESS', 'SECURITY_ALERT',
] as const;

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

export function resolveWhatsAppCloudConfig(
  env: Record<string, string | undefined>
): WhatsAppCloudConfig | null {
  const get = (name: string) => (env[name] ?? '').trim();

  const anySet = Object.keys(env).some((key) => key.startsWith(PREFIX) && get(key) !== '');
  if (!anySet) return null;

  const missing = REQUIRED.filter((name) => !get(name));
  if (missing.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp Cloud API is partly configured. Missing: ${missing.join(', ')}. ` +
        'Set all of them, or remove every WHATSAPP_CLOUD_* variable to leave WhatsApp delivery off.'
    );
  }

  const phoneNumberId = get('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
  if (!/^\d{5,25}$/.test(phoneNumberId)) {
    throw new WhatsAppConfigError(
      'WHATSAPP_CLOUD_PHONE_NUMBER_ID must be the numeric "Phone number ID" from Meta\'s WhatsApp ' +
        'API Setup page — not the phone number itself.'
    );
  }

  const apiVersion = get('WHATSAPP_CLOUD_API_VERSION');
  if (!/^v\d{1,3}\.\d{1,2}$/.test(apiVersion)) {
    throw new WhatsAppConfigError('WHATSAPP_CLOUD_API_VERSION must look like "v21.0".');
  }

  const baseUrl = (get('WHATSAPP_CLOUD_API_BASE_URL') || 'https://graph.facebook.com').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(baseUrl)) {
    throw new WhatsAppConfigError('WHATSAPP_CLOUD_API_BASE_URL must be an https:// URL.');
  }

  const templateName = get('WHATSAPP_CLOUD_TEMPLATE_NAME');
  if (!TEMPLATE_NAME.test(templateName)) {
    throw new WhatsAppConfigError(
      'WHATSAPP_CLOUD_TEMPLATE_NAME must be the template\'s name as approved by Meta (lowercase letters, digits, underscores).'
    );
  }

  const templateLanguage = get('WHATSAPP_CLOUD_TEMPLATE_LANGUAGE');
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(templateLanguage)) {
    throw new WhatsAppConfigError('WHATSAPP_CLOUD_TEMPLATE_LANGUAGE must be a language code such as "ur", "en" or "en_US".');
  }

  const templatesByType: Record<string, string> = {};
  for (const type of TEMPLATE_OVERRIDE_TYPES) {
    const name = get(`WHATSAPP_CLOUD_TEMPLATE_${type}`);
    if (!name) continue;
    if (!TEMPLATE_NAME.test(name)) {
      throw new WhatsAppConfigError(`WHATSAPP_CLOUD_TEMPLATE_${type} is not a valid template name.`);
    }
    templatesByType[type] = name;
  }

  return {
    accessToken: get('WHATSAPP_CLOUD_ACCESS_TOKEN'),
    phoneNumberId,
    apiVersion,
    baseUrl,
    templateName,
    templateLanguage,
    templatesByType,
  };
}
