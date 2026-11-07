export type CurrencyCode = 'USD' | 'GBP';

export const BASE_PATH = '/rentwise';
export const SITE_URL = 'https://almassdm.pro/rentwise';
export const SITE_DESCRIPTION = 'Fifteen free rent calculators for US and UK renters: rent affordability, move-in costs, prorated rent, roommate and couple rent splits, utility bills, deposit deadlines, rent vs buy and a lease clause checker.';
export const SOCIAL_IMAGE = `${SITE_URL}/apartment-dusk.jpg`;

export function sitePath(path: string): string {
  if (path === '/') return `${BASE_PATH}/`;
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

export function absoluteSiteUrl(path: string): string {
  return `${new URL(SITE_URL).origin}${sitePath(path)}`;
}

export type LocationInfo = {
  slug: string;
  name: string;
  country: 'US' | 'UK';
  currency: CurrencyCode;
  note: string;
};

export const LOCATIONS: LocationInfo[] = [
  { slug: 'california', name: 'California', country: 'US', currency: 'USD', note: 'California markets vary widely. Enter the rent in your own lease, then account separately for utilities, parking, or building fees that are not included.' },
  { slug: 'texas', name: 'Texas', country: 'US', currency: 'USD', note: 'Compare the stated rent with the full monthly cost. Add separately billed utilities, renters insurance, parking, or community fees to your own budget.' },
  { slug: 'new-york', name: 'New York', country: 'US', currency: 'USD', note: 'Quoted rent may not include every building or utility charge. Use the amount in your lease and compare any separate monthly fees before deciding.' },
  { slug: 'florida', name: 'Florida', country: 'US', currency: 'USD', note: 'Check which utilities, parking, and building services are included in the rent; seasonal energy use can also change a household budget.' },
  { slug: 'london', name: 'London', country: 'UK', currency: 'GBP', note: 'If a listing gives weekly rent, use weekly rent × 52 ÷ 12 as a monthly comparison estimate, then check the agreed rent and any separately billed council tax or utilities.' },
  { slug: 'manchester', name: 'Manchester', country: 'UK', currency: 'GBP', note: 'Compare weekly and monthly asking rents on the same basis (weekly × 52 ÷ 12 is a monthly comparison estimate); budget separately for council tax, utilities, and travel.' },
];

/** The old city routes, each mapped to the suite tool that now renders it. */
export const LOCATION_TOOLS = [
  { slug: 'prorated-rent', suiteSlug: 'prorated-rent', phrase: 'prorated rent' },
  { slug: 'rent-affordability', suiteSlug: 'rent-affordability', phrase: 'rent affordability' },
  { slug: 'roommate-rent-split', suiteSlug: 'roommate-rent-splitter', phrase: 'roommate rent split' },
] as const;

export function getLocation(slug: string): LocationInfo | undefined {
  return LOCATIONS.find((location) => location.slug === slug);
}

export function getLocationTool(slug: string) {
  return LOCATION_TOOLS.find((tool) => tool.slug === slug);
}
