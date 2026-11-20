/** Whole-rupee schedule, matching the server: the last installment carries the remainder. */
export function installmentPreview(price: number, advance: number, months: number) {
  if (![price, advance, months].every(Number.isSafeInteger) || price <= 0 || advance < 0 || advance >= price || months < 1 || months > 60) return null;
  const financedAmount = price - advance;
  const monthlyInstallment = Math.floor(financedAmount / months);
  return { financedAmount, monthlyInstallment, finalInstallment: financedAmount - monthlyInstallment * (months - 1) };
}
