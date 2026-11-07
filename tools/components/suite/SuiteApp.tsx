'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, CalendarRange, ChartNoAxesCombined, Check, Copy, HeartHandshake, House,
  KeyRound, LockKeyhole, Plus, Printer, ReceiptText, Route, Ruler, Search, ShieldCheck, Sparkles, Trash2, TrendingUp, Truck,
  UsersRound, WalletCards, X,
} from 'lucide-react';
import { SUITE_TOOLS, getSuiteTool } from '@/lib/tool-registry';
import { calculateTool, toolDefaults, type CalculationResult } from '@/lib/suite-calculations';
import { LEASE_SAMPLES } from '@/lib/lease-rules';

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  CalendarDays, CalendarRange, ChartNoAxesCombined, HeartHandshake, House, KeyRound, ReceiptText, Route, Ruler, ShieldCheck, Sparkles, TrendingUp, Truck, UsersRound, WalletCards,
};
const CATEGORY_TONE: Record<string, string> = { Lease: 'sun', Budget: 'mint', Roommates: 'sky', Planning: 'peach', Moving: 'sun', Investment: 'mint' };

type Currency = 'USD' | 'GBP';
type Data = Record<string, any>;
type Field = {
  key: string; label: string;
  type?: 'number' | 'text' | 'textarea' | 'date' | 'select' | 'toggle';
  unit?: 'money' | 'area' | 'fuel' | 'mpg' | '%' | 'days' | 'months' | 'years' | 'hours' | 'miles' | 'minutes';
  options?: [string, string][]; help?: string; presets?: number[]; samples?: [string, string][];
  showIf?: (d: Data) => boolean; wide?: boolean;
};

