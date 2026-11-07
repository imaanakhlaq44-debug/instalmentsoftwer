/**
 * The lease clause checker: a fixed list of well-known problem terms, matched
 * sentence by sentence. It is deliberately a pattern check and says so — it
 * cannot read a whole lease the way a lawyer would, and it never claims a
 * clause is lawful just because nothing matched.
 */

export type Jurisdiction = 'california' | 'new-york' | 'texas' | 'florida' | 'england' | 'scotland' | 'general';
export type Severity = 'alert' | 'warn' | 'info';
export type Finding = { id: string; title: string; severity: Severity; rule: string; explanation: string; ask: string; quote: string };

export const JURISDICTION_NAMES: Record<Jurisdiction, string> = {
  california: 'California', 'new-york': 'New York', texas: 'Texas', florida: 'Florida', england: 'England', scotland: 'Scotland', general: 'General (US)',
};

type Rule = {
  id: string;
  title: string;
  /** Matched against one sentence at a time. */
  pattern: RegExp;
  /** Extra check on the sentence, e.g. that the tenant — not the landlord — carries the duty. */
  accept?: (sentence: string, match: RegExpExecArray) => boolean;
  judge: (j: Jurisdiction) => { severity: Severity; rule: string; explanation: string } | null;
  ask: string;
};

const UK = (j: Jurisdiction) => j === 'england' || j === 'scotland';

/** "Landlord shall not enter without notice" must not be flagged as a no-notice entry clause. */
const negatedBefore = (sentence: string, index: number) =>
  /\b(shall|will|may|must|does|do|can)\s+not\b|\bcannot\b|\bnever\b|\bno\s+(right|entry)\b/.test(sentence.slice(Math.max(0, index - 60), index));

