export interface CnicFields { cnic: string; name: string; address: string }

export function parseCnicText(raw: string): CnicFields {
  const text = raw.replace(/[۰-۹٠-٩]/g, c => String(c.charCodeAt(0) - (c >= '۰' ? 1776 : 1632)));
  const matches = [...text.matchAll(/(?<!\d)(\d{5})[\s-]*(\d{7})[\s-]*(\d)(?!\d)/g)];
  const ids = [...new Set(matches.map(m => `${m[1]}-${m[2]}-${m[3]}`))];
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const invalid = /father|husband|gender|country|identity|pakistan|signature|date|expiry|birth|شناخت|والد|شوہر|پیدائش|تاریخ|جنس|ملک/i;
  let name = '';
  let address = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:full\s+name|name|نام)\s*[:：-]?\s*/i.test(line)) {
      const inline = line.replace(/^(?:full\s+name|name|نام)\s*[:：-]?\s*/i, '').trim();
      const candidate = inline || lines[i + 1] || '';
      if (candidate.length >= 3 && !invalid.test(candidate) && !/\d/.test(candidate)) name ||= candidate.slice(0, 120);
    }
    if (/(?:present address|current address|permanent address|موجودہ پتہ|مستقل پتہ)/i.test(line)) {
      const inline = line.replace(/^.*?(?:present address|current address|permanent address|موجودہ پتہ|مستقل پتہ)\s*[:：-]?\s*/i, '');
      const parts = inline ? [inline] : [];
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        if (/address|پتہ|identity|date|تاریخ|\d{5}[\s-]*\d{7}/i.test(lines[j])) break;
        parts.push(lines[j]);
      }
      if (!address) address = parts.join(' ').slice(0, 300);
    }
  }
  // Ambiguous scans must never silently pick somebody else's CNIC.
  return { cnic: ids.length === 1 ? ids[0] : '', name, address };
}
