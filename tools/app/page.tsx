import type { Metadata } from 'next';
import SuiteApp from '@/components/suite/SuiteApp';
import { SITE_URL } from '@/lib/site-data';
export const metadata: Metadata = {
  title: 'RentCalc Suite — 12 Free Rental & Moving Calculators',
  description: 'Make your next move with clear numbers. Free rent affordability, move-in costs, roommate splits, prorated rent, utilities, commute and rent-vs-buy calculators for US and UK renters.',
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: { title: 'RentCalc Suite by RentWise', description: '12 private, instant rental calculators. No signup. Your numbers stay in your browser.', url: `${SITE_URL}/`, type: 'website' },
};
export default function HomePage() { return <SuiteApp />; }
