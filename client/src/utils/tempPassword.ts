/** A temporary password the owner reads out once: letters and digits, no look-alikes. */
export function makeTempPassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) => {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, (v) => set[v % set.length]).join('');
  };
  return `${pick(letters, 5)}${pick(digits, 4)}`;
}
