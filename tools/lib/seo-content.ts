import type { LocationInfo, ToolId } from './site-data';

type GuideQuestion = { question: string; answer: string };
export type CalculatorGuide = {
  title: string;
  introduction: string;
  calculation: string;
  example: string;
  questions: GuideQuestion[];
};

export function getCalculatorGuide(location: LocationInfo, toolId: ToolId): CalculatorGuide {
  const currency = location.currency === 'GBP' ? '£' : '$';
  const sharedHouseholdTerm = location.country === 'UK' ? 'flatmates' : 'roommates';

  if (toolId === 'prorated') {
    return {
      title: `How the ${location.name} prorated rent calculator works`,
      introduction: `Enter the monthly rent in your agreement and the dates you will occupy the home. The estimate counts both selected dates; if you leave move-out blank, it uses the last day of the move-in month.`,
      calculation: 'Choose the day-count rule that matches your agreement: exact calendar days divides rent by each month’s actual number of days; 30-day fixed divides by 30; yearly average divides monthly rent × 12 by 365. If the dates cross months, exact calendar days applies each month’s own daily rate.',
      example: `At ${currency}1,200 monthly rent, 15 occupied days in a 30-day month cost ${currency}600 using exact calendar days (${currency}1,200 ÷ 30 × 15). Your agreement may use a different method.`,
      questions: [
        { question: 'Which proration method should I use?', answer: 'Use the method stated in your tenancy or lease agreement. If it is not stated, compare the available methods and ask the landlord or letting agent which one applies before relying on the estimate.' },
        { question: 'Does the calculator count the move-out date?', answer: 'Yes. The tool counts both move-in and move-out dates as occupied days. Your agreement may define the charge differently, so confirm the billing dates.' },
        { question: 'Does this include a deposit or bills?', answer: 'No. It estimates rent only from the monthly amount and dates you enter. Deposits, utilities, council tax, fees, and other charges are not included.' },
      ],
    };
  }

  if (toolId === 'affordability') {
    return {
      title: `How the ${location.name} rent affordability estimate works`,
      introduction: 'Enter gross income before tax, any monthly debt payments, and the rent you are considering. The result is a planning comparison—not a lender, landlord, or letting-agent decision.',
      calculation: 'For the US setting, the guideline maximum uses the lower of 30% of gross monthly income or annual income ÷ 36, then subtracts monthly debt. For the UK setting, it uses annual gross income ÷ 40, less monthly debt. A separate 25%-of-gross figure is shown as a comfortable-budget benchmark; these rules are estimates, not universal standards.',
      example: `With ${currency}60,000 gross annual income and ${currency}200 monthly debt, the UK 40× guideline is ${currency}60,000 ÷ 40 − ${currency}200 = ${currency}1,300 per month. The US calculation compares its two income checks before subtracting the same debt.`,
      questions: [
        { question: 'Should I enter take-home or gross income?', answer: 'Enter gross income before tax. If you use the hourly option, the calculator annualizes hourly pay as wage × hours per week × 52; irregular income may need a separate estimate.' },
        { question: 'Does this tell me what rent I can definitely afford?', answer: 'No. It does not account for every household cost, tax, savings goal, or screening policy. Compare the estimate with take-home pay, bills, transport, and the requirements that actually apply to you.' },
        { question: 'Are the US 30% and UK 40× rules official requirements?', answer: 'No. They are simplified planning benchmarks used by this calculator, not a legal standard or guaranteed landlord approval rule. Actual criteria vary.' },
      ],
    };
  }

  return {
    title: `How to split rent fairly with ${sharedHouseholdTerm} in ${location.name}`,
    introduction: `Enter the home's total monthly rent, then adjust each room's approximate area and features. The estimate makes the weighting visible so ${sharedHouseholdTerm} can discuss the result together.`,
    calculation: 'Each room starts with a weight based on its area. The calculator adds a 15% weight for a private bathroom and 5% for a better view, then divides the rent left after parking premiums in proportion to those weights. Parking is assigned as a fixed monthly amount; if requested premiums exceed total rent, they are scaled down proportionally.',
    example: `If one room is 150 sq ft and another is 100 sq ft, with no feature adjustments or parking, the base weights are 150:100. They receive 60% and 40% of the rent respectively; change the inputs to see your own split in ${currency}.`,
    questions: [
      { question: 'Is room size the only factor in the split?', answer: 'No. The model can weight room area, a private bathroom, a better view, and a fixed parking premium. Agree together whether these factors and the preset adjustments make sense for your household.' },
      { question: 'What happens if parking premiums exceed the rent?', answer: 'The requested parking amounts are reduced proportionally so the total allocated amount never exceeds the rent entered.' },
      { question: 'Is the result a binding agreement?', answer: 'No. It is a transparent discussion aid, not a tenancy contract or legal agreement. All occupants should agree the final amounts and terms themselves.' },
    ],
  };
}
