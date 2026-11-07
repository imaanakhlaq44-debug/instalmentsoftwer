# RentWise

Fifteen free rent calculators for US and UK renters, published at `almassdm.pro/rentwise/`. Next.js App Router exported to static HTML; every calculation runs in the browser, with no accounts and no calculator API.

The look follows the Almas SDM marketing site (`site/src/pages/index.html`): cream dotted paper, ink outlines with hard offset shadows, sun and mint accents and Archivo 900 headlines. All styles live in `app/suite.css`.

## Tools

Index: `/rentwise/`. Tool pages: `/rentwise/tools/{slug}/`.

| Slug | Tool |
| --- | --- |
| `ai-lease-scanner` | Lease clause checker — rule-based red-flag check with an amendment letter (the slug is kept for old links; it is not AI) |
| `rent-affordability` | 30% rule, 3× income and UK 40× rule, with debt |
| `move-in-cash` | First/last month, deposit, fees, utility deposits, moving |
| `roommate-rent-splitter` | Split by room area with bath / view / parking weights, to the cent |
| `prorated-rent` | Exact days, 30-day month or 365-day year, inclusive dates |
| `utility-splitter` | Internet equally, other bills by person-days, settle-up |
| `rent-increase` | Increase %, notice days, California AB 1482 cap, England notice |
| `rent-vs-buy` | Net cost of renting vs buying, breakeven year |
| `moving-cost-estimator` | Truck size, round-trip fuel, hire and labor |
| `commute-vs-rent` | Rent plus commute cost and time for two homes |
| `sublease-rate` | Daily rate, total and monthly equivalent for a sublet |
| `cap-rate-calculator` | NOI, cap rate, cash flow, cash-on-cash |
| `rent-per-sqft` | Rent per sq ft / sq m, with a comparison |
| `couple-rent-splitter` | Proportional, 50/50 and equal-leftover splits |
| `security-deposit-refund` | Return deadline and statutory penalty by state / England |

The six `/calculator/{city}/{tool}/` pages from the first version still render (the suite tool plus a local note) but are `noindex` with a canonical pointing at the main tool page.

## Where things are

- `lib/tool-registry.ts` — every tool's name, H1, SEO title, meta description, keywords, the short quotable answer and related tools.
- `lib/suite-calculations.ts` — the pure maths for all fifteen tools; `lib/lease-rules.ts` — the lease checker's patterns and per-jurisdiction rules.
- `lib/content/*Guides.ts` — the formula, worked example, rules by location and FAQ under each tool.
- `lib/content/toolSchema.ts` — JSON-LD: WebPage, WebApplication, BreadcrumbList and FAQPage (built from the same FAQ data the page shows).
- `components/suite/SuiteApp.tsx` — the index and tool UI; `components/tools/ToolSEOContent.tsx` — the server-rendered guide.

## Build and verify

```sh
cd tools
npm ci
npm test
npm run typecheck
npm run build      # writes tools/out
```

`site/build.mjs` copies `tools/out` into `site/dist/rentwise/`, and `.github/workflows/deploy-site.yml` uploads `site/dist` to Hostinger over FTPS on every push to `main` that touches `site/` or `tools/`. Never change `basePath` — it keeps RentWise under `/rentwise` and away from the Almas SDM homepage.

## Assumptions

Defaults are examples, not live market figures, quotes or legal determinations. USD/GBP switches symbols and units (sq ft ↔ sq m, US gallons ↔ litres), not exchange rates. Legal notes are general information for California, New York, Texas, Florida, England and Scotland and do not certify compliance.
