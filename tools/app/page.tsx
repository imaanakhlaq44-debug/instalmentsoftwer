import type { Metadata } from 'next';
import SuiteApp from '@/components/suite/SuiteApp';
import { SITE_DESCRIPTION, SITE_URL, SOCIAL_IMAGE, absoluteSiteUrl } from '@/lib/site-data';
import { SUITE_TOOLS } from '@/lib/tool-registry';
import { serializeToolSchema } from '@/lib/content/toolSchema';

const title = 'Free Rent Calculators for US & UK Renters | RentWise';

export const metadata: Metadata = {
  title: { absolute: title },
  description: SITE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: { title, description: SITE_DESCRIPTION, url: `${SITE_URL}/`, type: 'website', siteName: 'RentWise', locale: 'en_US', alternateLocale: ['en_GB'], images: [{ url: SOCIAL_IMAGE, width: 736, height: 1104, alt: 'An evening city apartment' }] },
  twitter: { card: 'summary_large_image', title, description: SITE_DESCRIPTION, images: [SOCIAL_IMAGE] },
};

const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: 'RentWise', description: SITE_DESCRIPTION, inLanguage: 'en', publisher: { '@type': 'Organization', name: 'Almas SDM', url: 'https://almassdm.pro/' } },
    { '@type': 'CollectionPage', '@id': `${SITE_URL}/#webpage`, url: `${SITE_URL}/`, name: title, description: SITE_DESCRIPTION, isPartOf: { '@id': `${SITE_URL}/#website` }, mainEntity: { '@id': `${SITE_URL}/#tools` } },
    {
      '@type': 'ItemList', '@id': `${SITE_URL}/#tools`, name: 'RentWise rent calculators', numberOfItems: SUITE_TOOLS.length,
      itemListElement: SUITE_TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: absoluteSiteUrl(`/tools/${t.slug}/`), name: t.h1 })),
    },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Almas SDM', item: 'https://almassdm.pro/' }, { '@type': 'ListItem', position: 2, name: 'RentWise', item: `${SITE_URL}/` }] },
  ],
};

export default function HomePage() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeToolSchema(schema) }} />
    <SuiteApp />
  </>;
}
