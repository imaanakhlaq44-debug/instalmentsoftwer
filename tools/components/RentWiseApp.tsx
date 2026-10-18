'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, CircleDollarSign, Menu, Printer, Share2, ShieldCheck, Sparkles } from 'lucide-react';
import type { CurrencyCode, LocationInfo, ToolId } from '@/lib/site-data';
import { LOCATIONS, sitePath, TOOLS } from '@/lib/site-data';
import { getCalculatorGuide } from '@/lib/seo-content';
import ProratedCalculator from '@/components/ProratedCalculator';
import AffordabilityCalculator from '@/components/AffordabilityCalculator';
import RoommateSplitter from '@/components/RoommateSplitter';

type Props = { initialCurrency: CurrencyCode; initialTool: ToolId; location?: LocationInfo };

export default function RentWiseApp({ initialCurrency, initialTool, location }: Props) {
  const [currency, setCurrency] = useState<CurrencyCode>(initialCurrency);
  const [activeTool, setActiveTool] = useState<ToolId>(initialTool);
  const [shareLabel, setShareLabel] = useState('Share result');
  const symbol = currency === 'GBP' ? '£' : '$';

  async function sharePage() {
    const shareData = { title: 'RentWise Tools', text: 'Clear rental math for your next move.', url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else { await navigator.clipboard.writeText(shareData.url); setShareLabel('Link copied'); window.setTimeout(() => setShareLabel('Share result'), 1800); }
    } catch { /* A cancelled native share is not an error to surface. */ }
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % TOOLS.length : event.key === 'ArrowLeft' ? (index + TOOLS.length - 1) % TOOLS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TOOLS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveTool(TOOLS[next].id);
    document.getElementById(`tab-${TOOLS[next].id}`)?.focus();
  }

  const active = TOOLS.find((tool) => tool.id === activeTool)!;
  const indexedTool = TOOLS.find((tool) => tool.id === initialTool)!;
  const indexedToolName = location?.country === 'UK' && initialTool === 'roommates' ? 'flatmate rent split' : indexedTool.name.toLowerCase();
  const guide = location ? getCalculatorGuide(location, initialTool) : null;

  return <div className="site-shell">
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href={sitePath('/')} aria-label="RentWise Tools home"><span className="brand-mark"><CircleDollarSign size={20} strokeWidth={2.1} /></span><span>rentwise<span className="brand-period">.</span><small>TOOLS FOR YOUR NEXT MOVE</small></span></a>
        <nav className="header-nav" aria-label="Main navigation">
          <a href="#calculator-workspace">Calculators</a><a href="#how-it-works">How it works</a>
        </nav>
        <div className="header-actions">
          <label htmlFor="global-currency" className="sr-only">Display currency</label>
          <div className="currency-select"><span>{symbol}</span><select id="global-currency" value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)} aria-label="Display currency"><option value="USD">USD</option><option value="GBP">GBP</option></select><ChevronDown size={13} aria-hidden="true" /></div>
          <a className="header-cta" href="#calculator-workspace">Try a tool <ArrowUpRight size={15} /></a>
        </div>
        <a className="mobile-jump" href="#calculator-workspace" aria-label="Go to calculators"><Menu size={19} /></a>
      </div>
    </header>

    <main>
      <section className="hero-wrap" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-kicker"><span className="hero-spark"><Sparkles size={13} /></span> RENTING, WITH THE MATH ON YOUR SIDE</p>
          <h1 id="hero-title">{location ? `${location.name} ${indexedToolName} calculator` : 'Free rent calculators for your next move'}</h1>
          <p className="hero-intro">{location ? `Estimate ${indexedToolName} in ${location.name} with the amount in your agreement. This private tool uses your inputs—not live local rent averages.` : 'Free, private tools to prorate rent, check a practical budget, and work out a fair roommate split for your next move.'}</p>
          <div className="hero-actions"><a href="#calculator-workspace" className="button button-primary">Explore the calculators <ArrowRight size={17} /></a><button type="button" className="button button-ghost" onClick={sharePage}><Share2 size={16} /> {shareLabel}</button></div>
          <div className="hero-proof"><span className="proof-icon"><ShieldCheck size={15} /></span><span><strong>Private by design.</strong> Your numbers stay in your browser.</span></div>
        </div>
        <div className="hero-visual" aria-label="A city apartment at night">
          <div className="hero-image" />
          <div className="visual-shade" />
          <div className="visual-topline"><span className="visual-live"><i /> YOUR NEXT CHAPTER</span><span className="visual-country">US <b>·</b> UK</span></div>
          <div className="visual-bottom"><p>Good decisions<br />start with <em>clear numbers.</em></p><div className="visual-glass"><span>RENT, MADE SIMPLE</span><strong>Good to go.</strong><span className="visual-streak" /></div></div>
          <div className="visual-caption"><span>01 / 03</span><span>YOUR HOME. YOUR TERMS.</span></div>
        </div>
        <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
      </section>

      <section id="calculator-workspace" className="tool-section" aria-labelledby="tool-title">
        <div className="tool-intro-row">
          <div><p className="eyebrow"><span className="eyebrow-line" /> THE TOOLKIT</p><h2 id="tool-title">A little more <span>certainty.</span></h2></div>
          <div className="tool-intro-note">Three useful ways to make renting<br className="desktop-only" /> feel a little less complicated.</div>
        </div>
        {location && <div className="location-note"><span className="location-pin">{location.country === 'UK' ? 'UK' : 'US'}</span><p><strong>{location.name} renter note</strong> {location.note}</p><span className="local-currency">{location.currency === 'GBP' ? '£ GBP' : '$ USD'}</span></div>}
        <div className="calculator-frame">
          <div className="calculator-tabs" role="tablist" aria-label="Rental calculators">
            {TOOLS.map((tool, index) => <button key={tool.id} type="button" id={`tab-${tool.id}`} role="tab" aria-selected={activeTool === tool.id} aria-controls="calculator-panel" tabIndex={activeTool === tool.id ? 0 : -1} className={`calculator-tab ${activeTool === tool.id ? 'tab-active' : ''}`} onClick={() => setActiveTool(tool.id)} onKeyDown={(event) => handleTabKey(event, index)}>
              <span className="tab-index">0{index + 1}</span><span className="tab-copy"><strong>{tool.shortName}</strong><small>{tool.eyebrow}</small></span><ArrowUpRight size={16} className="tab-arrow" />
            </button>)}
          </div>
          <div className="calculator-body" id="calculator-panel" role="tabpanel" aria-labelledby={`tab-${activeTool}`}>
            {activeTool === 'prorated' && <ProratedCalculator currency={currency} />}
            {activeTool === 'affordability' && <AffordabilityCalculator currency={currency} onCurrencyChange={setCurrency} />}
            {activeTool === 'roommates' && <RoommateSplitter currency={currency} />}
          </div>
          <div className="workspace-bottom"><span><span className="green-dot" /> Updates as you type</span><button type="button" onClick={() => window.print()}><Printer size={14} /> Print / save PDF</button></div>
        </div>
        <div className="tool-footnote"><span>Currently viewing</span><strong>{active.name}</strong><span>·</span><span>Instant estimate, no sign-up.</span></div>
      </section>

      <section className="assurance-band" id="how-it-works">
        <div className="assurance-title"><p className="eyebrow"><span className="eyebrow-line" /> BUILT FOR THE MOMENT</p><h2>The right number<br />makes things <span>easier.</span></h2></div>
        <div className="assurance-item"><span className="assurance-number">01</span><h3>Pick your question</h3><p>Moving in, setting a budget, or sharing a place? Start with the calculator that fits.</p></div>
        <div className="assurance-item"><span className="assurance-number">02</span><h3>Adjust as you go</h3><p>Every estimate updates while you type. No forms to submit and no account to create.</p></div>
        <div className="assurance-item"><span className="assurance-number">03</span><h3>Share the clarity</h3><p>Copy a clean breakdown or save the page as a PDF to keep everyone in the loop.</p></div>
      </section>

      {location && guide && <section className="local-guide" aria-labelledby="local-guide-title">
        <div className="guide-main">
          <div className="guide-heading">
            <p className="eyebrow"><span className="eyebrow-line" /> CLEAR METHOD, NO GUESSWORK</p>
            <h2 id="local-guide-title">{guide.title}</h2>
            <p className="guide-lead">{guide.introduction}</p>
          </div>
          <div className="guide-method">
            <h3>Calculation method</h3>
            <p>{guide.calculation}</p>
            <p className="guide-example"><strong>Worked example:</strong> {guide.example}</p>
          </div>
          <p className="guide-disclaimer"><strong>Planning note:</strong> This calculator uses the values you enter; it does not use live local asking rents or decide the terms of a tenancy. Confirm amounts and requirements against your own agreement and local guidance.</p>
        </div>
        <aside className="guide-questions" aria-labelledby="guide-questions-title">
          <p className="eyebrow"><span className="eyebrow-line" /> QUICK ANSWERS</p>
          <h2 id="guide-questions-title">Common questions</h2>
          {guide.questions.map((item) => <div className="guide-question" key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </div>)}
        </aside>
      </section>}

      {location && <section className="location-links" aria-labelledby="location-links-title"><div><p className="eyebrow">LOCAL RENTING TOOLS</p><h2 id="location-links-title">Explore more calculator guides</h2></div><div className="location-chip-list">{TOOLS.map((tool) => <a key={tool.id} href={sitePath(`/calculator/${location.slug}/${tool.slug}/`)}>{location.name} {tool.shortName.toLowerCase()} <ArrowUpRight size={14} /></a>)}</div></section>}
      <section className="directory-section" aria-label="Popular city and state rental calculators"><div className="directory-top"><div><p className="eyebrow">WHEREVER HOME IS</p><h2>Tools for your local move.</h2></div><p>Choose a location for a market-specific starting point.</p></div><div className="directory-grid">{LOCATIONS.map((item) => <a key={item.slug} className="directory-link" href={sitePath(`/calculator/${item.slug}/prorated-rent/`)}><span className="directory-region">{item.country === 'UK' ? 'UNITED KINGDOM' : 'UNITED STATES'}</span><span className="directory-name">{item.name}</span><span className="directory-arrow"><ArrowUpRight size={16} /></span></a>)}</div></section>
    </main>

    <footer className="site-footer"><a className="brand footer-brand" href={sitePath('/')} aria-label="RentWise Tools home"><span className="brand-mark"><CircleDollarSign size={18} /></span><span>rentwise<span className="brand-period">.</span><small>TOOLS FOR YOUR NEXT MOVE</small></span></a><p>Helpful math for the place you call home.</p><div className="footer-bottom"><span>© 2026 RentWise Tools</span><span>Estimates are for planning only. Always check your lease and local requirements.</span><a href="#calculator-workspace">Back to top ↑</a></div></footer>
  </div>;
}