const RULES: Rule[] = [
  {
    id: 'non-refundable-deposit',
    title: 'Deposit or move-out charge described as non-refundable',
    pattern: /non[\s-]?refundable|forfeit(?:ed)?\s+(?:up)?on\s+(?:move[\s-]?out|termination|vacating)|turnover\s+fee|refurbish(?:ment)?\s+fee|re-?letting\s+fee/i,
    judge: (j) => {
      if (j === 'california') return { severity: 'alert', rule: 'Cal. Civ. Code § 1950.5(m)', explanation: 'California law says no lease may describe any security as non-refundable. Deductions are limited to unpaid rent, cleaning back to move-in condition and damage beyond normal wear and tear.' };
      if (j === 'new-york') return { severity: 'alert', rule: 'N.Y. Gen. Oblig. Law §§ 7-103 and 7-108', explanation: 'In New York a deposit stays the tenant’s money held in trust, is capped at one month’s rent and can only be kept for itemised unpaid rent or damage. A non-refundable deposit conflicts with that.' };
      if (j === 'england') return { severity: 'alert', rule: 'Tenant Fees Act 2019, Schedule 1', explanation: 'In England the only payments a landlord or agent may require are rent, a refundable deposit (capped at five weeks’ rent in most cases), a holding deposit and a few listed default fees. A non-refundable or cleaning charge is a prohibited payment.' };
      if (j === 'scotland') return { severity: 'alert', rule: 'Rent (Scotland) Act 1984 s.82; Tenancy Deposit Schemes (Scotland) Regulations 2011', explanation: 'In Scotland charging any premium beyond rent and a refundable deposit is unlawful, and the deposit must be lodged with an approved scheme within 30 working days.' };
      return { severity: 'warn', rule: j === 'texas' ? 'Tex. Prop. Code §§ 92.103–92.104' : j === 'florida' ? 'Fla. Stat. § 83.49' : 'State security-deposit law', explanation: 'A security deposit has to be refundable less itemised, lawful deductions. Some states allow a separate, clearly disclosed non-refundable fee, so check whether the money is called a deposit or a fee.' };
    },
    ask: 'Please amend this clause so the security deposit is fully refundable, less only lawful, itemised deductions.',
  },
  {
    id: 'entry-without-notice',
    title: 'Landlord entry without notice',
    pattern: /\benter\b[^.;]{0,60}?\b(?:at\s+any\s+time|without\s+(?:prior\s+|advance\s+|any\s+)?notice)|without\s+(?:prior\s+|advance\s+|any\s+)?notice[^.;]{0,40}?\benter|immediate\s+access|waives?\b[^.;]{0,40}?\bnotice/i,
    accept: (s, m) => !negatedBefore(s, m.index),
    judge: (j) => {
      if (j === 'california') return { severity: 'alert', rule: 'Cal. Civ. Code §§ 1953(a)(1) and 1954', explanation: 'California landlords must give reasonable written notice — 24 hours is presumed reasonable — and enter during normal business hours, except in an emergency. A lease cannot waive this.' };
      if (j === 'florida') return { severity: 'alert', rule: 'Fla. Stat. § 83.53', explanation: 'Florida requires at least 24 hours’ notice before entry for repairs, at a reasonable time, except in an emergency.' };
      if (j === 'new-york') return { severity: 'warn', rule: 'N.Y. lease and case law (reasonable notice)', explanation: 'New York has no single statutory notice period, but landlords are expected to give reasonable advance notice — commonly 24 hours for repairs — except in an emergency.' };
      if (j === 'texas') return { severity: 'warn', rule: 'Lease terms (Texas has no statutory entry-notice period)', explanation: 'Texas law does not set an entry-notice period, so the lease controls. A clause allowing entry at any time is usually enforceable there — consider negotiating a notice period before signing.' };
      if (j === 'england') return { severity: 'alert', rule: 'Landlord and Tenant Act 1985 s.11(6); covenant of quiet enjoyment', explanation: 'Tenants in England have a right to quiet enjoyment. A landlord may inspect for repairs at reasonable times on at least 24 hours’ written notice, except in an emergency.' };
      if (j === 'scotland') return { severity: 'alert', rule: 'Private Housing (Tenancies) (Scotland) Act 2016', explanation: 'In Scotland a landlord must give at least 48 hours’ notice before entering for inspections or repairs, except in an emergency.' };
      return { severity: 'warn', rule: 'State landlord–tenant law', explanation: 'Most US states require reasonable advance notice (often 24 hours) before non-emergency entry. Check your state’s rule.' };
    },
    ask: 'Please revise this clause to require at least 24 hours’ written notice before non-emergency entry, at reasonable times.',
  },
  {
    id: 'tenant-major-repairs',
    title: 'Tenant made responsible for major or structural repairs',
    pattern: /\btenants?\b[^.;]{0,80}?\b(?:responsible|liable|pay|bear|maintain|repair)\w*\b[^.;]{0,80}?\b(?:structur\w*|heating|boiler|furnace|plumbing|roof|foundation|water\s+heater|hot\s+water|wiring|all\s+repairs)|all\s+repairs[^.;]{0,30}regardless\s+of\s+cause/i,
    accept: (_s, m) => !/landlord|owner|lessor/i.test(m[0]) && !negatedBefore(_s, m.index + m[0].search(/responsible|liable|pay|bear|maintain|repair/i)),
    judge: (j) => {
      if (j === 'england') return { severity: 'alert', rule: 'Landlord and Tenant Act 1985 ss.11–12', explanation: 'In England the landlord must keep the structure, exterior, heating, hot water and sanitation in repair for most tenancies under seven years, and section 12 makes a lease term shifting that duty to the tenant void.' };
      if (j === 'scotland') return { severity: 'alert', rule: 'Housing (Scotland) Act 2006 — repairing standard', explanation: 'Scottish landlords must keep the home wind and watertight and its heating, water, gas and electrical installations in working order. This duty cannot be passed to the tenant.' };
      const statute = j === 'california' ? 'Cal. Civ. Code §§ 1941 and 1953' : j === 'new-york' ? 'N.Y. Real Prop. Law § 235-b' : j === 'florida' ? 'Fla. Stat. § 83.51' : j === 'texas' ? 'Tex. Prop. Code §§ 92.052 and 92.006' : 'Implied warranty of habitability';
      return { severity: 'alert', rule: statute, explanation: 'The landlord has to keep a rental habitable — including heating, plumbing and the structure. A lease generally cannot shift that duty to the tenant, though tenants remain liable for damage they cause.' };
    },
    ask: 'Please limit the tenant’s repair duties to minor upkeep and damage caused by the tenant, with the landlord responsible for structure, heating, plumbing and other essential systems.',
  },
  {
    id: 'banned-fees',
    title: 'Check-out, renewal, admin or compulsory cleaning fee',
    pattern: /check[\s-]?out\s+fee|inventory\s+fee|renewal\s+fee|admin(?:istration|istrative)?\s+fee|reference\s+fee|referencing\s+fee|set[\s-]?up\s+fee|professional(?:ly)?\s+(?:carpet\s+)?clean/i,
    judge: (j) => {
      if (j === 'england') return { severity: 'alert', rule: 'Tenant Fees Act 2019', explanation: 'Fees for check-out, inventory, renewal, referencing or administration, and a requirement to pay for professional cleaning, are prohibited payments in England. Trading Standards can fine a landlord or agent up to £5,000 for a first breach.' };
      if (j === 'scotland') return { severity: 'alert', rule: 'Rent (Scotland) Act 1984 s.82', explanation: 'In Scotland any charge beyond rent and a refundable deposit — including admin, reference or check-out fees — is an unlawful premium and can be reclaimed.' };
      return { severity: 'info', rule: 'State law and lease disclosure', explanation: 'Admin, renewal and cleaning fees are generally allowed in US leases if disclosed, though some states cap application or screening fees. Ask what the fee covers and whether it is refundable.' };
    },
    ask: 'Please remove this fee from the agreement, or confirm in writing what it covers and that it is permitted.',
  },
  {
    id: 'guest-ban',
    title: 'Blanket ban or fee for guests',
    pattern: /no\s+overnight\s+guests|guest\s+fee|visitor\s+fee|guests?\s+(?:are\s+|is\s+)?(?:strictly\s+)?(?:not\s+(?:permitted|allowed)|prohibited)|overnight\s+guests?\s+(?:are\s+)?(?:strictly\s+)?prohibited/i,
    judge: (j) => {
      if (j === 'new-york') return { severity: 'alert', rule: 'N.Y. Real Prop. Law § 235-f', explanation: 'New York’s roommate law lets a tenant share the home with immediate family and, in most cases, one extra occupant and that person’s children. A blanket guest ban conflicts with it.' };
      return { severity: 'warn', rule: 'Quiet enjoyment; unfair-terms rules', explanation: 'A landlord can limit long-term extra occupants, but a total ban on occasional overnight guests, or a per-guest fee, is often unenforceable or unfair. Ask for a reasonable limit instead (for example, up to 14 nights in a row).' };
    },
    ask: 'Please change this clause to allow reasonable occasional overnight guests without a fee, with any limit applying only to long-term occupants.',
  },
  {
    id: 'liability-waiver',
    title: 'Landlord excused from liability for its own negligence',
    pattern: /(?:landlord|owner|lessor)\s+(?:shall|will)\s+not\s+be\s+(?:held\s+)?(?:liable|responsible)\s+for\s+any|hold\s+(?:the\s+)?(?:landlord|owner|lessor)\s+harmless|waives?\s+(?:any\s+and\s+)?all\s+claims/i,
    judge: (j) => {
      if (j === 'california') return { severity: 'alert', rule: 'Cal. Civ. Code § 1953(a)', explanation: 'California voids lease terms that excuse the landlord from liability for its own negligence or waive the tenant’s right to sue.' };
      if (j === 'new-york') return { severity: 'alert', rule: 'N.Y. Gen. Oblig. Law § 5-321', explanation: 'New York voids lease terms exempting a landlord from liability for damage or injury caused by its own negligence.' };
      if (j === 'england' || j === 'scotland') return { severity: 'alert', rule: 'Consumer Rights Act 2015 ss.62 and 65', explanation: 'A landlord cannot exclude liability for death or personal injury caused by negligence, and other one-sided exclusions may be unfair and not binding on the tenant.' };
      return { severity: 'warn', rule: 'State law on exculpatory clauses', explanation: 'Many US courts refuse to enforce lease terms that excuse a landlord’s own negligence. Ask for the clause to be limited to damage the landlord did not cause.' };
    },
    ask: 'Please limit this clause so it does not excuse the landlord from liability for its own negligence or failure to repair.',
  },
  {
    id: 'rent-change-anytime',
    title: 'Rent can be raised at any time',
    pattern: /(?:increase|raise|change|adjust)\s+(?:the\s+)?rent\s+at\s+any\s+time|rent\s+may\s+be\s+(?:increased|raised|changed)\s+at\s+any\s+time/i,
    judge: (j) => {
      if (j === 'england') return { severity: 'alert', rule: 'Housing Act 1988 s.13', explanation: 'For most assured tenancies in England, rent can only be raised once a year using the statutory notice procedure, with at least two months’ notice.' };
      if (j === 'california') return { severity: 'alert', rule: 'Cal. Civ. Code §§ 827 and 1947.12', explanation: 'During a fixed term the rent is set by the lease. For month-to-month tenancies California requires 30 days’ written notice (90 if the rise is over 10%), and AB 1482 caps yearly rises for covered units.' };
      return { severity: 'warn', rule: 'Lease term and notice law', explanation: 'During a fixed-term lease the rent is normally fixed unless the lease sets out a clear increase. Month-to-month increases need written notice under state law.' };
    },
    ask: 'Please fix the rent for the lease term, or set out exactly when and by how much it can change, with written notice.',
  },
];

