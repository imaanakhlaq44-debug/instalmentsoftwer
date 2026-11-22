/**
 * The handset-app update a check-in announces (DPC 1.8.1+).
 *
 * The phone installs it itself, as device owner, but only after checking the
 * downloaded file against `sha256` — so a wrong or tampered download is never
 * installed — and Android itself refuses an APK not signed with the same key.
 * The phone also skips it while locked, and when its own versionCode is
 * already this one or newer.
 *
 * Nothing is announced unless all three are configured and well-formed: an
 * HTTPS URL, a positive versionCode and a 64-hex SHA-256.
 */
export interface DpcUpdateOffer {
  versionCode: number;
  url: string;
  sha256: string;
}

export function dpcUpdateOffer(dpc: { apkUrl: string; updateVersionCode: number; updateSha256: string }): DpcUpdateOffer | null {
  if (!dpc.apkUrl.startsWith('https://')) return null;
  if (!Number.isInteger(dpc.updateVersionCode) || dpc.updateVersionCode <= 0) return null;
  if (!/^[0-9a-f]{64}$/.test(dpc.updateSha256)) return null;
  return { versionCode: dpc.updateVersionCode, url: dpc.apkUrl, sha256: dpc.updateSha256 };
}
