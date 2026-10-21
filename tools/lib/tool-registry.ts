export type SuiteTool = { slug: string; name: string; description: string; category: string; icon: string; priority: number };

export const SUITE_TOOLS: SuiteTool[] = [
  { slug: 'ai-lease-scanner', name: 'AI Lease & Tenancy Scanner', description: 'Scan lease agreements for predatory clauses, illegal fees, and statutory tenant rights violations in the US & UK.', category: 'Lease', icon: 'Sparkles', priority: 1 },
  { slug: 'rent-affordability', name: 'Rent affordability', description: 'Find a comfortable rent range from your income and monthly debt.', category: 'Budget', icon: 'WalletCards', priority: 2 },
  { slug: 'move-in-cash', name: 'Move-in cash', description: 'Plan the cash you will need before collecting the keys.', category: 'Budget', icon: 'KeyRound', priority: 3 },
  { slug: 'roommate-rent-splitter', name: 'Roommate rent split', description: 'Share rent in a way that accounts for room size and amenities.', category: 'Roommates', icon: 'UsersRound', priority: 4 },
  { slug: 'prorated-rent', name: 'Prorated rent', description: 'Calculate rent for a partial month at move-in or move-out.', category: 'Budget', icon: 'CalendarDays', priority: 5 },
  { slug: 'utility-splitter', name: 'Utility splitter', description: 'Split shared bills fairly, including time away from home.', category: 'Roommates', icon: 'ReceiptText', priority: 6 },
  { slug: 'rent-increase', name: 'Rent increase checker', description: 'See the size of a proposed increase and review notice dates.', category: 'Lease', icon: 'TrendingUp', priority: 7 },
  { slug: 'rent-vs-buy', name: 'Rent vs. buy', description: 'Compare renting with the long-term costs of buying a home.', category: 'Planning', icon: 'House', priority: 8 },
  { slug: 'moving-cost-estimator', name: 'Moving cost estimator', description: 'Estimate vehicle, fuel and labor costs for your move.', category: 'Moving', icon: 'Truck', priority: 9 },
  { slug: 'commute-vs-rent', name: 'Commute vs. rent', description: 'Compare rent savings with added transport cost and time.', category: 'Planning', icon: 'Route', priority: 10 },
  { slug: 'sublease-rate', name: 'Sublease rate', description: 'Estimate a daily and monthly rate for a mid-lease sublet.', category: 'Lease', icon: 'CalendarRange', priority: 11 },
  { slug: 'cap-rate-calculator', name: 'Rental property ROI', description: 'Estimate operating income, cap rate and financing costs.', category: 'Investment', icon: 'ChartNoAxesCombined', priority: 12 },
  { slug: 'rent-per-sqft', name: 'Rent per area', description: 'Understand your monthly rent relative to floor area.', category: 'Planning', icon: 'Ruler', priority: 13 },
  { slug: 'couple-rent-splitter', name: 'Couple rent splitter', description: 'Split rent fairly as a couple: proportional to income, 50/50, or equal disposable cash.', category: 'Roommates', icon: 'UsersRound', priority: 14 },
  { slug: 'security-deposit-refund', name: 'Security deposit refund', description: 'Check state return deadlines, statutory bad-faith penalties, and deduction limits.', category: 'Lease', icon: 'KeyRound', priority: 15 },
];

export const getSuiteTool = (slug?: string) => SUITE_TOOLS.find((tool) => tool.slug === slug);
