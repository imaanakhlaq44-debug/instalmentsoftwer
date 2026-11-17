/** Store distribution is a presentation mode, never an authorization boundary. */
export function isPlayStoreApp(): boolean {
  return /AlmasSDMShop\/[^\s]+ \(Play\)/.test(navigator.userAgent);
}
