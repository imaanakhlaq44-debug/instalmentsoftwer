/**
 * Payment-gateway configuration, read from the environment.
 *
 * Read on demand rather than captured once in `config.ts`: nothing here is
 * needed to boot, an unset gateway must simply be absent, and no secret should
 * sit in an exported object that something might one day serialise.
 *
 * Nothing in this file logs a value. Warnings name variables, never contents.
 */

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string): string => (env[name] || '').trim();

export interface GatewayUrls {
  /** Public base of this API, e.g. `https://app.example.com/api`. */
  apiUrl: string;
  /** Public base of the dashboard, where the customer lands afterwards. */
  dashboardUrl: string;
}

const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[gateway] ${message}`);
}

function cleanUrl(value: string, production: boolean): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) return undefined;
    return value.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * The two public URLs every gateway needs. Without both, the gateway is off:
 * a checkout whose return address is a guess is money sent with nowhere to
 * report back to.
 */
export function gatewayUrls(env: Env = process.env): GatewayUrls | undefined {
  const production = read(env, 'NODE_ENV') === 'production';
  const api = read(env, 'PAYMENT_GATEWAY_API_URL');
  const dashboard = read(env, 'PAYMENT_GATEWAY_DASHBOARD_URL');
  if (!api && !dashboard) return undefined;

  const apiUrl = cleanUrl(api, production);
  const dashboardUrl = cleanUrl(dashboard, production);
  if (!apiUrl || !dashboardUrl) {
    warnOnce(
      'PAYMENT_GATEWAY_API_URL and PAYMENT_GATEWAY_DASHBOARD_URL must both be set to valid URLs ' +
        '(https in production). The payment gateway stays off.'
    );
    return undefined;
  }
  return { apiUrl, dashboardUrl };
}

export interface JazzCashMerchant {
  merchantId: string;
  password: string;
  integritySalt: string;
  environment: 'sandbox' | 'production';
}

/** `dealer-1` → `DEALER_1`, the form a dealer id takes inside a variable name. */
export function dealerEnvKey(dealerId: string): string {
  return dealerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function jazzCashEnvironment(env: Env): 'sandbox' | 'production' | undefined {
  const raw = read(env, 'JAZZCASH_ENV').toLowerCase() || 'sandbox';
  if (raw !== 'sandbox' && raw !== 'production') {
    warnOnce('JAZZCASH_ENV must be "sandbox" or "production". JazzCash stays off.');
    return undefined;
  }
  // Sandbox credentials approve payments nobody made. On a live server that
  // would settle real installments and unlock real phones for nothing.
  if (raw === 'sandbox' && read(env, 'NODE_ENV') === 'production') {
    warnOnce('JAZZCASH_ENV is "sandbox" but NODE_ENV is "production". JazzCash stays off on a live server.');
    return undefined;
  }
  return raw;
}

function readTriple(env: Env, prefix: string): { merchantId: string; password: string; integritySalt: string } | undefined {
  const merchantId = read(env, `${prefix}_MERCHANT_ID`);
  const password = read(env, `${prefix}_PASSWORD`);
  const integritySalt = read(env, `${prefix}_INTEGRITY_SALT`);
  if (!merchantId && !password && !integritySalt) return undefined;
  if (!merchantId || !password || !integritySalt) {
    warnOnce(`${prefix}_MERCHANT_ID, ${prefix}_PASSWORD and ${prefix}_INTEGRITY_SALT must all be set. Ignoring the incomplete set.`);
    return undefined;
  }
  return { merchantId, password, integritySalt };
}

/**
 * The JazzCash account a dealership collects through.
 *
 * A dealership's own account (`JAZZCASH_DEALER_<KEY>_*`) wins. The platform
 * account applies only to dealerships named in `JAZZCASH_DEALER_IDS` — never by
 * default, because money paid into the platform's account is not money the
 * dealership received, and crediting its customer for it is a decision somebody
 * has to make on purpose.
 */
export function jazzCashMerchantFor(dealerId: string, env: Env = process.env): JazzCashMerchant | undefined {
  const environment = jazzCashEnvironment(env);
  if (!environment) return undefined;

  const own = readTriple(env, `JAZZCASH_DEALER_${dealerEnvKey(dealerId)}`);
  if (own) return { ...own, environment };

  const allowed = read(env, 'JAZZCASH_DEALER_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!allowed.includes('*') && !allowed.includes(dealerId)) return undefined;

  const platform = readTriple(env, 'JAZZCASH');
  return platform ? { ...platform, environment } : undefined;
}
