import type { Metadata } from 'next';
import './globals.css';
import './suite.css';
import { SITE_URL } from '@/lib/site-data';

const siteDescription = 'Twelve free rental, roommate and relocation calculators: affordability, move-in cash, prorated rent, utility splits, rent vs buy and more. Private US and UK planning tools.';
const socialImage = `${SITE_URL}/apartment-dusk.jpg`;

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: { default: 'Free Rent Calculators for US & UK Renters | RentWise Tools', template: '%s | RentWise Tools' },
  description: siteDescription,
  applicationName: 'RentWise Tools',
  keywords: [
    'rent calculator',
    'free rent calculator',
    'prorated rent calculator',
    'rent affordability calculator',
    'roommate rent split calculator',
    'move in cash calculator',
    'rent vs buy calculator',
    'utility bill splitter',
    'moving cost estimator',
    'rent increase checker',
    'cap rate calculator',
    'sublease rate calculator',
    'US rental calculator',
    'UK rent calculator',
    'California rent calculator',
    'Texas rent calculator',
    'New York rent calculator',
    'London rent calculator',
  ],
  authors: [{ name: 'Almas SDM — RentWise Tools', url: 'https://almassdm.pro/' }],
  creator: 'Almas SDM',
  publisher: 'Almas SDM',
  alternates: {
    canonical: `${SITE_URL}/`,
    languages: {
      'en-US': `${SITE_URL}/`,
      'en-GB': `${SITE_URL}/`,
    },
  },
  openGraph: {
    title: 'RentWise Tools — Free Rental & Relocation Calculators',
    description: siteDescription,
    siteName: 'RentWise Tools by Almas SDM',
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['en_GB'],
    url: `${SITE_URL}/`,
    images: [{ url: socialImage, width: 736, height: 1104, alt: 'An evening city apartment, representing a new move' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RentWise Tools — Free Rental & Relocation Calculators',
    description: siteDescription,
    images: [{ url: socialImage, alt: 'An evening city apartment, representing a new move' }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://almassdm.pro/#organization',
      name: 'Almas SDM',
      url: 'https://almassdm.pro/',
      logo: `${SITE_URL}/apartment-dusk.jpg`,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: 'RentWise Tools',
      description: siteDescription,
      inLanguage: ['en-US', 'en-GB'],
      publisher: { '@id': 'https://almassdm.pro/#organization' },
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#application`,
      url: `${SITE_URL}/`,
      name: 'RentWise Tools',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'A modern web browser with JavaScript enabled',
      description: siteDescription,
      isAccessibleForFree: true,
      availableLanguage: ['English'],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      provider: { '@id': 'https://almassdm.pro/#organization' },
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    {children}
  </body></html>;
}
