'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, CalendarDays, Sparkles } from 'lucide-react';
import { calculateProration, formatMoney, monthEndISO, type ProrationMethod } from '@/lib/calculations';
import type { CurrencyCode } from '@/lib/site-data';
import { Card, SectionTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

const methods: { id: ProrationMethod; label: string; hint: string }[] = [
  { id: 'exact', label: 'Exact days in month', hint: 'Daily rate follows each calendar month.' },
  { id: 'thirty', label: '30-day fixed', hint: 'Uses a standard 30-day month.' },
  { id: 'annual', label: 'Yearly average', hint: 'Monthly rent × 12, divided by 365.' },
];

function localTodayISO() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export default function ProratedCalculator({ currency }: { currency: CurrencyCode }) {
  const [rent, setRent] = useState(2400);
  const [moveIn, setMoveIn] = useState('');
  const [moveOut, setMoveOut] = useState('');
  const [method, setMethod] = useState<ProrationMethod>('exact');
  const [copied, setCopied] = useState(false);
  useEffect(() => { setMoveIn(localTodayISO()); }, []);
  const monthEnd = useMemo(() => monthEndISO(moveIn), [moveIn]);
  const effectiveMoveOut = moveOut || monthEnd;
  const result = useMemo(() => calculateProration(rent, moveIn, effectiveMoveOut, method), [rent, moveIn, effectiveMoveOut, method]);
  const selectedMethod = methods.find((item) => item.id === method)!;

  async function copyBreakdown() {
    const summary = [
      'RentWise Tools · Prorated rent estimate',
      `Monthly rent: ${formatMoney(rent, currency)}`,
      `Occupancy: ${moveIn || '—'} to ${effectiveMoveOut || '—'} (${result.days} days, inclusive)`,
      `Method: ${selectedMethod.label}`,
      `Daily rate: ${formatMoney(result.dailyRate, currency)}`,
      `Estimated rent owed: ${formatMoney(result.total, currency)}`,
      'Estimate only; confirm the lease terms with your landlord.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }

  return <div className="calculator-layout">
    <Card className="calculator-input-card">
      <SectionTitle eyebrow="MOVE-IN MATH" title="Prorated rent, made clear" description="See exactly what a partial month could cost. Update any field to recalculate instantly." />
      <Input id="prorated-rent" label="Monthly rent" type="number" inputMode="decimal" min="0" step="50" value={rent} onChange={(event) => setRent(Math.max(0, Number(event.target.value) || 0))} suffix={currency === 'GBP' ? 'GBP' : 'USD'} />
      <div className="preset-row" aria-label="Rent amount presets">
        <span className="preset-caption">Quick set</span>
        {[1000, 2000, 3000].map((amount) => <button key={amount} type="button" className={`preset ${rent === amount ? 'preset-active' : ''}`} onClick={() => setRent(amount)}>{formatMoney(amount, currency).replace(/\.00$/, '')}</button>)}
      </div>
      <div className="field-grid two-fields">
        <Input id="move-in" label="Move-in date" type="date" value={moveIn} onChange={(event) => setMoveIn(event.target.value)} />
        <Input id="move-out" label="Move-out date" type="date" value={moveOut} min={moveIn || undefined} onChange={(event) => setMoveOut(event.target.value)} hint="Leave blank to use the last day of the move-in month." />
      </div>
      <div className="field-wrap">
        <label className="field-label" htmlFor="proration-method">Calculation method</label>
        <div className="select-shell"><select id="proration-method" className="field-input" value={method} onChange={(event) => setMethod(event.target.value as ProrationMethod)}>{methods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><span className="select-chevron" aria-hidden="true">⌄</span></div>
        <p className="field-hint">{selectedMethod.hint}</p>
      </div>
      {moveOut && result.days === 0 && <p className="inline-warning" role="alert">Move-out must be the same day or later than move-in.</p>}
      <p className="fine-print"><CalendarDays size={14} aria-hidden="true" /> Occupancy counts both move-in and move-out dates.</p>
    </Card>

    <Card className="receipt-card" aria-live="polite" aria-label="Prorated rent estimate">
      <div className="receipt-topline"><span className="live-dot" /> LIVE ESTIMATE <span className="receipt-mark"><Sparkles size={16} /></span></div>
      <div className="receipt-heading"><span>YOUR RENT BREAKDOWN</span><span className="receipt-stamp">RENTWISE</span></div>
      <div className="receipt-total-label">Total prorated rent owed</div>
      <div className="receipt-total">{formatMoney(result.total, currency)}</div>
      <div className="receipt-period">{result.days ? `${result.days} days of occupancy` : 'Choose valid dates to see your estimate'}</div>
      <div className="receipt-divider" />
      <div className="receipt-row"><span>Monthly rent</span><strong>{formatMoney(rent, currency)}</strong></div>
      <div className="receipt-row"><span>Effective daily rate</span><strong>{formatMoney(result.dailyRate, currency)}</strong></div>
      <div className="receipt-row"><span>Method</span><strong>{selectedMethod.label}</strong></div>
      <div className="receipt-row"><span>Move-in</span><strong>{moveIn || '—'}</strong></div>
      <div className="receipt-row"><span>Move-out</span><strong>{effectiveMoveOut || '—'}{!moveOut && effectiveMoveOut ? ' · month-end' : ''}</strong></div>
      <button type="button" className="button button-dark receipt-copy" onClick={copyBreakdown} disabled={!result.days} aria-label="Copy prorated rent breakdown to clipboard">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied to clipboard' : 'Copy breakdown'}</button>
      <p className="receipt-footnote">Planning estimate only. Your signed lease takes precedence.</p>
    </Card>
  </div>;
}
