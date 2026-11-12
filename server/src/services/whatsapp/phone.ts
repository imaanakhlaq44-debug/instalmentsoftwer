/**
 * A Pakistani mobile number in the form WhatsApp addresses it by: digits only,
 * country code first, no plus sign — `923001234567`.
 *
 * Shops key numbers every way there is: 0300-1234567, 0300 1234567,
 * +92 300 1234567, 00923001234567, 3001234567. All of those are the same SIM.
 * Anything that is not a Pakistani mobile comes back `null` rather than a
 * guess: a wa.me link to the wrong country opens a chat with a stranger.
 */
export function toWhatsAppNumber(raw: string | undefined | null): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(2);

  let national: string;
  if (digits.startsWith('92')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;

  // A trunk zero kept after the country code: +92 (0)300 1234567.
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);

  return /^3\d{9}$/.test(national) ? `92${national}` : null;
}
