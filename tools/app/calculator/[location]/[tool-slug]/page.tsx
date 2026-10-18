import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import RentWiseApp from '@/components/RentWiseApp';
import { getCalculatorGuide } from '@/lib/seo-content';
import { absoluteSiteUrl, getLocation, getTool, LOCATIONS, SITE_URL, TOOLS } from '@/lib/site-data';

type PageProps = { params: Promise<{ location: string; 'tool-slug': string }> };

function getSearchPhrase(location: NonNullable<ReturnType<typeof getLocation>>, tool: NonNullable<ReturnType<typeof getTool>>) {
  return tool.id === 'roommates' && location.country === 'UK' ? 'flatmate rent split' : tool.name.toLowerCase();
}

export function generateStaticParams() {
  return LOCATIONS.flatMap((location) => TOOLS.map((tool) => ({ location: location.slug, 'tool-slug': tool.slug })));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const route = await params;
  const location = getLocation(route.location);
  const tool = getTool(route['tool-slug']);
  if (!location || !tool) return { title: 'Calculator not found' };

  const searchPhrase = getSearchPhrase(location, tool);
  const title = `${searchPhrase.charAt(0).toUpperCase()}${searchPhrase.slice(1)} calculator for ${location.name}`;
  const description = `Use the free ${searchPhrase} calculator for ${location.name}. See its calculation method, a worked example, and practical local-cost notes.`;
  const url = absoluteSiteUrl(`/calculator/${location.slug}/${tool.slug}/`);
  const locale = location.country === 'UK' ? 'en_GB' : 'en_US';
  const socialImage = `${SITE_URL}/apartment-dusk.jpg`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} | RentWise Tools`, description, url, locale, type: 'website', siteName: 'RentWise Tools',
      images: [{ url: socialImage, width: 736, height: 1104, alt: 'An evening city apartment, representing a new move' }],
    },
    twitter: { card: 'summary_large_image', title: `${title} | RentWise Tools`, description, images: [socialImage] },
  };
}

export default async function LocationToolPage({ params }: PageProps) {
  const route = await params;
  const location = getLocation(route.location);
  const tool = getTool(route['tool-slug']);
  if (!location || !tool) notFound();

  const guide = getCalculatorGuide(location, tool.id);
  const searchPhrase = getSearchPhrase(location, tool);
  const canonical = absoluteSiteUrl(`/calculator/${location.slug}/${tool.slug}/`);
  const pageTitle = `${location.name} ${searchPhrase} calculator`;
  const pageDescription = `Use the free ${searchPhrase} calculator for ${location.name}. See its calculation method, a worked example, and practical local-cost notes.`;
  const breadcrumbData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: `${pageTitle} | RentWise Tools`,
        description: pageDescription,
        inLanguage: location.country === 'UK' ? 'en-GB' : 'en-US',
        isPartOf: { '@id': `${SITE_URL}/#website` },
        about: { '@id': `${SITE_URL}/#application` },
        mainEntity: { '@type': 'SoftwareApplication', name: `${location.name} ${searchPhrase} calculator`, applicationCategory: 'UtilitiesApplication' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteSiteUrl('/') },
          { '@type': 'ListItem', position: 2, name: `${location.name} ${searchPhrase}`, item: canonical },
        ],
      },
    ],
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData).replace(/</g, '\\u003c') }} />
    <RentWiseApp initialCurrency={location.currency} initialTool={tool.id} location={location} />
  </>;
}
