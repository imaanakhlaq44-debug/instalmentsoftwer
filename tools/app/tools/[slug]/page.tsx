import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SuiteApp from '@/components/suite/SuiteApp';
import ToolSEOContent from '@/components/tools/ToolSEOContent';
import { SUITE_TOOLS, getSuiteTool } from '@/lib/tool-registry';
import { absoluteSiteUrl, SITE_URL } from '@/lib/site-data';
import { getToolGuide } from '@/lib/content/toolGuides';
import { buildToolSchema, serializeToolSchema } from '@/lib/content/toolSchema';

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return SUITE_TOOLS.map(tool => ({ slug: tool.slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tool = getSuiteTool(slug);
  if (!tool) return { title: 'Calculator not found' };
  const isLeaseScanner = slug === 'ai-lease-scanner';
  const title = isLeaseScanner
    ? 'AI Lease Scanner & Tenancy Red Flag Checker (US & UK) — Free Legal Clause Audit'
    : `${tool.name} — Free US & UK Rent Calculator`;
  const description = isLeaseScanner
    ? 'Scan US & UK residential leases for illegal clauses, hidden fees, unannounced entry waivers, and predatory terms under California, New York, Texas, Florida, and UK law. Free, private, instant AI analysis.'
    : `${tool.description} Free, instant private calculation for US and UK leases. View formula, worked examples, and local rules. No signup required.`;
  const url = absoluteSiteUrl(`/tools/${slug}/`);
  const keywords = isLeaseScanner
    ? [
        'AI lease scanner',
        'AI lease reviewer',
        'check lease for illegal clauses',
        'predatory lease clauses',
        'landlord tenant law scanner',
        'lease red flags checker',
        'Tenant Fees Act 2019 checker',
        'California Civil Code 1950.5 lease check',
        'Texas Property Code 92 lease check',
        'free AI rental agreement review',
        'UK tenancy agreement checker',
        'can landlord charge cleaning fee',
        'unannounced landlord entry illegal',
      ]
    : [
        tool.name,
        `${tool.name} free calculator`,
        `${tool.slug} online`,
        'US rent calculation',
        'UK tenancy calculator',
        tool.category,
        'free rental tools',
      ];
  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: url,
      languages: {
        'en-US': url,
        'en-GB': url,
      },
    },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      siteName: 'RentCalc Suite by RentWise Tools',
      locale: 'en_US',
      alternateLocale: ['en_GB'],
      images: [{ url: `${SITE_URL}/apartment-dusk.jpg`, width: 736, height: 1104, alt: `${tool.name} preview` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${SITE_URL}/apartment-dusk.jpg`],
    },
  };
}
export default async function ToolPage({ params }: Props) {
  const { slug } = await params;
  const tool = getSuiteTool(slug);
  if (!tool) notFound();
  const url = absoluteSiteUrl(`/tools/${slug}/`);
  const guide = getToolGuide(slug);
  const schema = buildToolSchema(tool, url, SITE_URL, guide);
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeToolSchema(schema) }} />
    <SuiteApp slug={slug}>{guide ? <ToolSEOContent {...guide} currentSlug={slug} /> : null}</SuiteApp>
  </>;
}
