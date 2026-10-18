# RentWise · RentCalc Suite

Twelve free, instant rental, roommate and relocation calculators for US and UK planning. Built with Next.js App Router, TypeScript, Tailwind and Lucide; exported to static HTML. All entered figures are processed in the browser, without accounts or calculator API requests.

## Tools

Dashboard: `/rentwise/`. Calculator pages: `/rentwise/tools/{slug}/`.

- `rent-affordability` — annual/hourly income, comfortable range, 30%, 3× and 40× screening rules and debt adjustment.
- `move-in-cash` — first/last rent, refundable deposits, moving and setup costs.
- `roommate-rent-splitter` — room-area weights, bathroom/view/parking adjustments and cent-accurate totals.
- `prorated-rent` — inclusive dates, actual calendar months, 30-day and 365-day conventions.
- `utility-splitter` — variable bills by occupied days, internet shared equally, prior payments and settlements.
- `rent-increase` — change amount/percentage, dates and non-binding California/England guidance with official sources.
- `rent-vs-buy` — mortgage amortization, opportunity cost, ownership expenses, sale proceeds and 3/5/10-year comparisons.
- `moving-cost-estimator` — illustrative vehicle sizing and editable cost/fuel assumptions, not a carrier quote.
- `commute-vs-rent` — rent plus fuel/transit, annual commute time and time/cash trade-off.
- `sublease-rate` — inclusive dates, furnished premium and optional utilities.
- `cap-rate-calculator` — NOI, cap rate, debt service and cash-on-cash return.
- `rent-per-sqft` — monthly/annual cost per sq ft or sq m and an optional user-provided benchmark.

Every tool has copyable result breakdowns and browser print/Save PDF support. The dashboard has search and category filters. Eighteen existing location calculator routes remain available.

## Structure

`source/components/suite/` contains the new client UI; `source/lib/suite-calculations.ts` contains the pure math; `source/lib/tool-registry.ts` controls the dashboard and static routes. The original calculators and location content remain separate for backwards compatibility.

## Build and verification

```sh
cd source
npm ci
npm test
npm run typecheck
npm run build
```

Tests cover all twelve tools, malformed inputs, leap years, inclusive multi-month dates, allocation rounding, mortgage payoff and illustrative California cap boundaries. The export pre-renders the dashboard, 12 standalone tools and 18 existing location pages with canonical/OpenGraph metadata and structured data.

## Helpful guides for all twelve tools

`source/components/tools/ToolSEOContent.tsx` renders reusable, server-generated guides immediately below each standalone calculator workspace. `source/lib/content/toolGuides.ts` retains the first three approved guides unchanged and registers nine further guides from `investmentGuides.ts`, `tenancyGuides.ts`, and `householdGuides.ts`. Every guide includes the implemented formula and assumptions, a worked numerical walkthrough, scoped US/UK legal or practical notes with official references, and at least five native keyboard-accessible FAQ accordions.

`source/lib/content/toolSchema.ts` generates `SoftwareApplication` and `FAQPage` JSON-LD for all twelve pages. Visible FAQ answers and structured data use the same source content. Structured data is descriptive metadata, not a ranking or rich-result guarantee. Legal notes distinguish England from the rest of the UK and do not certify compliance. Calculator defaults remain illustrative, not live market data, quotes, investment advice or legal entitlements.

## Deployment safety

GitHub Actions tests and builds `source/out` on pushes to `main`, then publishes that export to the `hostinger` branch. Hostinger's existing automatic Git integration deploys **only to `public_html/rentwise`**. Never change the project base path or deploy this export to `public_html`; that would overwrite the separate Almas SDM homepage. No DNS changes are needed. The separate `/tools/` directory is updated independently and is not part of the RentWise export.

## Assumptions

Defaults are examples, not live market averages, carrier quotes, or legal determinations. Switching USD/GBP changes currency/area/fuel conventions, not exchange rates: re-enter the values and area for your locale. UK fuel calculations use pounds/litre and imperial mpg; US uses dollars/US gallon and US mpg. Dates include both arrival and departure days; leases may differ. Return forecasts, rent rules, deposit limits and tenancy applicability must be checked against current local requirements. No calculator certifies legal compliance or substitutes for financial advice.
