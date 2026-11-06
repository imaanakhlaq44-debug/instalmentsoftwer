/**
 * Whether a phone can run the Almas SDM lock app, answered at the counter
 * before the sale, from what the dealer can see on the handset.
 *
 * The app is a device owner (Android Enterprise) installed by QR during first
 * setup. That needs Android 8 or newer and Google Play services, which rules
 * out iPhones, Huawei phones made after the 2019 trade ban, and very old
 * Android. Enterprise factory reset protection needs Android 11.
 */
export type AndroidVersion = '11+' | '8-10' | '7-';

export interface PhoneCheckInput {
  brand: string;
  android: AndroidVersion;
  /** Google Play Store worked on the phone before it was reset. */
  playStore: boolean;
}

export interface PhoneCheck {
  /** full: everything; partial: lock works, with a caveat; none: sell without a lock. */
  level: 'full' | 'partial' | 'none';
  title: string;
  detail: string;
}

const BATTERY_STRICT = new Set(['vivo', 'oppo', 'realme', 'oneplus']);

export function checkPhoneSupport({ brand, android, playStore }: PhoneCheckInput): PhoneCheck {
  const b = brand.trim().toLowerCase();

  if (b === 'apple') {
    return {
      level: 'none',
      title: 'iPhone cannot be locked',
      detail: 'Apple does not allow lock apps on phones a shop sells. Register it as a sale without a lock.',
    };
  }
  if (!playStore) {
    return {
      level: 'none',
      title: 'No Google Play, so no lock',
      detail:
        'Phones without Google services (Huawei and Honor models from 2019–2020 onward with AppGallery) cannot be set up by QR. Register it as a sale without a lock.',
    };
  }
  if (android === '7-') {
    return {
      level: 'none',
      title: 'Android too old',
      detail: 'The lock app needs Android 8 or newer. Register it as a sale without a lock.',
    };
  }
  if (android === '8-10') {
    return {
      level: 'partial',
      title: 'Lock works, reset protection does not',
      detail:
        'Locking, staged restrictions and payment tracking all work. Asking for the shop account after a recovery-mode reset needs Android 11, so this phone does not get it.',
    };
  }
  if (b === 'itel') {
    return {
      level: 'partial',
      title: 'Test this model first',
      detail: 'Some low-cost Itel phones (Android Go, 1–2 GB RAM) cannot be set up by QR. If tapping 6 times shows no QR scanner, register it without a lock.',
    };
  }
  if (BATTERY_STRICT.has(b)) {
    return {
      level: 'full',
      title: 'Fully supported',
      detail: 'This brand closes background apps to save battery, so the dashboard may update a little later than for other phones.',
    };
  }
  return { level: 'full', title: 'Fully supported', detail: 'Lock, staged restrictions and reset protection all work.' };
}
