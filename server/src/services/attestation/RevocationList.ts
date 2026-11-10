/**
 * Google's attestation certificate status list.
 *
 * When an OEM's attestation keys leak (a "keybox"), tools appear that let a
 * rooted or IMEI-changed phone present a genuine-looking chain. Google revokes
 * those certificates and publishes their serials here. The list is fetched at
 * most every 12 hours and cached in memory; when it cannot be fetched the last
 * good copy is used, and with none at all the check is skipped rather than
 * failing every handset — revocation is a second line, not the first.
 */

const STATUS_URL = 'https://android.googleapis.com/attestation/status';
const REFRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

let cached: Set<string> | undefined;
let fetchedAt = 0;
let lastAttemptAt = 0;
let inflight: Promise<void> | undefined;
let testOverride: Set<string> | undefined | null = null;

function normalize(serial: string): string {
  return serial.toLowerCase().replace(/^0+(?=.)/, '');
}

async function refresh(): Promise<void> {
  lastAttemptAt = Date.now();
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return;
    const body = (await res.json()) as { entries?: Record<string, { status?: string }> };
    const next = new Set<string>();
    for (const [serial, entry] of Object.entries(body.entries ?? {})) {
      if (entry?.status === 'REVOKED') next.add(normalize(serial));
    }
    cached = next;
    fetchedAt = Date.now();
  } catch {
    // Keep whatever we had.
  }
}

export const AttestationRevocationList = {
  /** Revoked certificate serials (lower-case hex), or undefined when unknown. */
  async revokedSerials(): Promise<Set<string> | undefined> {
    if (testOverride !== null) return testOverride;
    if (process.env.NODE_ENV === 'test') return undefined;

    const now = Date.now();
    const stale = now - fetchedAt > REFRESH_MS;
    if (stale && now - lastAttemptAt > RETRY_MS && !inflight) {
      inflight = refresh().finally(() => {
        inflight = undefined;
      });
    }
    // First use waits for the list; later refreshes happen in the background.
    if (!cached && inflight) await inflight;
    return cached;
  },

  /** Test hook: a fixed list (or `undefined` for "unknown"); `null` restores normal behaviour. */
  setForTesting(serials: string[] | undefined | null): void {
    testOverride = serials === null ? null : serials === undefined ? undefined : new Set(serials.map(normalize));
  },
};