const FIELDS: Record<string, Field[]> = {
  'rent-affordability': [
    { key: 'incomeMode', label: 'How you are paid', type: 'select', options: [['annual', 'Annual salary'], ['hourly', 'Hourly wage']] },
    { key: 'annualIncome', label: 'Gross annual income', unit: 'money', presets: [40000, 60000, 80000], showIf: (d) => d.incomeMode !== 'hourly' },
    { key: 'hourlyWage', label: 'Hourly wage (before tax)', unit: 'money', showIf: (d) => d.incomeMode === 'hourly' },
    { key: 'hoursPerWeek', label: 'Hours per week', unit: 'hours', showIf: (d) => d.incomeMode === 'hourly' },
    { key: 'debt', label: 'Monthly debt payments', unit: 'money', help: 'Car, student loan, card minimums — not rent.' },
  ],
  'move-in-cash': [
    { key: 'rent', label: 'Monthly rent', unit: 'money', presets: [1000, 2000, 3000] },
    { key: 'depositMonths', label: 'Security deposit', unit: 'months', help: 'England: 5 weeks’ rent is about 1.15 months.' },
    { key: 'lastMonth', label: 'Last month’s rent up front', type: 'toggle' },
    { key: 'moving', label: 'Moving costs', unit: 'money' },
    { key: 'fees', label: 'Application & admin fees', unit: 'money' },
    { key: 'utilities', label: 'Utility deposits', unit: 'money' },
  ],
  'roommate-rent-splitter': [{ key: 'totalRent', label: 'Total monthly rent', unit: 'money', presets: [1500, 2000, 3000] }],
  'prorated-rent': [
    { key: 'monthlyRent', label: 'Monthly rent', unit: 'money', presets: [1000, 2000, 3000] },
    { key: 'moveIn', label: 'Move-in date', type: 'date' },
    { key: 'moveOut', label: 'Move-out date (optional)', type: 'date', help: 'Leave blank to charge to the end of the move-in month.' },
    { key: 'method', label: 'Day-count method', type: 'select', options: [['exact', 'Exact days in each month'], ['thirty', '30-day month'], ['annual', '365-day year']] },
  ],
  'utility-splitter': [
    { key: 'electric', label: 'Electric bill', unit: 'money' },
    { key: 'gas', label: 'Gas bill', unit: 'money' },
    { key: 'water', label: 'Water bill', unit: 'money' },
    { key: 'internet', label: 'Internet bill', unit: 'money', help: 'Split equally, even for days away.' },
    { key: 'billingDays', label: 'Billing period', unit: 'days' },
  ],
  'rent-increase': [
    { key: 'currentRent', label: 'Current monthly rent', unit: 'money' },
    { key: 'newRent', label: 'Proposed monthly rent', unit: 'money' },
    { key: 'noticeDate', label: 'Notice received', type: 'date' },
    { key: 'renewalDate', label: 'Increase takes effect', type: 'date' },
    { key: 'jurisdiction', label: 'Where you rent', type: 'select', options: [['general', 'Anywhere (maths only)'], ['california', 'California'], ['england', 'England']] },
    { key: 'cpi', label: 'Regional CPI for the cap', unit: '%', help: 'Enter the published CPI for your region and period. Nothing is fetched.', showIf: (d) => d.jurisdiction === 'california' },
  ],
  'rent-vs-buy': [
    { key: 'rent', label: 'Monthly rent', unit: 'money' },
    { key: 'price', label: 'Home price', unit: 'money' },
    { key: 'downPayment', label: 'Down payment', unit: '%' },
    { key: 'interest', label: 'Mortgage rate', unit: '%' },
    { key: 'loanYears', label: 'Loan term', unit: 'years' },
    { key: 'years', label: 'Years you’ll stay', unit: 'years' },
    { key: 'rentGrowth', label: 'Rent growth per year', unit: '%' },
    { key: 'homeGrowth', label: 'Home value growth per year', unit: '%' },
    { key: 'investmentReturn', label: 'Investment return', unit: '%' },
    { key: 'taxRate', label: 'Property tax rate', unit: '%' },
    { key: 'insurance', label: 'Home insurance per year', unit: 'money' },
    { key: 'maintenancePct', label: 'Maintenance per year', unit: '%' },
    { key: 'buyClosingPct', label: 'Buying costs', unit: '%' },
    { key: 'sellClosingPct', label: 'Selling costs', unit: '%' },
  ],
  'moving-cost-estimator': [
    { key: 'apartmentSize', label: 'Home size', type: 'select', options: [['studio', 'Studio'], ['1', '1 bedroom'], ['2', '2 bedrooms'], ['3', '3+ bedrooms']] },
    { key: 'service', label: 'Type of move', type: 'select', options: [['diy', 'DIY truck'], ['full', 'Full-service movers']] },
    { key: 'distance', label: 'One-way distance', unit: 'miles' },
    { key: 'mpg', label: 'Truck fuel economy', unit: 'mpg' },
    { key: 'fuelPrice', label: 'Fuel price', unit: 'fuel' },
    { key: 'baseCost', label: 'Truck hire or mover quote', unit: 'money' },
    { key: 'labor', label: 'Labor / helpers', unit: 'money' },
  ],
  'commute-vs-rent': [
    { key: 'mode', label: 'How you commute', type: 'select', options: [['car', 'Car'], ['transit', 'Public transit']], wide: true },
    { key: 'rentA', label: 'Home A rent', unit: 'money' },
    { key: 'rentB', label: 'Home B rent', unit: 'money' },
    { key: 'minutesA', label: 'Home A one-way commute', unit: 'minutes' },
    { key: 'minutesB', label: 'Home B one-way commute', unit: 'minutes' },
    { key: 'distanceA', label: 'Home A one-way distance', unit: 'miles', showIf: (d) => d.mode !== 'transit' },
    { key: 'distanceB', label: 'Home B one-way distance', unit: 'miles', showIf: (d) => d.mode !== 'transit' },
    { key: 'transitA', label: 'Home A monthly pass', unit: 'money', showIf: (d) => d.mode === 'transit' },
    { key: 'transitB', label: 'Home B monthly pass', unit: 'money', showIf: (d) => d.mode === 'transit' },
    { key: 'mpg', label: 'Car fuel economy', unit: 'mpg', showIf: (d) => d.mode !== 'transit' },
    { key: 'gasPrice', label: 'Fuel price', unit: 'fuel', showIf: (d) => d.mode !== 'transit' },
    { key: 'workdays', label: 'Commuting days per month', unit: 'days' },
  ],
  'sublease-rate': [
    { key: 'rent', label: 'Your monthly rent', unit: 'money' },
    { key: 'premium', label: 'Furnished premium', unit: '%', help: 'Use a negative number for a discount.' },
    { key: 'startDate', label: 'Sublet starts', type: 'date' },
    { key: 'endDate', label: 'Sublet ends', type: 'date' },
    { key: 'includeUtilities', label: 'Utilities included', type: 'toggle' },
    { key: 'utilities', label: 'Monthly utilities', unit: 'money', showIf: (d) => !!d.includeUtilities },
  ],
  'cap-rate-calculator': [
    { key: 'price', label: 'Purchase price', unit: 'money' },
    { key: 'rent', label: 'Monthly rent', unit: 'money' },
    { key: 'vacancy', label: 'Vacancy', unit: '%' },
    { key: 'taxes', label: 'Property tax per year', unit: 'money' },
    { key: 'insurance', label: 'Insurance per year', unit: 'money' },
    { key: 'maintenancePct', label: 'Maintenance (% of price)', unit: '%' },
    { key: 'otherExpenses', label: 'Other costs per year', unit: 'money', help: 'Management, HOA / service charge, etc.' },
    { key: 'downPayment', label: 'Down payment', unit: '%' },
    { key: 'interest', label: 'Mortgage rate', unit: '%' },
    { key: 'loanYears', label: 'Loan term', unit: 'years' },
    { key: 'closingCosts', label: 'Closing costs', unit: 'money' },
  ],
  'rent-per-sqft': [
    { key: 'rent', label: 'Monthly rent', unit: 'money' },
    { key: 'area', label: 'Floor area', unit: 'area' },
    { key: 'benchmark', label: 'Compare with (rent per area)', unit: 'money', help: 'Optional: another listing’s monthly rent ÷ its area.' },
  ],
  'couple-rent-splitter': [
    { key: 'rent', label: 'Total monthly rent', unit: 'money', presets: [1800, 2400, 3200] },
    { key: 'incomeA', label: 'Partner 1 take-home pay / month', unit: 'money' },
    { key: 'incomeB', label: 'Partner 2 take-home pay / month', unit: 'money' },
    { key: 'otherSharedExpenses', label: 'Other shared bills / month', unit: 'money', help: 'Optional: split in the same proportion.' },
  ],
  'security-deposit-refund': [
    { key: 'state', label: 'Where you rented', type: 'select', options: [['california', 'California — 21 days'], ['new-york', 'New York — 14 days'], ['texas', 'Texas — 30 days'], ['florida', 'Florida — 15 days'], ['england', 'England — 10 days after agreement'], ['general', 'Another US state — 30-day estimate']] },
    { key: 'moveOutDate', label: 'Move-out date', type: 'date' },
    { key: 'depositAmount', label: 'Deposit paid', unit: 'money', presets: [1000, 2000, 3000] },
    { key: 'returnedAmount', label: 'Already returned', unit: 'money' },
  ],
  'ai-lease-scanner': [
    { key: 'jurisdiction', label: 'Where the property is', type: 'select', wide: true, options: [['california', 'California'], ['new-york', 'New York'], ['texas', 'Texas'], ['florida', 'Florida'], ['england', 'England'], ['scotland', 'Scotland'], ['general', 'Another US state']] },
    { key: 'clauseText', label: 'Lease clause', type: 'textarea', wide: true, samples: LEASE_SAMPLES, help: 'Paste one clause or a few paragraphs. Nothing leaves your browser.' },
  ],
};

