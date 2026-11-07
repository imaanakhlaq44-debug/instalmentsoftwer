import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SuiteApp from '@/components/suite/SuiteApp';
import ToolSEOContent from '@/components/tools/ToolSEOContent';
import { SUITE_TOOLS, getSuiteTool } from '@/lib/tool-registry';
import { absoluteSiteUrl, SITE_URL, SOCIAL_IMAGE } from '@/lib/site-data';
import { getToolGuide } from '@/lib/content/toolGuides';
import { buildToolSchema, serializeToolSchema } from '@/lib/content/toolSchema';

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() { return SUITE_TOOLS.map((tool) => ({ slug: tool.slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tool = getSuiteTool(slug);
  if (!tool) return { title: 'Calculator not found' };
  const url = absoluteSiteUrl(`/tools/${slug}/`);
  return {
    title: { absolute: tool.seoTitle },
    description: tool.metaDescription,
    keywords: tool.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: tool.seoTitle,
      description: tool.metaDescription,
      url,
      type: 'website',
      siteName: 'RentWise',
      locale: 'en_US',
      alternateLocale: ['en_GB'],
      images: [{ url: SOCIAL_IMAGE, width: 736, height: 1104, alt: `${tool.h1} — RentWise` }],
    },
    twitter: { card: 'summary_large_image', title: tool.seoTitle, description: tool.metaDescription, images: [SOCIAL_IMAGE] },
  };
}

export default async function ToolPage({ params }: Props) {
  const { slug } = await params;
  const tool = getSuiteTool(slug);
  if (!tool) notFound();
  const url = absoluteSiteUrl(`/tools/${slug}/`);
  const guide = getToolGuide(slug);
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeToolSchema(buildToolSchema(tool, url, SITE_URL, guide)) }} />
    <SuiteApp slug={slug}>{guide ? <ToolSEOContent guide={guide} tool={tool} /> : null}</SuiteApp>
  </>;
}
