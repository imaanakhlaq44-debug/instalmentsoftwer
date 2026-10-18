import type { ToolGuide } from './toolGuides';

export const investmentGuides: Record<string, ToolGuide> = {
  'rent-vs-buy': {
    title: 'How to compare renting with buying a home',
    introduction: 'Compare modeled net costs over a planned stay by entering rent, purchase price, down payment, mortgage rate and term, investment return, home-price growth, rent growth, property tax, insurance, maintenance, purchase and sale costs, and years in the home. The result is a scenario, not personalized financial advice or a forecast. Important limitation: the renting side subtracts only the modeled investment gain on the down payment; it does not invest monthly cash-flow differences or buying costs. Costs are nominal (not inflation-adjusted), and the reported breakeven is stable only across the calculator’s annual checkpoints through its model horizon.',
    formula: {
      equation: 'Loan = price × (1 − down-payment %); monthly P&I = L × r ÷ [1 − (1 + r)^−n], where r = annual interest rate ÷ 1,200 and n = loan years × 12. For each month: rent cost += rent × (1 + rent growth % ÷ 100)^(month offset ÷ 12); buy cost += actual mortgage payment + home value × (property-tax rate + maintenance rate) ÷ 1,200 + monthly insurance. Year-end rent net cost = cumulative rent − down payment × [(1 + investment return % ÷ 100)^(years) − 1]. Year-end buy net cost = initial down payment + purchase costs + cumulative ownership payments − (home value − remaining loan balance − sale costs).',
      explanation: 'Rent and home value grow using annual percentage assumptions compounded monthly (the first month starts at entered rent). At zero interest, monthly P&I is loan principal divided by the number of monthly payments. Otherwise the mortgage is amortized monthly; the payment is capped at remaining balance plus interest near payoff. Property tax and maintenance are each calculated as a percentage of that month’s modeled home value; insurance stays at the entered annual amount divided by 12. Selling costs apply to modeled home value. Breakeven is the first annual checkpoint at which buying is no more expensive than renting and remains so through the horizon, which is at least 10 years even if the entered stay is shorter. It is not an estimate of when buying becomes universally preferable.',
      methods: [
        { name: 'Set a realistic time horizon and assumptions', description: 'Use the expected years in the home and test alternative stay lengths, rates, rent changes and home-price growth. A small assumption change can move the breakeven materially.' },
        { name: 'Compare net cost, not mortgage payment with rent', description: 'Ownership cost includes principal and interest payments, property tax, insurance, maintenance, purchase costs and selling costs, offset by estimated equity at sale. Rent is accumulated rent less only the down-payment investment gain.' },
        { name: 'Stress-test omitted and uncertain costs', description: 'Try lower home growth, higher upkeep or sale costs, and different investment returns. Add local charges to assumptions where possible; the tool does not model income-tax relief, present-value discounting, repairs, or investing monthly cash-flow differences.' },
      ],
    },
    example: {
      title: '$2,000 rent versus a $350,000 home, modeled for 10 years',
      steps: [
        'Inputs: 20% down ($70,000), 6.5% mortgage interest for 30 years, 5% investment return, 3% home growth and rent growth, 1.1% property tax, $1,200 annual insurance, 1% maintenance, 2% purchase costs and 6% sale costs; USD.',
        'Loan principal is $350,000 × 80% = $280,000. Monthly principal-and-interest payment from the amortization formula is $1,769.79.',
        'Year 3 modeled net costs: renting $64,162.40; buying $77,859.17, so renting is lower at that checkpoint.',
        'Year 5 modeled net costs: renting $109,822.21; buying $109,550.39. Buying first becomes less costly at year 5 and remains so at each later annual checkpoint through year 10.',
        'At year 10 the calculator reports renting $234,873.37 and buying $182,222.07; modeled buy breakeven is year 5. These nominal scenario outputs are not guaranteed results.'
      ],
      takeaway: 'The comparison’s result depends on assumptions and its asymmetric investment treatment: only the down-payment gain is credited to renting. It does not invest monthly savings or buying costs, so inspect the rows and notes rather than treating a single breakeven year as advice.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'Buying and selling involve significant costs', body: 'The CFPB notes that buying and selling can involve fees, taxes and commissions and that repairs, maintenance, property taxes and insurance are homeowner costs. Those costs can make a short holding period especially sensitive; this calculator includes only the categories and estimates entered and omits several possible expenses.', sourceLabel: 'CFPB: Financial considerations of buying a home', sourceUrl: 'https://www.consumerfinance.gov/ask-cfpb/what-are-some-of-the-financial-considerations-of-buying-a-home-en-119/' },
      { jurisdiction: 'England and Wales', title: 'Budget beyond the deposit and mortgage', body: 'The government home-buying guide lists possible additional costs including stamp duty or Welsh Land Transaction Tax, surveys, conveyancing, searches, insurance, moving, repairs, and (for leaseholds) service charges and ground rent. These are not all modeled as separate line items here; seek current local advice and add reasonable estimates where possible.', sourceLabel: 'GOV.UK: How to buy a home', sourceUrl: 'https://www.gov.uk/government/publications/how-to-buy-a-home/how-to-buy' },
      { jurisdiction: 'United States (tax)', title: 'Do not assume a tax benefit', body: 'Tax treatment depends on the taxpayer and circumstances. This comparison does not model mortgage-interest deductions or other tax effects; consult current IRS guidance or a qualified tax professional rather than assuming a tax advantage.', sourceLabel: 'CFPB: Financial considerations of buying a home', sourceUrl: 'https://www.consumerfinance.gov/ask-cfpb/what-are-some-of-the-financial-considerations-of-buying-a-home-en-119/' },
    ],
    faqs: [
      { question: 'Does the result tell me whether I should rent or buy?', answer: 'No. It compares specified financial assumptions only and does not assess your needs, risk tolerance, financing eligibility, location, or complete budget.' },
      { question: 'What does the breakeven year mean?', answer: 'It is the first annual checkpoint where modeled buying net cost is no greater than renting net cost and remains so through the model horizon. The horizon is at least 10 years. It is not a guaranteed future outcome.' },
      { question: 'Does the renting calculation invest monthly savings?', answer: 'No. It subtracts only the assumed investment gain on the initial down payment. It does not invest monthly cash-flow differences or purchase costs; this limitation can affect the comparison.' },
      { question: 'Are costs adjusted for inflation?', answer: 'No. Results are nominal. Rent and home value grow at the annual rates you enter, while other dollar-cost inputs are not inflation-adjusted; this is not a present-value analysis.' },
      { question: 'What is included in ownership cost?', answer: 'The model includes mortgage principal and interest, entered property tax and insurance, price-based maintenance, purchase costs, sale costs, and an equity offset at sale. It does not predict specific repairs or include costs that you have not entered.' },
      { question: 'Does this include tax relief or deductions?', answer: 'No. Tax relief is not modeled. Tax eligibility and treatment depend on jurisdiction and individual circumstances, so obtain current professional tax advice.' },
      { question: 'Why can a short stay make buying look costly?', answer: 'Purchase and sale costs are incurred around a transaction, while modeled equity accumulates over time. A short holding period may not offset those costs, and actual market movements can differ from assumptions.' },
    ],
  },
  'cap-rate-calculator': {
    title: 'How to calculate a rental property cap rate',
    introduction: 'Estimate the capitalization rate for a rental property from its purchase price, monthly rent, vacancy assumption, annual property taxes, insurance, maintenance percentage and other expenses. The cap rate is a property-level operating yield before financing; it is not total return, a promise of profit, or a substitute for local due diligence. The calculator separately displays leveraged cash flow and cash-on-cash return, which are not the cap rate.',
    formula: {
      equation: 'Annual gross rent = monthly rent × 12. NOI = annual gross rent × (1 − vacancy %) − annual taxes − annual insurance − purchase price × maintenance % − other annual expenses. Cap rate (%) = NOI ÷ purchase price × 100. Annual cash flow after debt service = NOI − annual principal-and-interest payments. Cash-on-cash (%) = annual cash flow ÷ (down payment + closing costs) × 100.',
      explanation: 'Vacancy is applied as a percentage reduction to gross rent. Maintenance is estimated as a percentage of purchase price, not rent or actual repair invoices. The cap rate excludes loan payments and acquisition closing costs from its numerator/denominator. The separate cash flow uses the mortgage payment; cash-on-cash uses entered down payment plus closing costs as cash invested. Expenses not entered, including management and utilities, are not inferred.',
      methods: [
        { name: 'Estimate effective income', description: 'Annualize monthly rent and deduct the vacancy percentage. Use a vacancy assumption based on the specific property and market rather than assuming continuous occupancy.' },
        { name: 'Estimate operating expenses and NOI', description: 'Subtract annual taxes, insurance, purchase-price-based maintenance and other entered annual expenses from vacancy-adjusted rent. NOI is before mortgage debt service.' },
        { name: 'Calculate cap rate, then review leverage separately', description: 'Divide NOI by property price and multiply by 100. Review the separate annual cash flow and cash-on-cash rows for the entered loan and initial cash; neither converts cap rate into total ROI.' },
      ],
    },
    example: {
      title: '$300,000 property renting for $2,200 per month',
      steps: [
        'Inputs: $3,000 annual taxes, $1,200 annual insurance, maintenance at 1% of $300,000 ($3,000), 5% vacancy, no other expenses, 20% down, 6.5% interest over 30 years and $5,000 closing costs.',
        'Annual gross rent = $2,200 × 12 = $26,400; after 5% vacancy, effective rent is $26,400 × 0.95 = $25,080.',
        'NOI = $25,080 − $3,000 − $1,200 − $3,000 = $17,880.',
        'Cap rate = $17,880 ÷ $300,000 × 100 = 5.96%. It excludes financing.',
        'For context only, calculator mortgage P&I is $1,516.96 monthly ($18,203.56 annually); cash flow after debt is −$323.56/year. Cash invested is $60,000 + $5,000 = $65,000, so cash-on-cash is −0.50%. This is not the 5.96% cap rate.'
      ],
      takeaway: 'A positive cap rate can coexist with negative cash flow after mortgage payments. This is an operating-yield estimate before debt, not total ROI or a guarantee; verify omitted expenses, property condition, income and financing.',
    },
    legalNotes: [
      { jurisdiction: 'United States (federal tax)', title: 'Tax reporting is not the same as NOI', body: 'IRS rental-property guidance discusses reporting rental income, expenses and depreciation, including common expenses such as maintenance, insurance, taxes and interest. This calculator’s NOI is a simplified operating estimate and does not calculate taxable income, depreciation, deductibility, or tax liability.', sourceLabel: 'IRS Publication 527: Residential Rental Property', sourceUrl: 'https://www.irs.gov/publications/p527' },
      { jurisdiction: 'United States (general)', title: 'Check local and property-specific obligations', body: 'The tool relies on entered expenses and does not identify local taxes, licensing, utilities, association charges, insurance requirements or rental regulations. Confirm applicable city, county and state requirements and obtain current quotes before relying on an estimate.', sourceLabel: 'IRS Publication 527: Residential Rental Property', sourceUrl: 'https://www.irs.gov/publications/p527' },
      { jurisdiction: 'England and Wales', title: 'Allow for costs beyond purchase price', body: 'The government home-buying guide identifies potential transaction and ownership costs such as property transaction taxes, surveys, conveyancing, insurance, repairs, and leasehold service charges or ground rent. Add relevant operating items to the other-expenses input where appropriate; the calculator does not determine tax or legal obligations.', sourceLabel: 'GOV.UK: How to buy a home', sourceUrl: 'https://www.gov.uk/government/publications/how-to-buy-a-home/how-to-buy' },
    ],
    faqs: [
      { question: 'What is a cap rate?', answer: 'It is modeled annual net operating income divided by purchase price, expressed as a percentage. It measures an unleveraged operating yield under the inputs, not a promised return.' },
      { question: 'Does cap rate include mortgage payments?', answer: 'No. Cap rate is calculated before financing. Mortgage principal and interest affect the separate annual cash-flow and cash-on-cash rows.' },
      { question: 'Is cap rate the same as total ROI?', answer: 'No. It does not include financing, purchase closing costs, appreciation, sale proceeds, tax effects or every possible cost. Do not treat it as total return.' },
      { question: 'How is maintenance estimated?', answer: 'The tool multiplies purchase price by the entered annual maintenance percentage. This is a planning assumption, not an estimate based on inspection or actual repair history.' },
      { question: 'What does the vacancy input do?', answer: 'It reduces annual gross rent by the entered percentage before taxes, insurance, maintenance and other expenses are deducted.' },
      { question: 'Why can cap rate be positive but cash flow negative?', answer: 'NOI can be positive while annual mortgage principal-and-interest payments exceed NOI. Cap rate excludes the loan; cash flow after debt does not.' },
      { question: 'Are taxes, utilities and management fully included?', answer: 'Only taxes, insurance, maintenance and other expenses you enter are included. The note specifically warns that management, utilities and unentered taxes are excluded; review all property-level costs.' },
    ],
  },
  'rent-per-sqft': {
    title: 'How to calculate rent per square foot or square metre',
    introduction: 'Divide the entered monthly rent by the entered floor area to compare a rent-per-area rate. In USD mode the calculator labels the unit as square feet; in GBP mode it labels it as square metres. The area toggle only changes the displayed unit label—it does not convert an entered area or convert currencies. Enter rent and area in matching units and compare only like-for-like measurements. Any benchmark is user-provided, not an assumed market standard.',
    formula: {
      equation: 'Monthly rent per area unit = monthly rent ÷ entered area. Annual rent per area unit = (monthly rent ÷ entered area) × 12. If benchmark > 0, difference = monthly rent per area unit − entered benchmark.',
      explanation: 'The value is a simple ratio using the supplied numbers. The currency setting changes whether the output label says per sq ft (USD) or per sq m (GBP); no square-foot/square-metre conversion, currency exchange, or benchmark validation occurs. Comparison is meaningful only when both properties use the same currency, time period, and consistently defined area.',
      methods: [
        { name: 'Use consistent rent period and area', description: 'Enter monthly rent and the corresponding area. Do not divide annual rent by area and compare it with a monthly benchmark.' },
        { name: 'Match the displayed unit yourself', description: 'USD labels the area denominator as sq ft; GBP labels it as sq m. The calculator does not transform the entered area, so measure or convert the source area before entry if needed.' },
        { name: 'Compare like with like', description: 'Use properties with comparable area definitions, included spaces, furnishing, lease terms and location. A user-entered benchmark is a reference, not a market valuation.' },
      ],
    },
    example: {
      title: '$2,000 monthly rent over 1,000 square feet (USD mode)',
      steps: [
        'Enter monthly rent $2,000, area 1,000 and benchmark 0; choose USD.',
        'Monthly rate = $2,000 ÷ 1,000 sq ft = $2.00 per sq ft.',
        'Annual rate = $2.00 × 12 = $24.00 per sq ft per year.',
        'A separate GBP-mode check with rent £2,000 and area 100 produces £20.00 per sq m monthly and £240.00 per sq m annually. It does not convert area or currency.'
      ],
      takeaway: 'The calculator returns a ratio, not a rent recommendation. Keep currency, time period and area definition consistent; switching USD/GBP changes the label only and performs no conversion.',
    },
    legalNotes: [
      { jurisdiction: 'United States (general)', title: 'Confirm the area measurement and listing basis', body: 'This ratio depends directly on the supplied area and does not verify a listing’s measurement, what spaces are included, or any disclosure requirements. Confirm the measurement basis with the landlord, agent or relevant local authority before comparing or relying on it.', sourceLabel: 'HUD: Minimum Property Standards', sourceUrl: 'https://www.hud.gov/hud-partners/minimum-property-standards' },
      { jurisdiction: 'United Kingdom (ONS statistics)', title: 'Official rent comparisons control for property differences', body: 'ONS private-rent methodology uses property attributes including floor area and applies mix adjustment and other statistical methods. A raw rent-per-area quotient is not equivalent to an official rent index or a like-for-like valuation; use it only as a basic comparison after checking property comparability.', sourceLabel: 'ONS: Private rents and owner-occupier housing aggregates methodology', sourceUrl: 'https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/privaterentsandowneroccupierhousingaggregatesinconsumerprices' },
      { jurisdiction: 'England and Wales', title: 'Use care when comparing rooms and whole dwellings', body: 'ONS methodology notes that rents for a single room in a house in multiple occupation are excluded from its relevant rent-index dataset. This illustrates why a room rate and whole-property rate may not be comparable; this calculator makes no legal classification or valuation.', sourceLabel: 'ONS: Private rents and owner-occupier housing aggregates methodology', sourceUrl: 'https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/privaterentsandowneroccupierhousingaggregatesinconsumerprices' },
    ],
    faqs: [
      { question: 'What is rent per square foot or square metre?', answer: 'It is rent divided by floor area. This tool shows a monthly rate and its annualized equivalent, using the displayed area-unit label selected by currency mode.' },
      { question: 'Does selecting GBP convert square feet to square metres?', answer: 'No. GBP mode changes the label from sq ft to sq m only. Convert the area yourself before entry if necessary; otherwise the result is a quotient with a potentially incorrect label.' },
      { question: 'Does GBP mode convert dollars to pounds?', answer: 'No. The calculator performs no currency exchange. Enter rent in the intended currency and compare only with a benchmark in that same currency.' },
      { question: 'How do I calculate the annual rate?', answer: 'The tool multiplies the monthly rent-per-area figure by 12. It assumes the entered monthly rent is representative for 12 months and does not account for rent-free periods or changes.' },
      { question: 'What does the benchmark do?', answer: 'When a positive benchmark is entered, the tool displays it and the difference between the calculated monthly rate and benchmark. The benchmark is user supplied; the tool does not establish a market norm.' },
      { question: 'Can I compare different properties directly?', answer: 'Only cautiously. Ensure rent period, currency and area units match, and check what the measured area includes. Location, condition, amenities, lease terms and property type also affect rent.' },
      { question: 'Does the tool confirm advertised floor area?', answer: 'No. It accepts an area number without checking its source or definition. Verify measurements and included spaces with a reliable listing document or relevant local professional.' },
    ],
  },
};
