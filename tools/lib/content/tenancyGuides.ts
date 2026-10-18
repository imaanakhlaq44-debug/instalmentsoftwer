import type { ToolGuide } from './toolGuides';

export const tenancyGuides: Record<string, ToolGuide> = {
  'rent-increase': {
    title: 'How to calculate a proposed rent increase',
    introduction: 'Enter the current and proposed monthly rent to see the dollar change and percentage change. Optional notice and effective dates show elapsed days; selecting California or England adds limited jurisdiction-specific context. The calculator does not decide whether a proposed increase is lawful: coverage, prior increases, local rules, tenancy type, notice method, dates, and user-supplied CPI can all matter.',
    formula: {
      equation: 'Increase amount = proposed monthly rent − current monthly rent. Increase percentage = (proposed monthly rent − current monthly rent) ÷ current monthly rent × 100. If both dates are entered, notice period = effective date − notice date in calendar days.',
      explanation: 'The calculator reports arithmetic only. Its California field displays an illustrative AB 1482 ceiling of min(10%, 5% + entered CPI); CPI is user input and the result does not establish that a unit is covered or that statewide or local rules allow that increase. England selection also warns when the entered effective date falls before two calendar months after notice; this limited date comparison does not validate the notice or decide whether an increase is lawful.',
      methods: [
        { name: 'Amount change', description: 'Subtract current rent from proposed rent. A negative amount represents a decrease; this tool does not restrict the arithmetic to increases.' },
        { name: 'Percentage change', description: 'Divide the dollar change by current rent, then multiply by 100. The base is current rent, not the new rent.' },
        { name: 'Elapsed notice days', description: 'When both dates are supplied, count elapsed calendar days from notice date to effective date; the output is not itself a legal notice-period test.' },
        { name: 'California illustrative cap', description: 'Only for the California jurisdiction selector, calculate min(10, 5 + entered CPI) percent. CPI must be verified for the location and effective date; the result is not a compliance finding and local caps may be lower.' },
      ],
    },
    example: {
      title: 'Current rent £1,800; proposed rent £1,980; notice 18 October 2026; effective 18 December 2026',
      steps: [
        'Subtract: £1,980 − £1,800 = £180 more per month.',
        'Divide change by current rent: £180 ÷ £1,800 = 0.10.',
        'Convert to a percentage: 0.10 × 100 = 10%.',
        'The dates are 61 elapsed days apart. That raw day count is not a calendar-month rule determination; England’s relevant current assured-periodic process requires at least two months’ notice.',
      ],
      takeaway: 'The extra £180 is a 10% increase, and these dates are two calendar months apart. Neither the percentage nor the date comparison establishes that the notice or increase is legally valid.',
    },
    legalNotes: [
      { jurisdiction: 'England (from 1 May 2026)', title: 'Assured periodic rent increases use Form 4A and two months’ notice', body: 'Current GOV.UK tenant guidance says an assured periodic landlord may increase rent only once a year, not in the first year of a new tenancy, and must give at least two months’ notice using completed Form 4A (the section 13 process). A tenant may be able to challenge an increase above open-market rent. Transitional notices given before 1 May 2026 may follow old rules. This is England-specific; Scotland, Wales and Northern Ireland have different regimes.', sourceLabel: 'GOV.UK: Assured periodic tenancies—rent increases', sourceUrl: 'https://www.gov.uk/assured-periodic-tenancies-tenants/rent-increases' },
      { jurisdiction: 'England (from 1 May 2026)', title: 'Advance rent is limited; do not infer a rent-increase right', body: 'For covered private tenancies, the government overview says a landlord cannot ask for, encourage, or accept rent before the agreement is signed; after signing, no more than one month’s rent in advance may be requested. This is distinct from the rent-increase calculation and has tenancy exceptions. Check the current official rules before paying.', sourceLabel: 'GOV.UK: Renters’ Rights Act overview for tenants', sourceUrl: 'https://www.gov.uk/guidance/renters-rights-act-overview-for-tenants' },
      { jurisdiction: 'California', title: 'AB 1482 coverage, exemptions, CPI and local caps all matter', body: 'California DOJ describes the statewide Tenant Protection Act limit for most covered rentals as 5% plus the applicable cost-of-living change, capped at 10%; coverage includes qualifying housing generally more than 15 years old, with statutory exemptions. The DOJ lists separate local rent-stabilization limits; a lower local cap can govern. CPI is location- and effective-date-specific, so the calculator’s CPI field is input-only and the tool cannot certify coverage or compliance.', sourceLabel: 'California DOJ: Limits on Rent Increases', sourceUrl: 'https://oag.ca.gov/rentcaps' },
      { jurisdiction: 'England', title: 'Only the increase arithmetic is universal here', body: 'This calculator’s difference and percentage formulas are arithmetic, not a substitute for the tenancy-specific process. In particular, calendar-month notice is not interchangeable with a fixed number of days. Seek local advice if the tenancy type or transitional situation is unclear.', sourceLabel: 'GOV.UK: Assured periodic tenancies—rent increases', sourceUrl: 'https://www.gov.uk/assured-periodic-tenancies-tenants/rent-increases' },
    ],
    faqs: [
      { question: 'How is the percentage increase calculated?', answer: 'Subtract current monthly rent from proposed monthly rent, divide by current rent, then multiply by 100. For £1,800 to £1,980, the £180 difference is 10% of £1,800.' },
      { question: 'Does a 10% result mean the increase is lawful?', answer: 'No. The tool does not establish jurisdiction, tenancy coverage, allowable frequency, notice validity, applicable CPI, exemptions, or a local cap. Get advice based on the actual tenancy and location.' },
      { question: 'What applies to an assured periodic tenancy in England after 1 May 2026?', answer: 'GOV.UK currently says rent can generally increase only once a year and not during the first 12 months of a new tenancy; the landlord must use Form 4A and give at least two months’ notice. A tenant can challenge an increase above market rent. Verify whether a transition or exception applies.' },
      { question: 'Does the calculator check two calendar months of notice?', answer: 'With England selected and both dates supplied, the tool compares the effective date with two calendar months after notice and warns if it is earlier. The displayed row still shows elapsed days. This check does not validate service, the prescribed form, frequency, coverage or compliance.' },
      { question: 'Can my England landlord request more than one month of rent in advance?', answer: 'For covered arrangements from 1 May 2026, GOV.UK says no rent can be requested before signing, and after signing a maximum of one month’s rent in advance can be requested. Check tenancy type and official guidance.' },
      { question: 'How does the California cap estimate work?', answer: 'For California selection, the tool uses the illustrative expression min(10%, 5% + your entered CPI). CPI is not fetched and coverage is not decided. State exemptions, effective dates, and more protective local ordinances can change the applicable limit.' },
      { question: 'Are the same rent-increase rules used throughout the UK?', answer: 'No. The England notes apply to England only. Scotland, Wales and Northern Ireland have separate housing law, and a particular tenancy may have additional rules.' },
    ],
  },
  'move-in-cash': {
    title: 'How to estimate move-in cash',
    introduction: 'Enter monthly rent, deposit months, whether last month’s rent is included, moving costs, fees, and utility connection deposits. The total is a cash-planning sum, not a statement that every item is due, refundable, permitted, or lawful. Review each proposed charge under the local law and signed agreement; optional calculator fields are not permission to charge them.',
    formula: {
      equation: 'Estimated move-in cash = first month rent + (monthly rent × deposit months) + (monthly rent if lastMonth is true, otherwise 0) + moving costs + fees + utility connection deposits.',
      explanation: 'The tool adds every entered item at face value. It does not cap deposit months, assess whether a fee is permitted, model pro-rating, subtract credits, calculate a refund, or determine whether advance rent is lawful. Refundable deposits are included in the cash total even though they are not necessarily an expense.',
      methods: [
        { name: 'First month rent', description: 'Adds one full entered monthly rent, without a partial-month or move-in-date adjustment.' },
        { name: 'Deposit estimate', description: 'Multiplies monthly rent by depositMonths (allowed input range 0–24); it does not apply jurisdictional deposit caps or establish the correct deposit basis.' },
        { name: 'Optional last month', description: 'Adds one additional monthly rent only when lastMonth is true. Whether collecting this is allowed or appropriate depends on the location and arrangement.' },
        { name: 'Other cash items', description: 'Adds moving, fees, and utility values exactly as entered; the calculator does not validate charge type or legality.' },
      ],
    },
    example: {
      title: '$1,800 monthly rent with one-month deposit and optional items',
      steps: [
        'First month rent: $1,800.',
        'One deposit month: $1,800 × 1 = $1,800; optional last month: $1,800.',
        'Add moving costs $500, fees $100, and utility connection deposits $150.',
        'Total cash estimate: $1,800 + $1,800 + $1,800 + $500 + $100 + $150 = $6,150.',
      ],
      takeaway: 'This household needs $6,150 in this illustrative scenario, but $1,800 of it is a potentially refundable deposit. Confirm each fee and advance-rent request is allowed locally; the total does not certify charges as lawful.',
    },
    legalNotes: [
      { jurisdiction: 'England (from 1 May 2026)', title: 'Advance rent is not an unrestricted upfront charge', body: 'GOV.UK says a landlord cannot ask for, encourage, or accept rent before the tenancy agreement is signed. After signing, a maximum of one month’s rent in advance may be requested for covered private tenancies. Do not treat the optional last-month field as automatically lawful advance rent.', sourceLabel: 'GOV.UK: Renters’ Rights Act overview for tenants', sourceUrl: 'https://www.gov.uk/guidance/renters-rights-act-overview-for-tenants' },
      { jurisdiction: 'England', title: 'Tenant Fees Act restricts fees and caps deposits', body: 'The official tenant guidance lists permitted payments, including rent, refundable tenancy and holding deposits, and specified items; other charges may be prohibited. It states a tenancy deposit cap of five weeks’ rent below £50,000 annual rent and six weeks between £50,000 and £100,000, and holding deposits are capped at one week. Check the current wording, exceptions and agreement; the fees input does not determine permissibility.', sourceLabel: 'GOV.UK: Tenant Fees Act 2019—guidance for tenants', sourceUrl: 'https://www.gov.uk/guidance/tenant-fees-act-2019-guidance-for-tenants' },
      { jurisdiction: 'United States (general)', title: 'Deposit and fee limits are jurisdiction-specific', body: 'There is no single US-wide deposit limit or permission for every fee represented by this total. Check state, city, and county rules as well as the lease; separate refundable deposits from nonrefundable moving and service costs when budgeting.', sourceLabel: 'USA.gov: State and local governments', sourceUrl: 'https://www.usa.gov/state-governments' },
      { jurisdiction: 'California', title: 'Do not assume a deposit of any chosen number of months is allowed', body: 'California has its own security-deposit statutes and exceptions, and the legal amount can depend on landlord and tenancy details. This tool merely multiplies rent by the input number and does not determine the permitted deposit or validate fees.', sourceLabel: 'California DOJ: Landlord-Tenant Issues', sourceUrl: 'https://oag.ca.gov/tenants' },
    ],
    faqs: [
      { question: 'Is the move-in total the amount I legally owe?', answer: 'Not necessarily. It is the sum of values entered. Some entries may not apply, may be refundable, may be capped, or may be prohibited. Verify each charge against the agreement and current local law.' },
      { question: 'Is the security deposit a cost or an expense?', answer: 'It is cash needed upfront but may be refundable subject to lawful deductions and return rules. The tool includes it in cash required without treating it separately from expenses in its total.' },
      { question: 'Does the tool calculate a legal deposit cap?', answer: 'No. Deposit months is a user input and the result is multiplication only. Deposit limits vary substantially by jurisdiction and may include exceptions.' },
      { question: 'Should I include last month’s rent?', answer: 'Only if it is actually requested and you want to model it. It is an optional arithmetic line, not an assertion it may lawfully be collected. In England from 1 May 2026, covered private tenancies limit rent in advance after signing to one month.' },
      { question: 'Are application or administration fees automatically allowed?', answer: 'No. For England, the Tenant Fees Act permits only specified payments and may make other fees prohibited. Other places have their own rules. Do not pay a fee solely because the calculator has a field for it.' },
      { question: 'Does the total include prorated rent?', answer: 'No. First month rent is always one full entered monthly rent. Use the lease’s agreed proration treatment separately if a partial month applies.' },
      { question: 'Are utility deposits refundable?', answer: 'The calculator does not determine that. Ask the utility provider or landlord who holds the money, what it secures, whether it is refundable, and which agreement governs it.' },
    ],
  },
  'sublease-rate': {
    title: 'How to estimate a sublease rate',
    introduction: 'Enter the original monthly rent, inclusive sublease dates, a user-selected premium percentage, and optional monthly utilities. The result is a mathematical estimate based on the calculator’s 365-day annual convention—not a market valuation, permission to sublet, or determination of a lawful amount. Check the lease and local subletting, rent-control, consent, and notice requirements before advertising or collecting money.',
    formula: {
      equation: 'Inclusive days = (end date − start date) + 1. Suggested daily rate = (monthly rent × 12 ÷ 365 × (1 + premium ÷ 100)) + (includeUtilities ? monthly utilities × 12 ÷ 365 : 0). Suggested total = suggested daily rate × inclusive days. Monthly equivalent = suggested daily rate × 365 ÷ 12.',
      explanation: 'The original rent and any selected utility amount are annualized and divided by 365; the premium multiplies rent only, not utilities. Dates count inclusively. The premium is user-entered and can be negative; no market data, consent, regulated-rent limit, utility actual cost, or legal restriction is checked.',
      methods: [
        { name: 'Inclusive date count', description: 'Counts both start date and end date as sublease days; same-day start/end is one day.' },
        { name: '365-day annualized rent', description: 'Converts monthly rent to a daily amount as monthly rent × 12 ÷ 365. It uses 365 even in leap years.' },
        { name: 'User-set premium', description: 'Multiplies rent’s daily amount by 1 + premium/100. This is a modeling input, not an objectively supported market premium or permission to charge it.' },
        { name: 'Optional utilities', description: 'If selected, adds monthly utilities × 12 ÷ 365 per day, without applying the rent premium to utilities.' },
      ],
    },
    example: {
      title: '$1,800 rent, 10% premium, $150 monthly utilities, 1–30 June 2026',
      steps: [
        'Count dates inclusively: June 1 through June 30 = 30 days.',
        'Annualized rent daily base: $1,800 × 12 ÷ 365 = $59.178082…; apply the 10% input premium: $59.178082… × 1.10 = $65.095890… per day.',
        'Utilities daily amount: $150 × 12 ÷ 365 = $4.931506… per day. Total daily rate = $70.027397….',
        'Multiply by 30 days: $70.027397… × 30 = $2,100.8219…, rounded to $2,100.82. Monthly equivalent row is $2,130.00.',
      ],
      takeaway: 'The total is $2,100.82 for these 30 days. Use the unrounded daily rate for the multiplication: multiplying the displayed $70.03 by 30 would introduce a small rounding difference. The premium is an illustrative input, not permission to charge it or a lawful-rate finding.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'Review the lease and obtain required permission', body: 'Subletting rules vary by state, city, property type, and lease. Do not assume the calculator’s suggested rent or a general rule grants the right to sublet. Read the agreement, obtain any required written consent, document dates and responsibilities, and check local law.', sourceLabel: 'USA.gov: State and local governments', sourceUrl: 'https://www.usa.gov/state-governments' },
      { jurisdiction: 'New York State', title: 'Sublet procedure depends on the building and tenancy', body: 'The NY Attorney General guide says tenants in buildings with four or more apartments have a right to sublet with advance landlord consent and sets out a written request process; buildings with three or fewer apartments are treated differently. The prime tenant remains liable for lease obligations. Follow the statute and current guidance rather than assuming silent permission.', sourceLabel: 'New York Attorney General: Residential Tenants’ Rights Guide', sourceUrl: 'https://ag.ny.gov/publications/residential-tenants-rights-guide' },
      { jurisdiction: 'New York City rent-stabilized apartments', title: 'A 10% furnished surcharge is a limited special rule, not universal', body: 'The Attorney General guide states that for a rent-stabilized sublet the subtenant’s rent cannot exceed stabilized rent plus a 10% surcharge payable to the tenant for a furnished sublet; a Rent Guidelines Board sublet allowance may also affect rent payable to the owner during the sublet. That special rule does not apply universally to ordinary rentals, other locations, or unfurnished sublets. The calculator does not check stabilization status or lawful rent.', sourceLabel: 'NY Attorney General: Residential Tenants’ Rights Guide—Subletting', sourceUrl: 'https://ag.ny.gov/publications/residential-tenants-rights-guide' },
      { jurisdiction: 'England', title: 'Check whole-home subletting permission before setting a rate', body: 'Citizens Advice says whole-home subletting rules depend on the landlord and tenancy agreement; most tenants need permission, and a council tenant cannot sublet the whole home. Moving out to sublet can put the original tenancy at risk even where subletting is allowed. Taking a lodger in part of your home is a different arrangement. Check the agreement and get advice before offering a subtenancy; other UK nations have separate rules.', sourceLabel: 'Citizens Advice (England): Check if you can sublet your home', sourceUrl: 'https://www.citizensadvice.org.uk/housing/lodging-and-subletting/lodging-subletting/subletting/check-if-you-can-sublet-your-home/' },
    ],
    faqs: [
      { question: 'How is the suggested sublease total calculated?', answer: 'It annualizes monthly rent at rent × 12 ÷ 365, applies the entered premium to that rent component, optionally adds annualized utilities, then multiplies the daily rate by inclusive days.' },
      { question: 'Does the premium represent fair market rent?', answer: 'No. It is a user-entered modeling adjustment. The tool does not collect comparable listings, determine furnished value, or show that charging a premium is allowed.' },
      { question: 'Can I sublet without my landlord’s written permission?', answer: 'The answer depends on location, dwelling, and lease. Some laws require a request and advance consent; in New York, for example, the process differs by building size. Review applicable rules and get written authorization when required.' },
      { question: 'Is a 10% sublet premium always allowed?', answer: 'No. The limited 10% furnished surcharge described for certain New York rent-stabilized sublets is not a universal rule. Other regulated rents and local restrictions may impose different limits.' },
      { question: 'Does the calculator apply the premium to utilities?', answer: 'No. It multiplies only the rent daily rate by 1 + premium/100. If utilities are included, their entered monthly estimate is separately converted to a daily amount and added.' },
      { question: 'Are start and end dates counted?', answer: 'Yes. Both are counted. June 1 through June 30 is 30 days; a single-day sublet has one inclusive day.' },
      { question: 'Does the original tenant remain responsible?', answer: 'Often the prime tenant remains responsible to the landlord for lease duties; the New York Attorney General specifically notes this when the landlord consents to a sublet. Check your own agreement and local law.' },
      { question: 'Does the estimate include a legal rent cap or permission check?', answer: 'No. It does not check stabilization status, lease permission, local law, actual utility bills, or lawful rent. Treat it as planning arithmetic only.' },
    ],
  },
  'security-deposit-refund': {
    title: 'How to check security deposit return deadlines and penalties',
    introduction: 'Calculate statutory return deadlines, maximum bad-faith retention penalties, and required itemization rules for rental security deposits across US states and the UK. Ensure your landlord returns your deposit on time with proper deduction receipts.',
    formula: {
      equation: 'Statutory deadline date = move-out date + statutory calendar days. Maximum potential recovery = unreturned deposit + (unreturned deposit × statutory penalty multiplier) + statutory fixed penalty.',
      explanation: 'State statutes impose strict calendar-day deadlines (e.g. 14 days in New York, 21 days in California, 30 days in Texas) from the day a tenant vacates and surrenders possession. Landlords who fail to return deposits or provide required itemized receipts by the deadline forfeit their right to retain deductions and may face statutory damages.',
      methods: [
        { name: 'Statutory calendar deadline', description: 'Calculates the exact legal date by which the landlord must deliver the full refund or an itemized deduction statement with receipts.' },
        { name: 'Bad-faith statutory penalty calculation', description: 'Applies jurisdiction-specific multiplier damages (up to 2× deposit in California/New York, 3× plus $100 in Texas, or 1× to 3× in the UK) for bad-faith withholding.' },
        { name: 'Itemized deduction compliance', description: 'Determines whether the landlord provided valid invoices, hourly receipts, and proof for repairs beyond normal wear and tear.' },
      ],
    },
    example: {
      title: '$2,000 security deposit in California; moved out May 1, 2026',
      steps: [
        'California Civil Code § 1950.5 gives the landlord exactly 21 calendar days from May 1, 2026.',
        'The statutory return deadline is May 22, 2026.',
        'If the landlord willfully withholds the $2,000 deposit in bad faith, the tenant may sue in small claims court for the full $2,000 deposit plus up to twice that amount ($4,000) in statutory damages, totaling $6,000.',
      ],
      takeaway: 'Always provide your forwarding address in writing and document move-out condition with date-stamped photos and videos to refute unreasonable deductions.',
    },
    legalNotes: [
      { jurisdiction: 'California', title: 'Civil Code § 1950.5 mandates 21 days and limits deductions', body: 'California landlords have 21 calendar days after move-out to return the full deposit or provide an itemized statement detailing repair deductions with actual receipts or invoices. Bad-faith retention may subject the landlord to statutory damages of up to twice the deposit amount.', sourceLabel: 'California Department of Justice: Security Deposits', sourceUrl: 'https://oag.ca.gov/consumers/general/landlord-tenant-issues' },
      { jurisdiction: 'New York State', title: '14-day return rule and complete forfeiture for noncompliance', body: 'Under NY General Obligations Law § 7-108, landlords must return security deposits within 14 days of move-out along with an itemized statement. If a landlord fails to provide the required statement within 14 days, they forfeit all legal rights to retain any portion of the deposit.', sourceLabel: 'New York Attorney General: Tenants’ Rights Guide', sourceUrl: 'https://ag.ny.gov/publications/residential-tenants-rights-guide' },
      { jurisdiction: 'Texas', title: '30-day deadline and triple damages for bad faith', body: 'Texas Property Code § 92.103-92.109 gives landlords 30 days to return the deposit after receiving a written forwarding address. A landlord who acts in bad faith is liable for $100 plus three times the improperly withheld amount and reasonable attorney fees.', sourceLabel: 'Texas State Law Library: Security Deposits', sourceUrl: 'https://www.statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm' },
      { jurisdiction: 'England', title: 'Tenancy deposit scheme protection and compensation', body: 'Under the Housing Act 2004, deposits must be registered in a government-backed tenancy deposit scheme (DPS, TDS, or mydeposits) within 30 days of receipt. Unprotected deposits or improper deductions can result in county court compensation of 1 to 3 times the deposit amount.', sourceLabel: 'GOV.UK: Tenancy deposit protection', sourceUrl: 'https://www.gov.uk/tenancy-deposit-protection' },
    ],
    faqs: [
      { question: 'How many days does a landlord have to return a security deposit?', answer: 'Deadlines depend on the state: California allows 21 days, New York allows 14 days, Texas allows 30 days, Florida allows 15 to 30 days, and the UK requires return within 10 days of mutual agreement.' },
      { question: 'Can a landlord deduct for normal wear and tear?', answer: 'No. Across all US states and the UK, landlords cannot deduct for ordinary wear and tear caused by everyday living, such as minor scuffs, sun-faded paint, or natural carpet aging.' },
      { question: 'What can I do if my landlord missed the return deadline?', answer: 'Send a formal written demand letter citing your state’s specific statute and deadline. If they fail to comply, you can file a claim in local small claims court to recover the deposit plus statutory penalties.' },
      { question: 'Do I have to provide a written forwarding address?', answer: 'Yes. In almost all jurisdictions, the landlord’s statutory countdown does not officially begin until you provide a written address where the check or notice can be delivered.' },
      { question: 'What receipts is a landlord required to provide?', answer: 'If deductions exceed statutory thresholds (e.g. $125 in California), landlords must include copies of bills, contractor invoices, or hourly wage documentation proving the actual cost of repairs.' },
    ],
  },
};
