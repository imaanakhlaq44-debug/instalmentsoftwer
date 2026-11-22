/// <reference types="vite/client" />
/**
 * The Android shop app (android/shop) appends "AlmasSDMShop/<version> (Play|Direct)"
 * to its WebView user agent. The website uses it only to change layout; nothing
 * here is a security decision, because a user agent can say anything.
 */
const SHOP_APP = /\bAlmasSDMShop\/[\w.-]+(?: \((Play|Direct)\))?/;

/**
 * `npm run dev` only: `?shopApp=1` (remembered in localStorage, `?shopApp=0`
 * clears it) previews the shop app's layout in an ordinary browser. Compiled
 * out of the production build.
 */
function devPreviewShopApp(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    const flag = new URLSearchParams(window.location.search).get('shopApp');
    if (flag === '1') localStorage.setItem('almas_dev_shop_app', '1');
    if (flag === '0') localStorage.removeItem('almas_dev_shop_app');
    return localStorage.getItem('almas_dev_shop_app') === '1';
  } catch {
    return false;
  }
}

export function isNativeShopApp(userAgent?: string): boolean {
  if (userAgent === undefined && devPreviewShopApp()) return true;
  return SHOP_APP.test(userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent));
}

/** The Play Store build may not sell lock packs inside the app (Play billing rules). */
export function isPlayShopApp(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return SHOP_APP.exec(userAgent)?.[1] === 'Play';
}

/** Name used by the live branch for the same check. */
export const isPlayStoreApp = (): boolean => isPlayShopApp();