const ARRAYS: Record<string, { key: string; title: string; item: string; fields: Field[]; blank: Data }> = {
  'roommate-rent-splitter': {
    key: 'rooms', title: 'Bedrooms', item: 'Bedroom', blank: { name: '', area: 120, bath: false, view: false, parking: false },
    fields: [
      { key: 'name', label: 'Who / which room', type: 'text', wide: true },
      { key: 'area', label: 'Room size', unit: 'area', wide: true },
      { key: 'bath', label: 'Private bath (+15%)', type: 'toggle' },
      { key: 'view', label: 'View / balcony (+5%)', type: 'toggle' },
      { key: 'parking', label: 'Parking (+10%)', type: 'toggle' },
    ],
  },
  'utility-splitter': {
    key: 'people', title: 'Housemates', item: 'Housemate', blank: { name: '', away: 0, paid: 0 },
    fields: [
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'away', label: 'Days away', unit: 'days' },
      { key: 'paid', label: 'Already paid', unit: 'money' },
    ],
  },
};

const LABELS: Record<string, string> = Object.fromEntries([
  ...Object.values(FIELDS).flat(), ...Object.values(ARRAYS).flatMap((a) => a.fields),
  { key: 'moveInDate', label: 'Move-in date' }, { key: 'moveOutDate', label: 'Move-out date' },
].map((f) => [f.key, f.label]));

