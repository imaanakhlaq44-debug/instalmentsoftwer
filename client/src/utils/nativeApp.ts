/** Store distribution is a presentation mode, never an authorization boundary. */
export function isNativeShopApp(): boolean {
  return /AlmasSDMShop\/[^\s]+ \((?:Play|Direct)\)/.test(navigator.userAgent);
}

export function isPlayStoreApp(): boolean {
  return /AlmasSDMShop\/[^\s]+ \(Play\)/.test(navigator.userAgent);
}
