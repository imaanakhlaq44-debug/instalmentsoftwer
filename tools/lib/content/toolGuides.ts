import { investmentGuides } from './investmentGuides';
import { tenancyGuides } from './tenancyGuides';
import { householdGuides } from './householdGuides';

export type GuideFAQ = { question: string; answer: string };

export type ToolGuide = {
  title: string;
  introduction: string;
  formula: {
    equation: string;
    explanation: string;
    methods: { name: string; description: string }[];
  };
  example: { title: string; steps: string[]; takeaway: string };
  legalNotes: {
    jurisdiction: string;
    title: string;
    body: string;
    sourceLabel: string;
    sourceUrl: string;
  }[];
  faqs: GuideFAQ[];
};

export const toolGuides: Record<string, ToolGuide> = {
  'prorated-rent': {
    title: 'How to calculate prorated rent',
    introduction: 'Estimate rent for a partial rental period by entering the monthly rent, move-in date, optional move-out date, and the day-count method that matches your lease. Dates are counted inclusively: both the first and last entered dates count as occupied. Leave move-out blank to use the final day of the move-in month. This is an estimate of rent only, not a deposit, utility, fee, or legal determination.',
    formula: {
      equation: 'Exact: sum for each covered month of (monthly rent ÷ that month’s actual days × occupied days). 30-day: monthly rent ÷ 30 × occupied days. 365-day: (monthly rent × 12 ÷ 365) × occupied days.',
      explanation: 'The exact method splits a period at calendar-month boundaries, counts each segment’s days inclusively, and uses that month’s actual day count as divisor. The fixed 30-day and annual 365-day methods use the same daily rate for each occupied day, including across months. Results are rounded to cents by the calculator.',
      methods: [
        { name: 'Exact calendar days', description: 'For each month, divide monthly rent by that month’s actual length (28, 29, 30, or 31) and multiply by occupied days in that month.' },
        { name: 'Fixed 30-day month', description: 'Divide monthly rent by 30, then multiply by total occupied days. For a full 31-day month, this convention can produce more than one full monthly rent; it is not the same as exact-calendar or 30/360 treatment.' },
        { name: 'Annual 365-day', description: 'Divide 12 months of rent by 365 and multiply by occupied days. This convention keeps the denominator at 365, including in leap years; the agreement may specify another treatment.' },
      ],
    },
    example: {
      title: '$1,800 monthly rent, May 15–May 31, 2026',
      steps: [
        'Count May 15 through May 31 inclusive: 31 − 15 + 1 = 17 occupied days.',
        'Exact calendar method: May has 31 days, so daily rent is $1,800 ÷ 31 = $58.064516…',
        'Multiply $58.064516… by 17 = $987.0967…, rounded to $987.10.',
        'For comparison, fixed 30-day method gives $1,800 ÷ 30 × 17 = $1,020.00; annual method gives $1,800 × 12 ÷ 365 × 17 = $1,004.38.',
      ],
      takeaway: 'The method materially changes the estimate. Check the lease or ask the landlord which convention applies; neither a universal US nor UK rule mandates one of these calculator methods.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'The lease and local law matter', body: 'Proration treatment may depend on the lease and applicable state or local law. This calculator shows mathematical conventions only; it does not determine what a landlord may charge or replace reviewing the agreement.', sourceLabel: 'USA.gov: State and local governments', sourceUrl: 'https://www.usa.gov/state-governments' },
      { jurisdiction: 'England', title: 'Confirm the rent period in your tenancy terms', body: 'The agreement sets the contractual rent terms. England’s current assured-periodic-tenancy guidance describes the tenancy agreement as the contract setting legal terms; it does not prescribe one universal daily proration divisor. Other UK nations have different rules.', sourceLabel: 'GOV.UK: Assured periodic tenancies—tenancy agreements', sourceUrl: 'https://www.gov.uk/private-renting-tenancy-agreements/your-tenancy-agreement' },
      { jurisdiction: 'New York State', title: 'Keep prorated rent separate from deposit return deadlines', body: 'For units that are not rent stabilized or rent controlled, the New York Attorney General says the landlord must return the security deposit, with an itemized statement for deductions, within 14 days after move-out. The guide treats regulated units differently. This deposit deadline does not establish a right to a prorated rent refund; check the lease, notice and applicable rent rules separately.', sourceLabel: 'New York Attorney General: Residential Tenants’ Rights Guide', sourceUrl: 'https://ag.ny.gov/publications/residential-tenants-rights-guide' },
    ],
    faqs: [
      { question: 'Is prorated rent required by law, including when I move out mid-month?', answer: 'There is no single answer across US states and UK nations. A calculator result does not create a refund entitlement or end a tenancy. Check the agreement, notice requirements, agreed surrender date and applicable local law; get written confirmation of any partial-month charge or refund before paying less rent.' },
      { question: 'Which prorating method should I choose?', answer: 'Use the method stated in your lease or agreed in writing. If it is unclear, ask the landlord or property manager to confirm the divisor and which dates are billable before relying on a number.' },
      { question: 'Does the calculator count both move-in and move-out dates?', answer: 'Yes. The calculation counts both selected dates as occupied. If your agreement defines a different handover or rent-stop date, use that contractual interpretation instead.' },
      { question: 'What happens if I leave the move-out date blank?', answer: 'The calculator uses the last calendar day of the move-in month. It does not assume a later lease end date.' },
      { question: 'Can a 30-day method charge more than a month’s rent?', answer: 'Yes. If all 31 days of a month are charged at monthly rent divided by 30, the result is 31/30 of monthly rent. This is why it should not be confused with exact calendar-day proration or a 30/360 convention.' },
      { question: 'Does annual 365-day proration change in a leap year?', answer: 'No. This tool’s annual method always divides monthly rent × 12 by 365, including leap years. Confirm whether your agreement uses that convention or another one.' },
    ],
  },
  'rent-affordability': {
    title: 'How to estimate rent affordability',
    introduction: 'Enter gross annual income, or hourly pay and usual weekly hours, plus monthly debt payments. The headline is a planning guideline of 30% of gross monthly income; the tool also displays 20%, 25%, 35%, a three-times-monthly-income comparison, a UK 40-times-annual-income comparison, and the 30% figure after debt. These are separate reference points, not a legal eligibility test or a personalized budget.',
    formula: {
      equation: 'Hourly mode annual gross income = hourly wage × hours per week × 52. Gross monthly income = annual gross income ÷ 12. Headline guideline = gross monthly income × 30%. Debt-adjusted comparison = max(0, headline guideline − monthly debt).',
      explanation: 'The headline is always 30% of gross monthly income regardless of location or income mode. The three-times-monthly and annual-income-divided-by-40 rows are separate comparisons; neither replaces the headline or is an automatic approval rule. Debt is subtracted only for the separate adjusted figure, which cannot fall below zero.',
      methods: [
        { name: 'Annual income input', description: 'Enter gross income before tax for a year; the calculator divides it by 12 to derive gross monthly income.' },
        { name: 'Hourly income input', description: 'The tool annualizes gross wages as hourly wage × hours per week × 52, then divides that annual amount by 12. It does not account for unpaid leave, variable hours, overtime variability, or taxes.' },
        { name: 'Comparison rows', description: 'The 20%, 25%, 30%, and 35% amounts are shares of gross monthly income. Three-times-monthly gross is monthly income ÷ 3; UK 40× annual is annual income ÷ 40. Monthly debt affects only the separate 30%-after-debt row.' },
      ],
    },
    example: {
      title: '$25 per hour, 40 hours each week, and $250 monthly debt',
      steps: [
        'Annualize income: $25 × 40 × 52 = $52,000 gross per year.',
        'Gross monthly income: $52,000 ÷ 12 = $4,333.3333….',
        'Headline 30% guideline: $4,333.3333… × 0.30 = $1,300.00 per month.',
        'Other percentage markers: 20% = $866.67; 25% = $1,083.33; 35% = $1,516.67.',
        'Separate comparisons: 3× monthly gross = $4,333.3333… ÷ 3 = $1,444.44; annual ÷ 40 = $1,300.00.',
        'Debt-adjusted comparison: max(0, $1,300 − $250) = $1,050.00 per month.',
      ],
      takeaway: 'The $1,300 headline is a gross-income benchmark, not a promise that rent is affordable after taxes and expenses or that an application will be accepted. Compare the estimate with take-home pay and your full budget.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'Income multiples are screening practices, not a national rent law', body: 'There is no universal federal 3×-income rent qualification rule established by this calculator. Screening practices vary by provider and location, and housing providers remain subject to applicable fair-housing and other laws. Ask for the actual written criteria; do not treat a benchmark as a legal entitlement or guarantee.', sourceLabel: 'HUD: Fair Housing', sourceUrl: 'https://www.hud.gov/fairhousing' },
      { jurisdiction: 'California', title: 'Screening must follow applicable fair-housing protections', body: 'California protects applicants against housing discrimination, including discrimination based on lawful source of income. This does not establish a particular rent-to-income threshold. Review the criteria and applicable protections for your situation.', sourceLabel: 'California Civil Rights Department: Fair Housing', sourceUrl: 'https://calcivilrights.ca.gov/housing/' },
      { jurisdiction: 'England', title: 'Budget for a lawful deposit as well as monthly rent', body: 'For tenancies covered by the Tenant Fees Act 2019, a tenancy deposit is capped at five weeks’ rent below £50,000 annual rent, or six weeks at £50,000 or more; a holding deposit is capped at one week. These are separate upfront costs, not amounts included in this calculator’s monthly rent estimate. If asked for too much deposit, GOV.UK advises contacting the local council for help.', sourceLabel: 'GOV.UK: Private renting—deposits', sourceUrl: 'https://www.gov.uk/private-renting/deposits' },
      { jurisdiction: 'England', title: 'A 40× income check is not a statutory requirement', body: 'An agent or landlord may use its own affordability assessment, but the calculator’s annual-income-divided-by-40 comparison is not a rule of English law and is not guaranteed to be any provider’s criterion. Different UK nations have separate housing law.', sourceLabel: 'GOV.UK: Private renting', sourceUrl: 'https://www.gov.uk/private-renting' },
    ],
    faqs: [
      { question: 'Should I enter gross or take-home income?', answer: 'Enter gross income before tax. The calculator’s income percentages use gross amounts, so use your take-home pay separately when planning what remains for rent, bills, food, transport, savings, and other commitments.' },
      { question: 'How does the hourly-income option work?', answer: 'It multiplies hourly wage by weekly hours and 52 weeks. For example, $25 × 40 × 52 = $52,000 annual gross income, equivalent to $4,333.33 monthly before rounding. Variable schedules or unpaid time can make this estimate high.' },
      { question: 'Is the headline 30% a legal limit or approval guarantee?', answer: 'No. It is a planning benchmark and does not determine legal eligibility, landlord approval, or whether a rent fits your household budget. Screening requirements and protections vary by location.' },
      { question: 'What do the 3× and 40× figures mean?', answer: 'Under a 3× screening check, gross monthly income must be at least three times the proposed monthly rent, so the comparable rent ceiling is gross monthly income divided by 3. The 40× comparison is annual gross income divided by 40. They are not combined with the headline 30% calculation and are not universal legal requirements, including in the UK.' },
      { question: 'How are monthly debt payments included?', answer: 'Debt is not subtracted from the headline or the percentage and income-multiple rows. The tool separately subtracts entered monthly debt from the 30% figure and floors that adjusted comparison at zero; it does not model your full budget.' },
    ],
  },
  'roommate-rent-splitter': {
    title: 'How to split rent by room size and features',
    introduction: 'Enter total rent and a positive area for each room, then mark any private bathroom, view, or parking benefit. The model turns each room into a relative weight and allocates the total rent in proportion to those weights. It is a transparent starting point for a roommate conversation, not a legal contract or a judgment of what is fair for every household.',
    formula: {
      equation: 'Room weight = area × (1 + 0.15 if private bath + 0.05 if view + 0.10 if parking). Room share = total rent × room weight ÷ sum of all room weights; the final room receives the remaining cents so allocations reconcile.',
      explanation: 'The feature percentages add to the room’s area-based weight: private bath adds 15% of base area, view adds 5%, and parking adds 10%. They are additive relative weights, not extra charges or percentages of total rent. Shares are rounded down to cents for rooms in order, and the last room receives the cent remainder. There is no separate charge per person, occupancy adjustment, or modeled equal allocation of common areas.',
      methods: [
        { name: 'Area baseline', description: 'Each room starts with a weight equal to its entered area; areas must be positive.' },
        { name: 'Feature adjustments', description: 'A checked private bath, view, and parking each increase area weight by 15%, 5%, and 10%, respectively. Multiple feature weights add together.' },
        { name: 'Proportional allocation and rounding', description: 'Each room receives its share of total rent according to its weight divided by total weights. The final listed room absorbs any cent-rounding remainder.' },
      ],
    },
    example: {
      title: '$2,400 total rent split between two differently weighted rooms',
      steps: [
        'Room A: 150 sq ft with a private bath and parking. Weight = 150 × (1 + 0.15 + 0.10) = 187.5.',
        'Room B: 120 sq ft with a view. Weight = 120 × (1 + 0.05) = 126.',
        'Total weight = 187.5 + 126 = 313.5.',
        'Room A share = $2,400 × 187.5 ÷ 313.5 = $1,434.2105…, rounded down to $1,434.21.',
        'Room B receives the remaining $2,400 − $1,434.21 = $965.79. Together the displayed shares equal $2,400.00.',
      ],
      takeaway: 'Feature adjustments are negotiable modeling choices, not market values or legal standards. Agree on room measurements, feature values, shared-space treatment, and each person’s responsibility before relying on a split.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'A calculator split does not change lease liability', body: 'Roommates’ obligations depend on the signed lease and local law. If all occupants sign one joint lease, the agreement may make them responsible together for rent; a private split between roommates may not bind the landlord. Obtain local advice if someone is leaving or not paying.', sourceLabel: 'USA.gov: Renting a home', sourceUrl: 'https://www.usa.gov/renting-a-home' },
      { jurisdiction: 'New York State', title: 'Check the lease for responsibility among occupants', body: 'New York’s official tenant guidance covers lease obligations and security deposits; a roommate’s internal rent allocation does not itself amend a lease or release a signer. Confirm any change with the landlord in writing and review applicable local rules.', sourceLabel: 'New York Attorney General: Residential Tenants’ Rights Guide', sourceUrl: 'https://ag.ny.gov/publications/residential-tenants-rights-guide' },
      { jurisdiction: 'England', title: 'Deposit caps and council help', body: 'For tenancies covered by the Tenant Fees Act 2019, the tenancy deposit cap is five weeks’ rent when annual rent is below £50,000, or six weeks at £50,000 or more. Agree how any permitted deposit is shared and recorded; a rent split does not validate a deposit demand. GOV.UK advises contacting the local council for help with an excessive deposit.', sourceLabel: 'GOV.UK: Private renting—deposits', sourceUrl: 'https://www.gov.uk/private-renting/deposits' },
      { jurisdiction: 'England', title: 'Joint tenants are responsible for the rent', body: 'For an assured periodic tenancy, GOV.UK says that where more than one tenant signs the same agreement, it is a joint tenancy and all joint tenants are responsible for the rent. The guide applies only to that tenancy type; other UK nations and tenancy situations differ.', sourceLabel: 'GOV.UK: Assured periodic tenancies—tenancy agreements', sourceUrl: 'https://www.gov.uk/private-renting-tenancy-agreements/your-tenancy-agreement' },
    ],
    faqs: [
      { question: 'How are the room shares calculated?', answer: 'Each room’s area is its base weight. The tool adds 15% for a private bath, 5% for a view, and 10% for parking, then assigns rent in proportion to each room’s weight divided by the total weights.' },
      { question: 'Are the feature percentages extra fees?', answer: 'No. They adjust relative room weights; they are not added directly to the rent. A 150-area room with bath and parking has weight 150 × 1.25 = 187.5 before comparing it with other rooms.' },
      { question: 'How does the calculator handle rounding?', answer: 'It converts rent to cents, rounds down proportional allocations for rooms before the last, and gives the final room the remaining cents. As a result, displayed room amounts reconcile to the entered total.' },
      { question: 'Does the tool account for two people sharing one room or common areas?', answer: 'No. It allocates by room and the selected room features only. It does not add a per-person charge, account for double occupancy, or separately measure and allocate shared kitchens, living rooms, or other common space.' },
      { question: 'Does this split change what I owe the landlord?', answer: 'Not by itself. A roommate arrangement is not necessarily a change to the tenancy contract. Review who signed, how rent is owed, and whether the landlord must approve a change; in England, joint tenants on the same assured periodic tenancy agreement are responsible for the rent.' },
    ],
  },
};

Object.assign(toolGuides, investmentGuides, tenancyGuides, householdGuides);

export function getToolGuide(slug: string): ToolGuide | undefined {
  return toolGuides[slug];
}
