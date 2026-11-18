/**
 * The Android shop app (android/shop) appends "AlmasSDMShop/<version> (Play|Direct)"
 * to its WebView user agent. The website uses it only to change layout; nothing
 * here is a security decision, because a user agent can say anything.
 */
const SHOP_APP = /\bAlmasSDMShop\/[\w.-]+(?: \((Play|Direct)\))?/;

export function isNativeShopApp(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return SHOP_APP.test(userAgent);
}

/** The Play Store build may not sell lock packs inside the app (Play billing rules). */
export function isPlayShopApp(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return SHOP_APP.exec(userAgent)?.[1] === 'Play';
}
