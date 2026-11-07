export type SuiteTool = {
  slug: string;
  /** Short name used on cards, breadcrumbs and in structured data. */
  name: string;
  /** The page's one H1 — the phrase people actually search for. */
  h1: string;
  description: string;
  category: string;
  icon: string;
  priority: number;
  /** `<title>`, kept near 60 characters. */
  seoTitle: string;
  /** Meta description, kept near 155 characters. */
  metaDescription: string;
  keywords: string[];
  /** A two- or three-sentence answer an AI search engine can quote as-is. */
  answer: string;
  related: string[];
};

export const SUITE_TOOLS: SuiteTool[] = [
  {
    slug: 'ai-lease-scanner', name: 'Lease clause checker', h1: 'Lease clause checker', category: 'Lease', icon: 'Sparkles', priority: 1,
    description: 'Paste a lease or tenancy clause and flag common red flags: non-refundable deposits, no-notice entry, tenant-paid structural repairs and banned fees.',
    seoTitle: 'Lease Clause Checker – Spot Illegal Lease Terms (US & UK)',
    metaDescription: 'Paste a lease or tenancy clause to flag common red flags: non-refundable deposits, entry without notice, tenant-paid structural repairs and banned UK fees. Free and private.',
    keywords: ['lease clause checker', 'illegal lease clauses', 'lease red flags', 'can a landlord charge a non-refundable deposit', 'tenancy agreement checker', 'Tenant Fees Act 2019 banned fees'],
    answer: 'The lease clause checker reads the clause you paste and matches it against a fixed list of well-known problem terms — a deposit described as non-refundable, landlord entry without notice, tenants paying for structural or heating repairs, banned UK tenant fees and blanket guest bans. Each match shows the rule it relates to for the place you choose and a polite amendment request you can send. It is a pattern check, not legal advice: a clause it does not flag can still be unlawful.',
    related: ['security-deposit-refund', 'move-in-cash', 'rent-increase'],
  },
  {
    slug: 'rent-affordability', name: 'Rent affordability', h1: 'Rent affordability calculator', category: 'Budget', icon: 'WalletCards', priority: 2,
    description: 'Find a comfortable rent range from your income and monthly debt, using the 30% rule, 3× income and the UK 40× rule.',
    seoTitle: 'Rent Affordability Calculator – How Much Rent Can I Afford?',
    metaDescription: 'How much rent can you afford? Enter your salary or hourly wage and monthly debt to see the 30% rule, 3× income and UK 40× annual-income rent limits. Free, no signup.',
    keywords: ['rent affordability calculator', 'how much rent can I afford', '30 percent rule rent', '3x rent income requirement', '40x rent rule UK'],
    answer: 'The calculator turns your gross annual income into a monthly figure and applies three common screening rules: rent at 30% of gross monthly income, income of at least 3× the rent, and the UK letting-agent rule of annual income at least 40× the monthly rent. On a $72,000 salary that is $1,800 a month under the 30% rule and $2,000 under the 3× rule. Monthly debt payments are subtracted to show what is left under the 30% guideline.',
    related: ['move-in-cash', 'couple-rent-splitter', 'commute-vs-rent'],
  },
  {
    slug: 'move-in-cash', name: 'Move-in cash', h1: 'Move-in cost calculator', category: 'Budget', icon: 'KeyRound', priority: 3,
    description: 'Add up first month’s rent, deposit, fees and moving costs to see the cash you need before you collect the keys.',
    seoTitle: 'Move-In Cost Calculator – Cash Needed to Rent an Apartment',
    metaDescription: 'Add up first month’s rent, security deposit, last month’s rent, application fees, utility deposits and moving costs to see the cash you need before you get the keys.',
    keywords: ['move in costs calculator', 'how much money do I need to move into an apartment', 'first month last month security deposit', 'upfront rent costs'],
    answer: 'Move-in cash is the sum of first month’s rent, the security deposit (monthly rent × the number of months asked for), last month’s rent if it is required, application or admin fees, utility connection deposits and your moving costs. With $1,800 rent, a one-month deposit, $500 moving, $100 fees and $150 utility deposits, you need $4,350 up front. Refundable deposits are included because you still have to pay them on day one.',
    related: ['rent-affordability', 'moving-cost-estimator', 'prorated-rent'],
  },
  {
    slug: 'roommate-rent-splitter', name: 'Roommate rent split', h1: 'Roommate rent split calculator', category: 'Roommates', icon: 'UsersRound', priority: 4,
    description: 'Share rent fairly by bedroom size, with extra weight for a private bathroom, a balcony or view, and parking.',
    seoTitle: 'Roommate Rent Split Calculator – Split Rent by Room Size',
    metaDescription: 'Split rent fairly between roommates or flatmates by bedroom size, private bathroom, balcony and parking. Every share adds up to the rent to the cent. Free, no signup.',
    keywords: ['roommate rent split calculator', 'split rent by room size', 'how to split rent fairly', 'flatmate rent calculator', 'rent split with master bedroom'],
    answer: 'Each bedroom gets a weight equal to its floor area, increased by 15% for a private bathroom, 5% for a view or balcony and 10% for parking. Each person pays the rent multiplied by their room’s weight divided by the total of all weights, rounded so the shares add up exactly to the rent. Two equal 150 sq ft rooms on $2,400 rent pay $1,200 each.',
    related: ['utility-splitter', 'couple-rent-splitter', 'rent-per-sqft'],
  },
  {
    slug: 'prorated-rent', name: 'Prorated rent', h1: 'Prorated rent calculator', category: 'Budget', icon: 'CalendarDays', priority: 5,
    description: 'Work out rent for a partial month at move-in or move-out, by exact days, a 30-day month or a 365-day year.',
    seoTitle: 'Prorated Rent Calculator – Partial Month Rent by the Day',
    metaDescription: 'Calculate prorated rent for a mid-month move-in or move-out. Compare the exact-days, 30-day and 365-day methods with a clear daily rate. Free for US and UK renters.',
    keywords: ['prorated rent calculator', 'how to calculate prorated rent', 'partial month rent', 'rent for half a month', 'pro rata rent calculator UK'],
    answer: 'Prorated rent is the monthly rent divided by the number of days in the month, multiplied by the days you live there, counting both the move-in and move-out days. Moving in on 15 May with $1,800 rent means 17 days × ($1,800 ÷ 31) = $987.10. Some leases use a 30-day month ($1,020.00) or a 365-day year ($1,006.03) instead, so check which your agreement uses.',
    related: ['move-in-cash', 'sublease-rate', 'utility-splitter'],
  },
  {
    slug: 'utility-splitter', name: 'Utility splitter', h1: 'Utility bill splitter', category: 'Roommates', icon: 'ReceiptText', priority: 6,
    description: 'Split shared electric, gas, water and internet bills fairly, including days away, and settle up what each person has paid.',
    seoTitle: 'Utility Bill Splitter – Split Bills With Roommates Fairly',
    metaDescription: 'Split electric, gas, water and internet between housemates, adjusted for days away, and see who still owes what after payments already made. Free and private.',
    keywords: ['utility bill splitter', 'split utilities with roommates', 'how to split bills fairly', 'bill split calculator days away'],
    answer: 'Internet is split equally because it costs the same whether or not someone is home. Electric, gas and water are split by person-days: each person’s days at home in the billing period divided by everyone’s days at home combined. Each person’s settlement is their share minus what they have already paid; a negative number means they are owed money back.',
    related: ['roommate-rent-splitter', 'couple-rent-splitter', 'prorated-rent'],
  },
  {
    slug: 'rent-increase', name: 'Rent increase checker', h1: 'Rent increase calculator', category: 'Lease', icon: 'TrendingUp', priority: 7,
    description: 'See a proposed increase in money and percent, check the notice period, and compare with California’s AB 1482 cap or England’s notice rule.',
    seoTitle: 'Rent Increase Calculator – Percentage, Cap & Notice Check',
    metaDescription: 'Work out a rent increase in money and percent, count the notice days, and compare it with the California AB 1482 cap or England’s two-month notice rule. Free estimate.',
    keywords: ['rent increase calculator', 'rent increase percentage', 'how much can a landlord raise rent', 'AB 1482 rent cap calculator', 'rent increase notice period England'],
    answer: 'The increase percentage is (new rent − current rent) ÷ current rent × 100, so $1,800 rising to $1,900 is a $100 or 5.56% increase. For California units covered by AB 1482 the yearly cap is 5% plus regional CPI, never more than 10%, and the tool compares notice days with 30 days (90 if the rise is over 10%). For England it checks the effective date is at least two calendar months after notice.',
    related: ['rent-affordability', 'ai-lease-scanner', 'rent-vs-buy'],
  },
  {
    slug: 'rent-vs-buy', name: 'Rent vs. buy', h1: 'Rent vs buy calculator', category: 'Planning', icon: 'House', priority: 8,
    description: 'Compare the net cost of renting with buying over 3, 5 and 10 years, including mortgage, tax, upkeep and selling costs.',
    seoTitle: 'Rent vs Buy Calculator – Is It Cheaper to Rent or Buy?',
    metaDescription: 'Compare the net cost of renting vs buying a home over 3, 5 and 10 years: mortgage, property tax, insurance, upkeep, buying and selling costs and investment return.',
    keywords: ['rent vs buy calculator', 'is it better to rent or buy', 'rent or buy breakeven', 'buying vs renting cost comparison'],
    answer: 'Renting’s net cost is all rent paid minus what the down payment would have earned if invested. Buying’s net cost is the down payment, buying costs, mortgage payments, property tax, insurance and maintenance, minus the equity you would keep after selling costs. The breakeven year is the first year from which buying stays cheaper at every later yearly checkpoint.',
    related: ['cap-rate-calculator', 'rent-affordability', 'rent-increase'],
  },
  {
    slug: 'moving-cost-estimator', name: 'Moving cost estimator', h1: 'Moving cost estimator', category: 'Moving', icon: 'Truck', priority: 9,
    description: 'Estimate a moving budget from truck hire, round-trip fuel and labor, with a suggested truck size for your home.',
    seoTitle: 'Moving Cost Estimator – Truck, Fuel & Labor Budget',
    metaDescription: 'Estimate what your move will cost: suggested truck size, round-trip fuel, base hire and labor. Use miles with US gallons or UK litres. Free moving budget calculator.',
    keywords: ['moving cost estimator', 'moving truck cost calculator', 'how much does it cost to move', 'diy move cost', 'removal cost calculator UK'],
    answer: 'Moving cost = base vehicle or service cost + labor + round-trip fuel. Fuel is the distance × 2 ÷ the truck’s miles per gallon × the fuel price; in GBP mode the price is per litre and the tool converts imperial gallons at 4.54609 litres each. A 25-mile DIY move at 10 mpg and $3.50 a gallon uses $17.50 of fuel.',
    related: ['move-in-cash', 'commute-vs-rent', 'prorated-rent'],
  },
  {
    slug: 'commute-vs-rent', name: 'Commute vs. rent', h1: 'Commute vs rent calculator', category: 'Planning', icon: 'Route', priority: 10,
    description: 'Compare two homes by rent plus commuting cost and time, and see what each extra hour of commuting is worth.',
    seoTitle: 'Commute vs Rent Calculator – Is Cheaper Rent Worth It?',
    metaDescription: 'Compare two apartments by rent plus commute cost and time. See the monthly difference, yearly hours spent commuting and what each extra commute hour is worth.',
    keywords: ['commute vs rent calculator', 'is a longer commute worth cheaper rent', 'cost of commute calculator', 'rent and commute comparison'],
    answer: 'For each home the tool adds monthly rent to monthly commuting cost — either round-trip fuel for your workdays or the transit pass you enter. Yearly commute time is one-way minutes × 2 × workdays × 12 ÷ 60. Dividing the yearly cash saving by the extra hours gives what each extra commuting hour is effectively paying you.',
    related: ['rent-affordability', 'moving-cost-estimator', 'rent-per-sqft'],
  },
  {
    slug: 'sublease-rate', name: 'Sublease rate', h1: 'Sublease rate calculator', category: 'Lease', icon: 'CalendarRange', priority: 11,
    description: 'Price a sublet for exact dates: a daily rate from your rent, an optional furnished premium and utilities.',
    seoTitle: 'Sublease Rate Calculator – Daily & Monthly Sublet Price',
    metaDescription: 'Price a sublet for your exact dates: daily rate, total and monthly equivalent, with an optional furnished premium and utilities. Uses a 365-day year. Free US & UK tool.',
    keywords: ['sublease rate calculator', 'how much to charge for sublet', 'sublet price calculator', 'summer sublet rent'],
    answer: 'The daily rate is monthly rent × 12 ÷ 365, raised by any furnished premium you choose, plus utilities × 12 ÷ 365 if they are included. The total is the daily rate × the number of days, counting both the first and last day. A June 1 to August 31 sublet of an $1,800 flat with a 10% premium is 92 days at $65.10, or $5,988.82.',
    related: ['prorated-rent', 'utility-splitter', 'rent-increase'],
  },
  {
    slug: 'cap-rate-calculator', name: 'Rental property ROI', h1: 'Cap rate calculator', category: 'Investment', icon: 'ChartNoAxesCombined', priority: 12,
    description: 'Estimate a rental property’s net operating income, cap rate, cash flow after the mortgage and cash-on-cash return.',
    seoTitle: 'Cap Rate Calculator – Rental Property NOI & Cash-on-Cash',
    metaDescription: 'Calculate a rental property’s net operating income, cap rate, mortgage payment, yearly cash flow and cash-on-cash return from price, rent and expenses. Free.',
    keywords: ['cap rate calculator', 'rental property ROI calculator', 'cash on cash return calculator', 'NOI calculator', 'rental yield calculator'],
    answer: 'Net operating income (NOI) is yearly rent minus vacancy, property tax, insurance, maintenance and other expenses. Cap rate is NOI ÷ purchase price × 100 and ignores financing. Cash-on-cash return is NOI minus yearly mortgage payments, divided by the cash you put in (down payment plus closing costs).',
    related: ['rent-vs-buy', 'rent-per-sqft', 'rent-affordability'],
  },
  {
    slug: 'rent-per-sqft', name: 'Rent per area', h1: 'Rent per square foot calculator', category: 'Planning', icon: 'Ruler', priority: 13,
    description: 'Work out monthly and annual rent per square foot or square metre and compare a listing with another home.',
    seoTitle: 'Rent per Square Foot Calculator (sq ft & sq m)',
    metaDescription: 'Find monthly and annual rent per square foot or square metre, and compare one listing with another. Free rent per sq ft calculator for US and UK renters.',
    keywords: ['rent per square foot calculator', 'price per square foot rent', 'rent per square metre', 'compare apartments by size'],
    answer: 'Rent per square foot is the monthly rent divided by the floor area; multiply by 12 for the annual figure, which is how commercial rents are usually quoted. $2,000 for 1,000 sq ft is $2.00 per sq ft a month or $24 a year. In GBP mode the same sum uses square metres.',
    related: ['roommate-rent-splitter', 'commute-vs-rent', 'cap-rate-calculator'],
  },
  {
    slug: 'couple-rent-splitter', name: 'Couple rent splitter', h1: 'Couple rent split calculator', category: 'Roommates', icon: 'HeartHandshake', priority: 14,
    description: 'Split rent with a partner proportionally to income, 50/50, or so you both keep the same cash after rent.',
    seoTitle: 'Couple Rent Split Calculator – Split Rent by Income',
    metaDescription: 'Split rent with a partner three ways: in proportion to income, 50/50, or so you both keep the same money after rent. Free couple rent split calculator, no signup.',
    keywords: ['couple rent split calculator', 'split rent by income', 'how should couples split rent', 'proportional rent split', 'fair rent split couple'],
    answer: 'In a proportional split each partner pays rent × their take-home pay ÷ combined take-home pay, so both spend the same share of income on housing. With $2,400 rent and incomes of $5,000 and $3,000, that is $1,500 and $900. The equal-leftover split instead sets rent so both have the same cash left: partner 1 pays (rent + income 1 − income 2) ÷ 2.',
    related: ['roommate-rent-splitter', 'utility-splitter', 'rent-affordability'],
  },
  {
    slug: 'security-deposit-refund', name: 'Security deposit refund', h1: 'Security deposit return calculator', category: 'Lease', icon: 'ShieldCheck', priority: 15,
    description: 'Find the deadline for your landlord to return a deposit in California, New York, Texas, Florida or England, and possible penalties.',
    seoTitle: 'Security Deposit Return Calculator – Deadline by State',
    metaDescription: 'When must your landlord return your security deposit? See the deadline for California, New York, Texas, Florida or England from your move-out date, and possible penalties.',
    keywords: ['security deposit return deadline', 'how long does a landlord have to return a deposit', 'security deposit calculator', 'deposit return penalty', 'tenancy deposit return England'],
    answer: 'The tool adds the legal return period to your move-out date: 21 days in California, 14 in New York, 30 in Texas and 15 in Florida when the landlord makes no claim (30 if they send notice of one). In England the deposit must be repaid within 10 days of agreeing the amount. It also shows the maximum statutory penalty a court can award for bad-faith withholding where the state sets one.',
    related: ['ai-lease-scanner', 'move-in-cash', 'rent-increase'],
  },
];

export const getSuiteTool = (slug?: string) => SUITE_TOOLS.find((tool) => tool.slug === slug);
