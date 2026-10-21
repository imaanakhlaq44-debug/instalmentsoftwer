import type { ToolGuide } from '@/lib/content/toolGuides';
import { SUITE_TOOLS } from '@/lib/tool-registry';

/** Server-rendered guide: native details/summary keeps FAQs usable without JavaScript. */
export default function ToolSEOContent({ title, introduction, formula, example, legalNotes, faqs, table, checklist, currentSlug }: ToolGuide & { currentSlug?: string }) {
  const relatedTools = SUITE_TOOLS.filter(tool => !currentSlug || tool.slug !== currentSlug).slice(0, 6);

  return (
    <article className="tool-guide mx-auto mt-12 max-w-[1110px] space-y-6 text-slate-100" aria-labelledby="tool-guide-title">
      <header className="max-w-3xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[.18em] text-emerald-300">Helpful content &amp; legal guide</p>
        <h2 id="tool-guide-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <p className="mt-4 text-base leading-7 text-slate-300">{introduction}</p>

        {/* Generative Engine Optimization (GEO) & AI Overview direct-answer card */}
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 sm:p-6 backdrop-blur">
          <div className="flex items-center gap-2 font-semibold text-emerald-300 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span>Key Takeaways &amp; Overview (At a Glance)</span>
          </div>
          <p className="mt-2 text-sm text-slate-200 leading-relaxed font-medium">
            {introduction}
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-emerald-500/20 text-xs text-slate-300">
            <div><strong className="text-emerald-300">Methods:</strong> {formula.methods.map(m => m.name).join(', ')}</div>
            <div><strong className="text-emerald-300">Jurisdictions:</strong> US &amp; UK tenancy rules</div>
            <div><strong className="text-emerald-300">Privacy:</strong> 100% In-browser calculation</div>
          </div>
        </div>
      </header>

      {/* Predatory Clause Red Flag Checklist (if available) */}
      {checklist ? (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-950/10 p-5 sm:p-8" aria-labelledby="guide-checklist">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/20 text-xs font-bold text-rose-400">!</span>
            <h2 id="guide-checklist" className="text-xl font-semibold text-rose-200">{checklist.title}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{checklist.description}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {checklist.items.map((item, idx) => (
              <div key={idx} className="rounded-xl border border-rose-500/20 bg-zinc-950/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-rose-300">{item.label}</h3>
                  <span className="shrink-0 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">{item.tag}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Statutory Comparison Table (for Perplexity & Google AI Overviews) */}
      {table ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8" aria-labelledby="guide-table">
          <h2 id="guide-table" className="text-xl font-semibold">{table.caption}</h2>
          <p className="mt-2 text-sm text-slate-300">Statutory comparison across major United States and United Kingdom rental jurisdictions:</p>
          <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950/80 text-emerald-300">
                <tr>
                  {table.headers.map((header, idx) => (
                    <th key={idx} className="px-3.5 py-3 font-semibold uppercase tracking-wider text-[11px] sm:text-xs">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/30 text-slate-200">
                {table.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="transition hover:bg-zinc-800/40">
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className={`px-3.5 py-3 ${cellIdx === 0 ? 'font-semibold text-emerald-200' : 'text-slate-300'}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8" aria-labelledby="guide-how">
        <h2 id="guide-how" className="text-xl font-semibold">How it works &amp; the mathematical formula</h2>
        <div className="my-5 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4 sm:p-5">
          <code className="block whitespace-pre-wrap break-words font-mono text-sm leading-7 text-emerald-200">{formula.equation}</code>
        </div>
        <p className="text-base leading-7 text-slate-300">{formula.explanation}</p>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {formula.methods.map(method => <div key={method.name}><h3 className="mb-2 text-base font-semibold text-slate-100">{method.name}</h3><p className="text-sm leading-7 text-slate-300">{method.description}</p></div>)}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8" aria-labelledby="guide-example">
        <h2 id="guide-example" className="text-xl font-semibold">Real-world walkthrough</h2>
        <h3 className="mt-4 text-lg font-medium text-emerald-200">{example.title}</h3>
        <ol className="mt-4 list-decimal space-y-3 pl-6 text-base leading-7 text-slate-300">{example.steps.map((step, index) => <li key={index} className="pl-1">{step}</li>)}</ol>
        <p className="mt-5 border-l-2 border-emerald-400/50 pl-4 text-base leading-7 text-slate-200">{example.takeaway}</p>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8" aria-labelledby="guide-legal">
        <h2 id="guide-legal" className="text-xl font-semibold">US state &amp; UK council legal considerations</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">Rules depend on the property, tenancy and location. These references are general information, not legal advice or a determination that a charge or agreement is enforceable. England is not the whole UK: Scotland, Wales and Northern Ireland have different rules.</p>
        <div className="mt-6 space-y-6">{legalNotes.map((note, index) => <section key={`${note.jurisdiction}-${index}`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">{note.jurisdiction}</p>
          <h3 className="mt-2 text-base font-semibold">{note.title}</h3>
          <p className="mt-2 text-base leading-7 text-slate-300">{note.body}</p>
          <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block max-w-full break-words text-sm leading-7 text-emerald-200 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-100">{note.sourceLabel}<span className="sr-only"> (opens in a new tab)</span> ↗</a>
        </section>)}</div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8" aria-labelledby="guide-faq">
        <h2 id="guide-faq" className="text-xl font-semibold">Frequently asked questions</h2>
        <div className="mt-5 divide-y divide-zinc-800">{faqs.map(faq => <details key={faq.question} className="group py-4">
          <summary className="cursor-pointer rounded-md py-2 pr-3 text-base font-medium leading-7 text-slate-100 marker:text-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300">{faq.question}</summary>
          <p className="mt-3 text-base leading-7 text-slate-300">{faq.answer}</p>
        </details>)}</div>
      </section>

      {/* Internal Linking for SEO discovery & PageRank flow */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8" aria-labelledby="guide-related">
        <h2 id="guide-related" className="text-xl font-semibold">Complementary Rental Calculators</h2>
        <p className="mt-2 text-sm text-slate-300">Explore other tools in the RentWise suite to plan your tenancy and moving budget:</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {relatedTools.map(tool => (
            <a
              key={tool.slug}
              href={`/rentwise/tools/${tool.slug}/`}
              className="group block rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 transition hover:border-emerald-500/40 hover:bg-zinc-900/80"
            >
              <h3 className="text-sm font-semibold text-emerald-300 group-hover:text-emerald-200">{tool.name}</h3>
              <p className="mt-1 text-xs text-slate-400 line-clamp-2">{tool.description}</p>
            </a>
          ))}
        </div>
      </section>

      <p className="text-sm leading-7 text-slate-400">Use the calculator for planning, then confirm the agreement and current local requirements before you pay, sign or change a tenancy.</p>
    </article>
  );
}