function sentences(text: string) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.;!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function checkLease(text: string, j: Jurisdiction): Finding[] {
  const found: Finding[] = [];
  for (const rule of RULES) {
    for (const sentence of sentences(text)) {
      const match = rule.pattern.exec(sentence);
      if (!match || (rule.accept && !rule.accept(sentence, match))) continue;
      const verdict = rule.judge(j);
      if (!verdict) continue;
      found.push({ id: rule.id, title: rule.title, ask: rule.ask, quote: sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence, ...verdict });
      break;
    }
  }
  const order: Record<Severity, number> = { alert: 0, warn: 1, info: 2 };
  return found.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function amendmentLetter(findings: Finding[], j: Jurisdiction) {
  if (!findings.length) return '';
  const points = findings.map((f, i) => `${i + 1}. “${f.quote}”\n   ${f.ask} (See ${f.rule}.)`).join('\n\n');
  return `Dear Landlord / Letting Agent,\n\nThank you for sending the agreement. Before signing, I would like to ask for the following changes${j === 'general' ? '' : ` in line with the rules that apply in ${JURISDICTION_NAMES[j]}`}:\n\n${points}\n\nI am happy to discuss these. Please send an updated agreement, or confirm the changes in writing.\n\nKind regards,`;
}

export const LEASE_SAMPLES: [string, string][] = [
  ['Non-refundable deposit', 'Tenant agrees that the $2,000 security deposit is strictly non-refundable as a standard turnover cleaning fee upon lease termination.'],
  ['Entry at any time', 'Landlord may enter the premises at any time without notice to inspect, show the unit or make repairs.'],
  ['Tenant pays repairs', 'Tenant shall be responsible for all repairs to the heating, plumbing and structure of the property, regardless of cause.'],
  ['UK check-out fee', 'The tenant will pay a check-out fee of £150 and must have the property professionally cleaned at the end of the tenancy.'],
  ['Guest ban', 'No overnight guests are permitted at any time. A guest fee of $25 per night applies to any visitor.'],
  ['A fair clause', 'Landlord may enter the premises with at least 24 hours’ written notice during normal business hours, except in an emergency.'],
];