/** Calculation errors name the input key; show the label the person actually sees. */
const friendlyError = (message: string) =>
  message.replace(/^(\w+) must be a finite number from (-?[\d.]+) to (\d+)\.$/, (_m, key: string, min: string, max: string) =>
    `${LABELS[key] || key} must be a number${Number(max) >= 1e15 ? ` of at least ${min}` : ` from ${min} to ${max}`}.`)
    .replace(/^(\w+) must be a valid YYYY-MM-DD date\.$/, (_m, key: string) => `Enter a valid ${(LABELS[key] || key).toLowerCase()}.`)
    .replace(/^(\w+) must be on or after (\w+)\.$/, (_m, a: string, b: string) => `${LABELS[a] || a} must be on or after the ${(LABELS[b] || b).toLowerCase()}.`);

const symbol = (c: Currency) => (c === 'USD' ? '$' : '£');
const money = (n: number, c: Currency) => new Intl.NumberFormat(c === 'USD' ? 'en-US' : 'en-GB', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n || 0);
const shortMoney = (n: number, c: Currency) => new Intl.NumberFormat(c === 'USD' ? 'en-US' : 'en-GB', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
const unitLabel = (u: Field['unit'], c: Currency) =>
  u === 'area' ? (c === 'USD' ? 'sq ft' : 'sq m') : u === 'fuel' ? (c === 'USD' ? `${symbol(c)}/gal` : `${symbol(c)}/litre`) : u === 'mpg' ? (c === 'USD' ? 'US mpg' : 'UK mpg') : u === 'money' ? '' : u || '';

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const I = ICONS[name] || Sparkles;
  return <I size={size} strokeWidth={2.2} />;
}

const CURRENCY_KEY = 'rentwise-currency';

type Props = {
  slug?: string;
  children?: React.ReactNode;
  /** Location pages override the heading and start in the local currency. */
  heading?: string;
  intro?: string;
  note?: React.ReactNode;
  initialCurrency?: Currency;
};

