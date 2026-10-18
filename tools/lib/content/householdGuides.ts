import type { ToolGuide } from './toolGuides';

export const householdGuides: Record<string, ToolGuide> = {
  'utility-splitter': {
    title: 'How to split household utility bills',
    introduction: 'Enter the billing-period total for electricity, gas, water, and internet, the number of billing days, each person’s days away, and any amount already paid. The estimate equally divides internet among everyone and allocates electricity, gas, and water by each person’s days present. It is a configurable arithmetic aid, not a ruling on what roommates owe under a lease or utility agreement.',
    formula: {
      equation: 'Person-daysᵢ = billing days − days awayᵢ. Variable-utility shareᵢ = (electric + gas + water) × person-daysᵢ ÷ total person-days. Internet shareᵢ = internet ÷ number of people. Owedᵢ = variable shareᵢ + internet shareᵢ. Settlementᵢ = owedᵢ − paidᵢ.',
      explanation: 'The calculator totals the three variable bills and divides them by person-days, while internet is divided equally regardless of absence. Each person’s allocation is rounded to cents; the final person receives the rounding remainder so allocations reconcile to the total. Settlement is each person’s own allocated share minus their entered payment; positive means still owed to the bill collector and negative indicates an overpayment that roommates may need to reimburse. This is not a pairwise reimbursement optimizer and does not decide who should pay whom.',
      methods: [
        { name: 'Person-day allocation', description: 'For each resident, count billing days minus days away. Divide the variable bill total proportionally by those present-person-days; longer occupancy produces a larger variable share.' },
        { name: 'Equal internet allocation', description: 'Divide the entire internet charge equally by the number of people. Absence days do not change this share.' },
        { name: 'Settlement after payments', description: 'Subtract each person’s prior payment from their allocated total. Positive and negative settlements indicate remaining balance and overpayment respectively; resolve transfers among residents separately.' },
      ],
    },
    example: {
      title: '$270 in bills for three roommates over 30 days',
      steps: [
        'Bills total $120 electricity + $60 gas + $30 water + $60 internet = $270. Alex is away 0 days, Blair 10, and Casey 5.',
        'Person-days are Alex 30, Blair 20, Casey 25, for 75 total. Variable bills are $210, so the per-person-day rate is $210 ÷ 75 = $2.80.',
        'Variable shares are Alex $84, Blair $56, and Casey $70. Internet is $60 ÷ 3 = $20 each, so allocations are $104, $76, and $90, totaling $270.',
        'With prior payments of $120, $100, and $50 respectively, settlements are Alex −$16, Blair −$24, and Casey +$40 (owed − paid).',
      ],
      takeaway: 'The calculator outputs the checked allocations and balances, not a roommate-to-roommate transfer plan. Agree in writing what absence means, how bills are apportioned, and how one roommate’s overpayment is reimbursed.',
    },
    legalNotes: [
      { jurisdiction: 'England', title: 'Energy resales: check the actual agreement and energy charges', body: 'For a home supplied through a landlord’s or site owner’s business energy contract, Ofgem says a resident paying by meter readings or estimates may see the supplier bill and contract and challenge unexplained or incorrect charges. The landlord or site owner cannot profit from resold energy and can charge only the same price paid for the energy; a separate administration fee may be allowed. Fixed fees included in rent or service charges are treated differently. This is specifically Ofgem’s guidance for these arrangements, not a universal rule for every roommate utility agreement.', sourceLabel: 'Ofgem: If you live in a home with a business energy contract', sourceUrl: 'https://www.ofgem.gov.uk/your-energy-supply/how-manage-your-energy-supply/if-you-live-home-business-energy-contract' },
      { jurisdiction: 'United States (general)', title: 'A utility split does not replace the lease or local rules', body: 'The calculator does not establish whether a tenant or roommate can be billed separately, whether a markup is allowed, or who is responsible for a utility account. Check the lease, written roommate agreement, meter and billing records, and state or local tenant rules before treating a calculated balance as legally owed.', sourceLabel: 'USA.gov: State and local governments', sourceUrl: 'https://www.usa.gov/state-governments' },
      { jurisdiction: 'England', title: 'Make utility responsibilities clear in the tenancy terms', body: 'GOV.UK describes the tenancy agreement as the contract setting the legal terms between landlord and tenant. Record which utilities are included, who holds each account, how shared bills are calculated, and how statements can be checked; do not assume this calculator changes the contract. Other UK nations have different rules.', sourceLabel: 'GOV.UK: Your tenancy agreement', sourceUrl: 'https://www.gov.uk/private-renting-tenancy-agreements/your-tenancy-agreement' },
    ],
    faqs: [
      { question: 'Does being away mean I pay nothing for utilities?', answer: 'No. Absence reduces only your share of electricity, gas, and water under this calculator’s person-day method. You still receive an equal share of internet, and your agreement may require another arrangement.' },
      { question: 'Why is internet split equally?', answer: 'The calculation treats internet as a fixed shared service and allocates it equally among listed residents, regardless of days away. Change the household agreement or use a separate calculation if your household has agreed otherwise.' },
      { question: 'How are prior payments handled?', answer: 'The tool subtracts each person’s entered payment from that person’s allocated bill share. A positive settlement means more is owed to the bill collector; a negative result means that person has paid more than their allocation.' },
      { question: 'Does a negative settlement tell us who to reimburse?', answer: 'It identifies an overpayment but does not generate pairwise transfers or optimize who pays whom. Roommates should compare all settlements and decide on a clear repayment arrangement.' },
      { question: 'What if someone was away only part of a day?', answer: 'The tool uses the days-away figure you enter and does not measure actual consumption within a day. Agree on a consistent convention or use actual submeter data if available.' },
      { question: 'Do these calculations prove a roommate owes this amount?', answer: 'No. This is a mathematical allocation only. The lease, roommate agreement, actual bills, local law, and any applicable utility resale rules may control.' },
    ],
  },
  'moving-cost-estimator': {
    title: 'How to estimate basic moving costs',
    introduction: 'Choose the apartment-size category, enter one-way distance in miles, service type, fuel price, loaded-move fuel economy, base/service cost, and labor. The estimator returns an indicative budget combining entered base cost and labor with fuel for a round trip. It is not a mover quote: it omits many possible costs such as insurance, packing, tolls, parking, deposits, taxes, storage, and extra services, and vehicle capacities and base costs are rough assumptions.',
    formula: {
      equation: 'Estimated fuel = one-way miles × 2 ÷ entered MPG × entered fuel price × fuel-unit factor. Budget = entered base/service cost + entered labor + estimated fuel. Fuel-unit factor = 1 with USD/US-gallon pricing; 4.54609 with GBP/litre pricing and imperial MPG. No currency exchange occurs.',
      explanation: 'Distance is treated as one-way and multiplied by two for the return trip. The entered MPG is used for the loaded move; USD assumes price per US gallon, while GBP converts the implied imperial gallons to litres using 4.54609. The calculator does not validate currency units or predict real truck consumption. It adds the supplied base/service and labor amounts but does not make the fuel result a full-cost estimate or quote.',
      methods: [
        { name: 'DIY truck planning', description: 'Estimate a vehicle category from apartment size and combine the entered base cost and labor with round-trip fuel. Verify truck size, mileage allowance, insurance, and included equipment with the rental provider.' },
        { name: 'Full-service planning', description: 'The service label is informational; the same arithmetic adds the entered base/service cost, labor, and round-trip fuel. Obtain a written mover quote covering the actual services and shipment.' },
        { name: 'Fuel sensitivity check', description: 'Vary one-way distance, fuel price, and loaded MPG to compare fuel assumptions. A larger MPG lowers estimated fuel; this does not account for idling, unloaded return rates, route, or other vehicle charges.' },
      ],
    },
    example: {
      title: '$228 illustrative DIY estimate for a 40-mile move',
      steps: [
        'Enter a 2-bedroom apartment, one-way distance 40 miles, DIY service, fuel at $3.50 per US gallon, loaded fuel economy 10 MPG, $125 base cost, and $75 labor.',
        'Round-trip distance = 40 × 2 = 80 miles; fuel quantity = 80 ÷ 10 = 8 US gallons.',
        'Fuel estimate = 8 × $3.50 = $28.00.',
        'Budget = $125 + $75 + $28 = $228.00; the calculator labels the suggested vehicle category as 20ft.',
      ],
      takeaway: 'This checked result is not the full cost of moving or a guaranteed price. Request a written, itemized quote and add likely extras such as protection, mileage charges, tolls, packing supplies, and storage.',
    },
    legalNotes: [
      { jurisdiction: 'United States (interstate moves)', title: 'FMCSA distinguishes binding and non-binding estimates', body: 'For interstate household-goods moves, FMCSA says a mover must provide a written estimate of all charges, based on an actual or virtual inspection; a “rate quote” is not an estimate. A binding estimate caps what is due at delivery for the listed shipment and services, subject to new items or services and specified circumstances. A non-binding estimate is not a guaranteed final cost; the mover cannot require more than 110% of it at delivery, with remaining charges handled under applicable rules. This federal guidance is for interstate moves, not every intrastate move.', sourceLabel: 'FMCSA: What is a binding move estimate?', sourceUrl: 'https://www.fmcsa.dot.gov/consumer-protection/protect-your-move/what-binding-move-estimate' },
      { jurisdiction: 'United States', title: 'Verify mover credentials and understand the paperwork', body: 'FMCSA’s interstate estimate guidance advises an actual or virtual inspection and a written estimate including transportation, accessorial, and advance charges. This simple estimator includes none of those protections or checks; compare the estimate with the mover’s written documents and verify applicable licensing and consumer guidance for your state and move type.', sourceLabel: 'FMCSA: What is a binding move estimate?', sourceUrl: 'https://www.fmcsa.dot.gov/consumer-protection/protect-your-move/what-binding-move-estimate' },
      { jurisdiction: 'England', title: 'Compare removals quotes, service and insurance', body: 'GOV.UK advises getting more than one removal-company quote and checking price, service quality, availability, insurance cover, trade-association membership, and small-print additional charges. A mathematical fuel estimate is no substitute for checking what a company’s written quote includes.', sourceLabel: 'GOV.UK: How to sell a home—choosing a removal company', sourceUrl: 'https://www.gov.uk/government/publications/how-to-sell-a-home/how-to-sell-a-home' },
    ],
    faqs: [
      { question: 'Is the result a mover’s quote or a guaranteed total?', answer: 'No. It adds only entered base cost, labor, and a rough fuel estimate. Get a written quote with the specific services, shipment, fees, and terms.' },
      { question: 'Is distance entered one-way or round trip?', answer: 'Enter one-way miles. The tool multiplies the distance by two for its round-trip fuel estimate.' },
      { question: 'What does MPG mean in USD and GBP mode?', answer: 'In USD mode the calculation uses US gallons. In GBP mode it converts the fuel quantity from imperial gallons to litres using 4.54609 litres per imperial gallon, then multiplies by the entered fuel price. Enter a compatible price unit; the calculator cannot check it.' },
      { question: 'Does the fuel estimate include all moving-vehicle costs?', answer: 'No. It is fuel only, based on entered distance, loaded MPG, and fuel price. It does not cover rental mileage charges, insurance, fuel surcharges, tolls, parking, or other costs unless separately included in your entered base and labor amounts.' },
      { question: 'What do apartment size and service type change?', answer: 'Apartment size selects a rough suggested vehicle category. Service type labels the result as full-service or DIY truck, but the cost arithmetic itself adds the same entered base cost, labor, and fuel.' },
      { question: 'What is the difference between a binding and non-binding US estimate?', answer: 'For interstate moves, FMCSA says a binding estimate guarantees no more than the estimate is due at delivery for the listed shipment and services, while a non-binding estimate is not a final-price guarantee and generally limits what can be demanded at delivery to 110% of the estimate. Read FMCSA guidance and the actual documents; intrastate rules differ.' },
    ],
  },
  'commute-vs-rent': {
    title: 'Compare rent with commuting costs',
    introduction: 'Compare two homes by entering monthly rent, one-way commute distance and minutes, workdays per month, and either car fuel assumptions or monthly transit costs. The headline compares rent plus estimated monthly commute cash cost for B minus A. The car model estimates fuel only and includes a round trip each workday; it is not the full cost of owning or operating a vehicle. Separate annual commute-hours and break-even-time rows help frame trade-offs but do not price your time automatically.',
    formula: {
      equation: 'Car commuteᵢ per month = one-way distanceᵢ × 2 × workdays ÷ MPG × entered fuel price × fuel-unit factor (USD: price/US gallon and factor 1; GBP: price/litre and factor 4.54609 with imperial MPG). Transit commuteᵢ = entered monthly transit cost. Monthly totalᵢ = rentᵢ + commuteᵢ. Headline = total B − total A. Annual hoursᵢ = one-way minutesᵢ × 2 × workdays × 12 ÷ 60.',
      explanation: 'Car mode counts round-trip fuel for each entered workday; USD MPG and fuel price use US gallons, while GBP converts imperial gallons to litres using 4.54609. Transit mode uses the entered monthly passes. The break-even value of extra commute time annualizes the difference in monthly cash cost and divides it by the difference in annual commute hours, when applicable. This is a comparison of entered assumptions, not a personalized full-cost or time-value model.',
      methods: [
        { name: 'Car fuel comparison', description: 'Enter one-way miles, round trips are assumed, workdays per month, MPG, and fuel price. The result counts fuel only; add parking, tolls, maintenance, depreciation, insurance, and other costs separately if relevant.' },
        { name: 'Transit comparison', description: 'Enter each location’s monthly transit cost. The tool uses that amount directly as commute cost and does not infer fares, passes, transfers, or service changes.' },
        { name: 'Cash-plus-time comparison', description: 'Compare monthly rent plus commute cash cost, then inspect annual hours and the break-even value row. The time row is an arithmetic comparison rather than a wage valuation or recommendation.' },
      ],
    },
    example: {
      title: 'Option B is $150.72 cheaper monthly before valuing time',
      steps: [
        'Enter A rent $2,100, 10-mile one-way drive and 25 minutes one way; B rent $1,900, 18 miles and 40 minutes. Use 22 workdays/month, 25 MPG, $3.50/US gallon, car mode.',
        'A fuel = 10 × 2 × 22 ÷ 25 × $3.50 = $61.60; A monthly rent plus fuel = $2,161.60.',
        'B fuel = 18 × 2 × 22 ÷ 25 × $3.50 = $110.88; B monthly rent plus fuel = $2,010.88.',
        'Headline B − A = $2,010.88 − $2,161.60 = −$150.72, so B is $150.72 cheaper per month on modeled cash costs.',
        'Annual commute time is 25 × 2 × 22 × 12 ÷ 60 = 220 hours for A, versus 40 × 2 × 22 × 12 ÷ 60 = 352 for B; B adds 132 hours/year. The displayed break-even value is $150.72 × 12 ÷ 132 = $13.70 per extra hour.',
      ],
      takeaway: 'The estimate omits many transport costs and does not decide whether the extra commute time is worth the rent savings. Compare full likely costs, actual schedules, and personal priorities before choosing.',
    },
    legalNotes: [
      { jurisdiction: 'United States (federal tax)', title: 'Ordinary home-to-work commuting is generally personal', body: 'IRS Publication 463 says travel between home and a main or regular workplace is a personal commuting expense and is not deductible, regardless of distance. Special rules can apply to travel between work locations, temporary work locations, or a qualifying home office; this rent-and-commute calculator is not a tax determination.', sourceLabel: 'IRS Publication 463: Travel, Gift, and Car Expenses', sourceUrl: 'https://www.irs.gov/publications/p463' },
      { jurisdiction: 'United Kingdom (employee expenses)', title: 'Do not treat normal commuting as a deductible work cost', body: 'HMRC distinguishes ordinary commuting from eligible business travel; ordinary travel between home and a permanent workplace is generally not allowable employee travel expense. Circumstances such as temporary workplaces can differ. This calculator does not determine tax relief or employment status.', sourceLabel: 'GOV.UK: Expenses and benefits—travel and subsistence', sourceUrl: 'https://www.gov.uk/expenses-and-benefits-travel-and-subsistence' },
      { jurisdiction: 'England', title: 'Check public transport and local travel arrangements separately', body: 'GOV.UK moving guidance recommends planning service providers and logistics around a move. This calculator uses the monthly transit amount you enter rather than live fares, and it does not verify routes, fare eligibility, parking restrictions, tolls, or local commuting schemes.', sourceLabel: 'GOV.UK: How to sell a home—preparations for moving', sourceUrl: 'https://www.gov.uk/government/publications/how-to-sell-a-home/how-to-sell-a-home' },
    ],
    faqs: [
      { question: 'Does car cost include more than fuel?', answer: 'No. The calculator estimates fuel only from distance, workdays, MPG, and fuel price. It does not include depreciation, insurance, maintenance, parking, tolls, financing, or the broader costs of owning a vehicle.' },
      { question: 'Should I enter one-way or round-trip distance and time?', answer: 'Enter one-way distance and minutes. The calculator multiplies each by two to estimate a daily return commute.' },
      { question: 'How does the currency affect fuel units?', answer: 'USD uses US gallons. GBP converts imperial gallons to litres using 4.54609 litres per imperial gallon. Use a fuel price consistent with that currency/unit convention.' },
      { question: 'How does transit mode work?', answer: 'Enter the monthly transit cost for each option. The calculator uses those amounts directly; it does not estimate fares from distance, route, travel frequency, or eligibility.' },
      { question: 'What does a negative B − A headline mean?', answer: 'It means option B’s entered rent plus modeled monthly commute cash cost is lower than A’s. It does not mean B is cheaper after omitted transport costs or after assigning a value to time.' },
      { question: 'Is ordinary commuting tax deductible?', answer: 'Generally, ordinary travel from home to a regular workplace is treated as personal commuting in both the IRS and HMRC guidance. Business travel and temporary-workplace rules may differ; check current official guidance or a tax professional for your circumstances.' },
      { question: 'Does the break-even value mean I should accept the longer commute?', answer: 'No. It expresses the annualized cash difference per modeled additional commute hour, not your wage, utility, health impact, schedule reliability, childcare needs, or personal value of time.' },
    ],
  },
  'couple-rent-splitter': {
    title: 'How to split rent and household expenses as a couple',
    introduction: 'Calculate fair, transparent rent allocations for partners moving in together. Compare proportional-to-income splits, equal 50/50 division, and equal discretionary spending cash. The calculator ensures partners contribute according to their financial means without awkward money arguments.',
    formula: {
      equation: 'Proportional share A = total rent × (income A ÷ combined income). Proportional share B = total rent × (income B ÷ combined income). Equal leftover share A = (total rent + income A − income B) ÷ 2. Equal leftover share B = total rent − share A.',
      explanation: 'The proportional method calculates each partner’s contribution so that both spend the identical percentage of their net monthly income on rent. The equal leftover method balances post-rent disposable income so neither partner is left financially stranded. 50/50 divides rent straight down the middle.',
      methods: [
        { name: 'Proportional to income', description: 'Each partner contributes in direct proportion to their earnings. If Partner 1 earns 60% of total household pay, they pay 60% of the rent.' },
        { name: 'Equal leftover spending cash', description: 'Calculates rent shares so both partners have the exact same dollar amount left over for personal savings, hobbies, and discretionary spending.' },
        { name: 'Traditional 50/50 split', description: 'Divides the rent equally regardless of income differences. Most common when both partners have comparable incomes.' },
      ],
    },
    example: {
      title: '$2,400 monthly rent: Partner A ($5,000/mo) and Partner B ($3,000/mo)',
      steps: [
        'Combined monthly take-home income is $5,000 + $3,000 = $8,000.',
        'Partner A earns 62.5% ($5,000 ÷ $8,000) and Partner B earns 37.5% ($3,000 ÷ $8,000).',
        'Proportional split: Partner A pays $2,400 × 62.5% = $1,500.00; Partner B pays $2,400 × 37.5% = $900.00. Both contribute exactly 30.0% of their income.',
        'Equal leftover cash split: Partner A pays $2,200.00 (leaves $2,800), Partner B pays $200.00 (leaves $2,800). Both have identical disposable cash remaining ($2,800 each).',
      ],
      takeaway: 'Choose the method that matches your shared relationship values. Put the agreed split in writing and revisit the numbers whenever salaries or expenses change significantly.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'Joint and several lease liability applies to cohabiting couples', body: 'When both partners sign a residential lease agreement, both are typically jointly and individually liable for the full rent amount. If one partner defaults or moves out, the landlord can legally demand the entire rent from the remaining tenant regardless of private internal agreements.', sourceLabel: 'Consumer Financial Protection Bureau: Renting guidance', sourceUrl: 'https://www.consumerfinance.gov/consumer-tools/housing-insecurity/' },
      { jurisdiction: 'England', title: 'Joint tenancy agreements make both partners liable', body: 'Under English tenancy law, cohabiting partners who sign an assured tenancy are joint tenants. Each tenant is individually responsible for all of the rent, not just their agreed share. Private rent-sharing agreements do not limit the landlord’s statutory rights under the tenancy contract.', sourceLabel: 'GOV.UK: Private renting tenancy agreements', sourceUrl: 'https://www.gov.uk/private-renting-tenancy-agreements' },
      { jurisdiction: 'California', title: 'Cohabitation and informal financial agreements', body: 'Under California law, informal oral promises between cohabitants to share living costs may create contractual claims in small claims court, but landlords are not bound by private arrangements. Documenting monthly financial expectations protects both individuals.', sourceLabel: 'California Courts: Self-Help Housing & Contracts', sourceUrl: 'https://selfhelp.courts.ca.gov/' },
    ],
    faqs: [
      { question: 'What is the fairest way for a couple to split rent?', answer: 'The proportional-to-income method is widely considered the fairest for couples with significant income disparity, as both partners sacrifice the exact same percentage of their earnings. For couples with similar incomes, 50/50 is standard.' },
      { question: 'How does the equal leftover cash method work?', answer: 'It calculates rent contributions so that after paying rent, both partners have the exact same dollar amount left over for personal spending, savings, or investments. The higher earner subsidizes more of the housing cost.' },
      { question: 'Should we use gross pre-tax income or net take-home pay?', answer: 'Most financial planners recommend using net take-home pay (after taxes and mandatory health deductions), because that represents the actual cash available to pay household expenses.' },
      { question: 'What happens if one partner gets a raise or loses their job?', answer: 'Couples should re-calculate their rent split whenever household income shifts by more than 10–15% to keep contributions balanced and prevent financial resentment.' },
      { question: 'Does a couple split agreement protect me if my partner moves out?', answer: 'Not against the landlord. If both partners signed the lease, both remain 100% liable for the full rent owed. However, a written agreement can help you recover damages in small claims court.' },
    ],
  },
};
