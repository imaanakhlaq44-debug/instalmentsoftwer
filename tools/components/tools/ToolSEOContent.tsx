import type { ToolGuide } from '@/lib/content/toolGuides';
import { getSuiteTool, type SuiteTool } from '@/lib/tool-registry';

const TONE: Record<string, string> = { Lease: 'sun', Budget: 'mint', Roommates: 'sky', Planning: 'peach', Moving: 'sun', Investment: 'mint' };

/**
 * Server-rendered guide under each calculator: a quotable short answer, the
 * formula, a worked example, the rules that apply and an FAQ. Native
 * details/summary keeps the FAQ usable without JavaScript, and the FAQ schema
 * is built from the same data so the two never disagree.
 */
export default function ToolSEOContent({ guide, tool }: { guide: ToolGuide; tool: SuiteTool }) {
  const { title, introduction, formula, example, legalNotes, faqs, table, checklist } = guide;
  const related = tool.related.map((slug) => getSuiteTool(slug)).filter((t): t is SuiteTool => !!t);

  return (
    <article className="rw-guide" aria-labelledby="guide-title">
      <section className="rw-answer" aria-labelledby="answer-title">
        <h2 id="answer-title">In short</h2>
        <p>{tool.answer}</p>
      </section>

      <header>
        <h2 id="guide-title">{title}</h2>
        <p>{introduction}</p>
      </header>

      <section className="rw-sec" aria-labelledby="guide-how">
        <h2 id="guide-how">The formula</h2>
        <div className="rw-formula">{formula.equation}</div>
        <p>{formula.explanation}</p>
        <div className="rw-methods">
          {formula.methods.map((m) => <div key={m.name}><h3>{m.name}</h3><p>{m.description}</p></div>)}
        </div>
      </section>

      <section className="rw-sec" aria-labelledby="guide-example">
        <h2 id="guide-example">Worked example</h2>
        <h3 className="rw-example-title">{example.title}</h3>
        <ol className="rw-steps">{example.steps.map((step, i) => <li key={i}><span>{step}</span></li>)}</ol>
        <p className="rw-take">{example.takeaway}</p>
      </section>

      {checklist && <section className="rw-sec" aria-labelledby="guide-checklist">
        <h2 id="guide-checklist">{checklist.title}</h2>
        <p>{checklist.description}</p>
        <div className="rw-checks">
          {checklist.items.map((item) => <div key={item.label}><span className="rw-sev alert">{item.tag}</span><h3>{item.label}</h3><p>{item.detail}</p></div>)}
        </div>
      </section>}

      {table && <section className="rw-sec" aria-labelledby="guide-table">
        <h2 id="guide-table">{table.caption}</h2>
        <p className="rw-scroll-hint">Swipe the table sideways to see every column →</p>
        <div className="rw-table" role="region" aria-labelledby="guide-table" tabIndex={0}>
          <table>
            <thead><tr>{table.headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>}

      <section className="rw-sec" aria-labelledby="guide-legal">
        <h2 id="guide-legal">Rules by location</h2>
        <p>General information, not legal advice. Rules depend on the property, the tenancy and where it is; England’s rules do not cover Scotland, Wales or Northern Ireland.</p>
        <div className="rw-legal">
          {legalNotes.map((note, i) => <article key={`${note.jurisdiction}-${i}`}>
            <span className="rw-tag">{note.jurisdiction}</span>
            <h3>{note.title}</h3>
            <p>{note.body}</p>
            <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer">{note.sourceLabel} ↗<span className="sr-only"> (opens in a new tab)</span></a>
          </article>)}
        </div>
      </section>

      <section className="rw-sec" aria-labelledby="guide-faq">
        <h2 id="guide-faq">Questions renters ask</h2>
        <div className="rw-faq">
          {faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}
        </div>
      </section>

      {related.length > 0 && <section aria-labelledby="guide-related">
        <h2 id="guide-related" className="rw-related-title">Related calculators</h2>
        <div className="rw-related">
          {related.map((t) => <a key={t.slug} href={`/rentwise/tools/${t.slug}/`}>
            <span className={`rw-ic ${TONE[t.category] || 'sun'}`} aria-hidden="true">→</span>
            <span><h3>{t.h1}</h3><p>{t.description}</p></span>
          </a>)}
        </div>
      </section>}

      <p className="rw-disclaimer">Use the calculator to plan, then check your agreement and current local rules before you pay, sign or change a tenancy.</p>
    </article>
  );
}