export default function SuiteApp({ slug, children, heading, intro, note, initialCurrency }: Props) {
  const tool = getSuiteTool(slug);
  const [currency, setCurrency] = useState<Currency>(initialCurrency || 'USD');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [data, setData] = useState<Data>(() => (slug ? structuredClone(toolDefaults[slug] || {}) : {}));
  const [copied, setCopied] = useState<'' | 'result' | 'letter'>('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (initialCurrency) return;
    try { const saved = localStorage.getItem(CURRENCY_KEY); if (saved === 'USD' || saved === 'GBP') setCurrency(saved); } catch { /* storage unavailable */ }
  }, [initialCurrency]);
  const chooseCurrency = (c: Currency) => {
    setCurrency(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    const el = resultRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setResultVisible(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [tool]);

  const result = useMemo(() => (tool ? calculateTool(tool.slug, data, currency) : null), [tool, data, currency]);

  const categories = ['All', ...Array.from(new Set(SUITE_TOOLS.map((t) => t.category)))];
  const q = query.trim().toLowerCase();
  const list = SUITE_TOOLS.filter((t) => (category === 'All' || t.category === category) && (!q || `${t.name} ${t.h1} ${t.description} ${t.category} ${t.keywords.join(' ')}`.toLowerCase().includes(q)));

  const set = (key: string, value: unknown) => setData((d) => ({ ...d, [key]: value }));

  const fmt = (value: number | string, unit?: string, text?: string) => {
    if (text) return text;
    if (typeof value !== 'number') return String(value);
    if (unit === 'money') return money(value, currency);
    if (unit === 'percent') return `${value.toFixed(1)}%`;
    if (unit === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    return String(value);
  };

  const plainResult = () => {
    if (!result || !tool) return '';
    return [
      `RentWise · ${tool.h1}`,
      `${result.headline}: ${fmt(result.value, result.unit, result.textValue)}`,
      ...result.rows.map((r) => `${r.label}: ${fmt(r.value, r.unit, r.textValue)}`),
      ...(result.findings || []).map((f) => `• ${f.title} — ${f.rule}`),
      ...result.notes.map((n) => `Note: ${n}`),
      'Estimate only — check figures and local rules before deciding.',
      `https://almassdm.pro/rentwise/tools/${tool.slug}/`,
    ].join('\n');
  };

  const copy = async (what: 'result' | 'letter') => {
    const text = what === 'letter' ? result?.letter || '' : plainResult();
    try { await navigator.clipboard.writeText(text); setCopied(what); setCopyFailed(false); } catch { setCopyFailed(true); }
    window.setTimeout(() => setCopied(''), 2200);
  };

  const control = (f: Field, id: string, value: any, update: (v: any) => void) => {
    if (f.type === 'select') {
      return <div className="rw-select"><select id={id} name={id} value={value ?? ''} onChange={(e) => update(e.target.value)}>{f.options?.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></div>;
    }
    if (f.type === 'toggle') {
      return <label className="rw-switch"><input id={id} name={id} type="checkbox" checked={!!value} onChange={(e) => update(e.target.checked)} /><span className="rw-switch-track" aria-hidden="true" /><span>{value ? 'Yes' : 'No'}</span></label>;
    }
    if (f.type === 'textarea') {
      return <textarea id={id} name={id} rows={6} value={value ?? ''} onChange={(e) => update(e.target.value)} placeholder="Paste a clause from your lease or tenancy agreement…" />;
    }
    if (f.type === 'text' || f.type === 'date') {
      return <input id={id} name={id} className="rw-plain" type={f.type} value={value ?? ''} onChange={(e) => update(e.target.value)} />;
    }
    const suffix = unitLabel(f.unit, currency);
    const min = ['homeGrowth', 'rentGrowth'].includes(f.key) ? -50 : f.key === 'premium' ? -100 : 0;
    return <div className="rw-input">
      {f.unit === 'money' && <span className="rw-pre" aria-hidden="true">{symbol(currency)}</span>}
      <input id={id} name={id} type="number" inputMode="decimal" step="any" min={min} value={value ?? ''} onChange={(e) => update(e.target.value === '' ? '' : Number(e.target.value))} />
      {suffix && <span className="rw-suf" aria-hidden="true">{suffix}</span>}
    </div>;
  };

  const field = (f: Field, id: string, value: any, update: (v: any) => void) => (
    <div className={`rw-field${f.wide || f.type === 'textarea' ? ' wide' : ''}${f.type === 'toggle' ? ' toggle' : ''}`} key={id}>
      <label htmlFor={id}>{f.label}{f.unit && f.unit !== 'money' && <span className="sr-only"> ({unitLabel(f.unit, currency)})</span>}</label>
      {control(f, id, value, update)}
      {f.help && <p className="rw-help">{f.help}</p>}
      {f.presets && <div className="rw-chips">{f.presets.map((n) => <button type="button" key={n} className={value === n ? 'on' : ''} onClick={() => update(n)}>{shortMoney(n, currency)}</button>)}</div>}
      {f.samples && <div className="rw-samples"><span>Try an example:</span>{f.samples.map(([label, text]) => <button type="button" key={label} className={value === text ? 'on' : ''} onClick={() => update(text)}>{label}</button>)}</div>}
    </div>
  );

  const header = (
    <header className="rw-top">
      <div className="rw-wrap rw-nav">
        <a className="rw-brand" href="/rentwise/" aria-label="RentWise — all free rent tools">
          <span className="rw-logo"><House size={20} strokeWidth={2.4} /></span>
          <span>RentWise<small>Free rent tools</small></span>
        </a>
        <nav className="rw-links" aria-label="RentWise">
          <a href="/rentwise/">All tools</a>
          <a href="/">Almas SDM</a>
        </nav>
        <div className="rw-cur" role="group" aria-label="Currency">
          {(['USD', 'GBP'] as Currency[]).map((c) => <button key={c} type="button" aria-pressed={currency === c} onClick={() => chooseCurrency(c)}>{c === 'USD' ? '$ USD' : '£ GBP'}</button>)}
        </div>
      </div>
    </header>
  );

  const footer = (
    <footer className="rw-foot">
      <div className="rw-wrap rw-foot-in">
        <div>
          <a className="rw-brand" href="/rentwise/"><span className="rw-logo"><House size={18} strokeWidth={2.4} /></span><span>RentWise<small>Free rent tools</small></span></a>
          <p>Free calculators for renters in the US and UK. Planning estimates only — not legal, tax or financial advice.</p>
        </div>
        <nav aria-label="Popular tools">
          <h2>Popular tools</h2>
          {['rent-affordability', 'prorated-rent', 'roommate-rent-splitter', 'move-in-cash', 'security-deposit-refund'].map((s) => { const t = getSuiteTool(s)!; return <a key={s} href={`/rentwise/tools/${s}/`}>{t.h1}</a>; })}
        </nav>
        <nav aria-label="More">
          <h2>More</h2>
          <a href="/rentwise/">All 15 tools</a>
          <a href="/">Almas SDM home</a>
          <a href="/legal.html">Privacy &amp; terms</a>
        </nav>
      </div>
    </footer>
  );

  if (!tool) {
    return <div className="rw">
      {header}
      <main id="main">
        <section className="rw-hero rw-wrap">
          <span className="rw-kicker"><i aria-hidden="true" /> 15 free tools · US &amp; UK</span>
          <h1>Rent calculators,<br /><span className="hl">done right.</span></h1>
          <p className="rw-sub">Free calculators for renters: what you can afford, what to pay up front, how to split it fairly — and what your lease really says. No signup. Your numbers never leave your browser.</p>
          <div className="rw-search">
            <Search size={20} aria-hidden="true" />
            <input type="search" aria-label="Search rent tools" placeholder="Search: deposit, prorated, roommates…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}
            <span className="rw-count" aria-live="polite">{list.length} {list.length === 1 ? 'tool' : 'tools'}</span>
          </div>
          <div className="rw-cats" role="group" aria-label="Filter by category">
            {categories.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>{c === 'All' ? 'All tools' : c}</button>)}
          </div>
        </section>

        <section className="rw-wrap rw-grid" aria-label="Rent calculators">
          {list.length === 0 && <div className="rw-empty"><b>No tools match “{query}”.</b><button type="button" className="rw-btn" onClick={() => { setQuery(''); setCategory('All'); }}>Show all tools</button></div>}
          {list.map((t) => (
            <a href={`/rentwise/tools/${t.slug}/`} className="rw-card" key={t.slug}>
              <span className="rw-card-top">
                <span className={`rw-ic ${CATEGORY_TONE[t.category] || 'sun'}`}><Icon name={t.icon} /></span>
                <span className="rw-num">{String(t.priority).padStart(2, '0')}</span>
              </span>
              <h2>{t.h1}</h2>
              <p>{t.description}</p>
              <span className="rw-card-foot"><span className="rw-tag">{t.category}</span><span className="rw-open">Open <ArrowRight size={16} /></span></span>
            </a>
          ))}
        </section>

        <section className="rw-wrap rw-why" aria-labelledby="why-title">
          <h2 id="why-title">Why renters use RentWise</h2>
          <div className="rw-why-grid">
            <div><span className="rw-ic mint"><LockKeyhole size={22} /></span><h3>Private by design</h3><p>Every sum runs in your browser. No account, no email, nothing sent to a server.</p></div>
            <div><span className="rw-ic sun"><ChartNoAxesCombined size={22} /></span><h3>Shows its working</h3><p>Each tool explains the formula, walks through an example and lists its assumptions.</p></div>
            <div><span className="rw-ic sky"><ShieldCheck size={22} /></span><h3>US &amp; UK rules</h3><p>Dollars or pounds, square feet or metres, and notes on the state and UK rules that apply.</p></div>
          </div>
        </section>
      </main>
      {footer}
    </div>;
  }

  const fields = (FIELDS[tool.slug] || []).filter((f) => !f.showIf || f.showIf(data));
  const array = ARRAYS[tool.slug];
  const rows: Data[] = array && Array.isArray(data[array.key]) ? data[array.key] : [];
  const r = result as CalculationResult;
  const status = r.error ? 'alert' : r.status || 'good';
  const statusText = r.error ? 'Check inputs' : status === 'alert' ? 'Red flag' : status === 'warn' ? 'Worth checking' : 'Looks fine';
  const sevText = { alert: 'Likely unlawful', warn: 'Negotiate', info: 'Good to know' } as const;

  return <div className="rw rw-has-bar">
    {header}
    <main id="main" className="rw-wrap">
      <nav className="rw-crumbs" aria-label="Breadcrumb">
        <ol><li><a href="/">Almas SDM</a></li><li><a href="/rentwise/">RentWise</a></li><li aria-current="page">{tool.name}</li></ol>
      </nav>
      <header className="rw-head">
        <span className={`rw-ic big ${CATEGORY_TONE[tool.category] || 'sun'}`}><Icon name={tool.icon} size={28} /></span>
        <div>
          <span className="rw-kicker"><i aria-hidden="true" /> {tool.category} · free tool</span>
          <h1>{heading || tool.h1}</h1>
          <p>{intro || tool.description}</p>
        </div>
      </header>
      {note}

      <div className="rw-work">
        <section className="rw-panel rw-form" aria-labelledby="form-title">
          <div className="rw-panel-head">
            <h2 id="form-title">{tool.slug === 'ai-lease-scanner' ? 'Your lease' : 'Your numbers'}</h2>
            <button type="button" className="rw-link" onClick={() => setData(structuredClone(toolDefaults[tool.slug] || {}))}>Reset example</button>
          </div>
          <div className="rw-fields">{fields.map((f) => field(f, f.key, data[f.key], (v) => set(f.key, v)))}</div>
          {array && <div className="rw-array">
            <div className="rw-array-head"><h3>{array.title}</h3><button type="button" className="rw-btn sm" disabled={rows.length >= 20} onClick={() => set(array.key, [...rows, { ...array.blank, name: `${array.item} ${rows.length + 1}` }])}><Plus size={16} /> Add {array.item.toLowerCase()}</button></div>
            {rows.map((row, i) => (
              <div className="rw-row" key={i}>
                <div className="rw-row-head"><b>{row.name || `${array.item} ${i + 1}`}</b>{rows.length > 1 && <button type="button" className="rw-icon-btn" aria-label={`Remove ${row.name || `${array.item} ${i + 1}`}`} onClick={() => set(array.key, rows.filter((_, x) => x !== i))}><Trash2 size={16} /></button>}</div>
                <div className="rw-fields">{array.fields.map((f) => field(f, `${array.key}-${i}-${f.key}`, row[f.key], (v) => set(array.key, rows.map((it, x) => (x === i ? { ...it, [f.key]: v } : it)))))}</div>
              </div>
            ))}
          </div>}
          <p className="rw-private"><LockKeyhole size={15} /> Your inputs stay in this browser.</p>
        </section>

        <aside id="result" ref={resultRef} className={`rw-panel rw-result ${status}`} aria-live="polite" aria-labelledby="result-title">
          <p className="rw-print-title">{tool.h1} · RentWise</p>
          <div className="rw-result-top"><span className="rw-eyebrow">Your result</span><span className={`rw-status ${status}`}>{statusText}</span></div>
          <div className="rw-big">
            <h2 id="result-title">{r.error ? 'Check your inputs' : r.headline}</h2>
            {r.error ? <p className="rw-error">{friendlyError(r.error)}</p> : <div className="rw-value">{fmt(r.value, r.unit, r.textValue)}</div>}
          </div>
          {!r.error && r.rows.length > 0 && <dl className="rw-ledger">{r.rows.map((row, i) => <div key={i}><dt>{row.label}</dt><dd>{fmt(row.value, row.unit, row.textValue)}</dd></div>)}</dl>}
          {r.findings && r.findings.length > 0 && <ol className="rw-findings">{r.findings.map((f) => (
            <li key={f.id} className={f.severity}>
              <span className={`rw-sev ${f.severity}`}>{sevText[f.severity]}</span>
              <h3>{f.title}</h3>
              <blockquote>“{f.quote}”</blockquote>
              <p>{f.explanation}</p>
              <p className="rw-rule"><b>Rule:</b> {f.rule}</p>
            </li>
          ))}</ol>}
          {r.letter && <details className="rw-letter"><summary>Amendment request you can send</summary><pre>{r.letter}</pre><button type="button" className="rw-btn sm" onClick={() => copy('letter')}>{copied === 'letter' ? <Check size={16} /> : <Copy size={16} />} {copied === 'letter' ? 'Copied' : 'Copy letter'}</button></details>}
          {!r.error && r.notes.length > 0 && <div className="rw-notes"><b>What this means</b>{r.notes.map((n, i) => <p key={i}>{renderNote(n)}</p>)}</div>}
          <p className="rw-fine">{currency === 'GBP' ? 'GBP mode uses pounds, square metres and litres; it does not convert amounts you typed in dollars. ' : ''}Planning estimate, not legal, tax or financial advice.</p>
          {!r.error && <div className="rw-actions">
            <button type="button" className="rw-btn ink" onClick={() => copy('result')}>{copied === 'result' ? <Check size={17} /> : <Copy size={17} />} {copied === 'result' ? 'Copied' : 'Copy breakdown'}</button>
            <button type="button" className="rw-btn" onClick={() => window.print()}><Printer size={17} /> Print / PDF</button>
          </div>}
          {copyFailed && <textarea className="rw-copy-fallback" aria-label="Copy this result manually" readOnly value={plainResult()} onFocus={(e) => e.currentTarget.select()} />}
        </aside>
      </div>

      {children}
      <a className="rw-back" href="/rentwise/"><ArrowLeft size={16} /> All rent tools</a>
    </main>
    {footer}
    <a className={`rw-bar${resultVisible ? ' hide' : ''}`} href="#result" aria-label="Jump to your result">
      <span><small>{r.error ? 'Check your inputs' : r.headline}</small><strong>{r.error ? '—' : fmt(r.value, r.unit, r.textValue)}</strong></span>
      <span className="rw-bar-go">See result <ArrowUpRight size={18} /></span>
    </a>
  </div>;
}

/** Notes may carry `[label](https://…)` links to official guidance. */
function renderNote(note: string) {
  const parts = note.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.map((part, i) => {
    const m = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    return m ? <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]} ↗</a> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
