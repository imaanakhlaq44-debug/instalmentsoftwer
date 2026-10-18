'use client';

import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import type { CurrencyCode } from '@/lib/site-data';
import { formatMoney, formatWholeMoney } from '@/lib/calculations';
import { Card, SectionTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

type Props = { currency: CurrencyCode; onCurrencyChange: (currency: CurrencyCode) => void };

export default function AffordabilityCalculator({ currency, onCurrencyChange }: Props) {
  const [incomeMode, setIncomeMode] = useState<'annual' | 'hourly'>('annual');
  const [annualIncome, setAnnualIncome] = useState(72000);
  const [hourlyWage, setHourlyWage] = useState(32);
  const [weeklyHours, setWeeklyHours] = useState(40);
  const [monthlyDebt, setMonthlyDebt] = useState(450);
  const [targetRent, setTargetRent] = useState(1800);
  const region = currency === 'GBP' ? 'UK' : 'US';

  const data = useMemo(() => {
    const yearly = incomeMode === 'hourly' ? hourlyWage * weeklyHours * 52 : annualIncome;
    const monthly = yearly / 12;
    const debt = Math.min(Math.max(0, monthlyDebt), monthly);
    const comfortable = Math.max(0, monthly * 0.25 - debt);
    const ruleBased = region === 'US' ? Math.min(monthly * 0.3, yearly / 36) : yearly / 40;
    const maximum = Math.max(0, ruleBased - debt);
    const riskyAbove = Math.max(0, monthly * 0.35 - debt);
    const burden = monthly > 0 ? ((Math.max(0, targetRent) + debt) / monthly) * 100 : 0;
    return { yearly, monthly, comfortable, maximum, riskyAbove, burden };
  }, [incomeMode, annualIncome, hourlyWage, weeklyHours, monthlyDebt, targetRent, region]);

  const gaugeWidth = Math.min(100, data.burden / 0.55);
  const status = data.burden <= 25 ? 'Comfortable range' : data.burden <= 35 ? 'Getting tight' : 'Stretched budget';
  const statusClass = data.burden <= 25 ? 'status-good' : data.burden <= 35 ? 'status-mid' : 'status-high';

  return <div className="calculator-layout">
    <Card className="calculator-input-card">
      <SectionTitle eyebrow="BUDGET CHECK" title="Find your comfortable number" description="Compare your income with common rent guidelines. Your estimate stays in this browser." />
      <div className="country-switch" role="group" aria-label="Rental market guideline">
        <button type="button" onClick={() => onCurrencyChange('USD')} aria-pressed={region === 'US'} className={region === 'US' ? 'country-active' : ''}><span>US</span><small>30% guide</small></button>
        <button type="button" onClick={() => onCurrencyChange('GBP')} aria-pressed={region === 'UK'} className={region === 'UK' ? 'country-active' : ''}><span>UK</span><small>40× guide</small></button>
      </div>
      <div className="segmented" role="group" aria-label="Income type">
        <button type="button" aria-pressed={incomeMode === 'annual'} className={incomeMode === 'annual' ? 'segment-active' : ''} onClick={() => setIncomeMode('annual')}>Annual income</button>
        <button type="button" aria-pressed={incomeMode === 'hourly'} className={incomeMode === 'hourly' ? 'segment-active' : ''} onClick={() => setIncomeMode('hourly')}>Hourly wage</button>
      </div>
      {incomeMode === 'annual' ? <Input id="annual-income" label="Gross annual income" type="number" inputMode="decimal" min="0" step="1000" value={annualIncome} onChange={(event) => setAnnualIncome(Math.max(0, Number(event.target.value) || 0))} suffix={currency === 'GBP' ? 'GBP / year' : 'USD / year'} /> : <div className="field-grid two-fields">
        <Input id="hourly-wage" label="Hourly wage" type="number" inputMode="decimal" min="0" step="1" value={hourlyWage} onChange={(event) => setHourlyWage(Math.max(0, Number(event.target.value) || 0))} suffix={currency === 'GBP' ? 'GBP / hr' : 'USD / hr'} />
        <Input id="weekly-hours" label="Hours per week" type="number" inputMode="decimal" min="0" max="168" step="1" value={weeklyHours} onChange={(event) => setWeeklyHours(Math.max(0, Number(event.target.value) || 0))} suffix="hours" />
      </div>}
      <div className="field-grid two-fields">
        <Input id="monthly-debt" label="Other monthly debt" type="number" inputMode="decimal" min="0" step="50" value={monthlyDebt} onChange={(event) => setMonthlyDebt(Math.max(0, Number(event.target.value) || 0))} suffix="/ month" hint="Debt is subtracted from each suggested rent ceiling." />
        <Input id="target-rent" label="Rent you're considering" type="number" inputMode="decimal" min="0" step="50" value={targetRent} onChange={(event) => setTargetRent(Math.max(0, Number(event.target.value) || 0))} suffix="/ month" />
      </div>
      <div className="tip-note"><Info size={16} aria-hidden="true" /><p>These are planning guidelines, not lending or tenancy approval. Taxes and household costs can change what feels affordable.</p></div>
    </Card>

    <div className="affordability-results">
      <Card className="budget-gauge-card" aria-live="polite">
        <div className="gauge-head"><div><p className="eyebrow">YOUR MONTHLY SNAPSHOT</p><h3>At a glance</h3></div><span className={`status-pill ${statusClass}`}>{status}</span></div>
        <div className="gauge-number">{Math.round(data.burden)}<span>%</span></div>
        <p className="gauge-caption">of gross monthly income goes to rent + debt</p>
        <div className="gauge-track" role="meter" aria-label="Rent and debt as a share of gross monthly income" aria-valuemin={0} aria-valuemax={55} aria-valuenow={Math.min(55, Math.round(data.burden))}>
          <div className="gauge-fill" style={{ width: `${gaugeWidth}%` }} />
          <span className="gauge-marker marker-25" aria-hidden="true" /><span className="gauge-marker marker-35" aria-hidden="true" />
        </div>
        <div className="gauge-scale"><span>25% comfortable</span><span>35% stretched</span></div>
        <div className="gauge-rent"><span>Your considered rent</span><strong>{formatMoney(targetRent, currency)}<small> / month</small></strong></div>
      </Card>
      <Card className="limit-card">
        <div className="limit-row"><div className="limit-icon icon-soft"><ArrowDownRight size={18} /></div><div className="limit-copy"><span>Comfortable target</span><small>25% of gross, adjusted for debt</small></div><strong>{formatWholeMoney(data.comfortable, currency)}<small> / mo</small></strong></div>
        <div className="limit-row"><div className="limit-icon icon-lime"><ArrowUpRight size={18} /></div><div className="limit-copy"><span>Guideline maximum</span><small>{region === 'US' ? '30% rent rule · 3× income check' : '40× annual-income check'} · debt-adjusted</small></div><strong>{formatWholeMoney(data.maximum, currency)}<small> / mo</small></strong></div>
        <div className="limit-row limit-risk"><div className="limit-icon icon-rose"><ArrowUpRight size={18} /></div><div className="limit-copy"><span>Stretched begins above</span><small>35% of gross, adjusted for debt</small></div><strong>{formatWholeMoney(data.riskyAbove, currency)}<small> / mo</small></strong></div>
        <p className="rule-footnote">{region === 'US' ? 'US rule shown: the lower of 30% of monthly income or one-third of monthly income, less existing debt.' : 'UK rule shown: annual gross income ÷ 40 for monthly rent, less existing debt.'}</p>
      </Card>
    </div>
  </div>;
}
