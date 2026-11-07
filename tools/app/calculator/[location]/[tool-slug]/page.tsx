import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SuiteApp from '@/components/suite/SuiteApp';
import ToolSEOContent from '@/components/tools/ToolSEOContent';
import { getToolGuide } from '@/lib/content/toolGuides';
import { getSuiteTool } from '@/lib/tool-registry';
import { absoluteSiteUrl, getLocation, getLocationTool, LOCATIONS, LOCATION_TOOLS, SOCIAL_IMAGE } from '@/lib/site-data';

type PageProps = { params: Promise<{ location: string; 'tool-slug': string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCATIONS.flatMap((location) => LOCATION_TOOLS.map((tool) => ({ location: location.slug, 'tool-slug': tool.slug })));
}

function resolve(route: { location: string; 'tool-slug': string }) {
  const location = getLocation(route.location);
  const entry = getLocationTool(route['tool-slug']);
  const tool = entry && getSuiteTool(entry.suiteSlug);
  if (!location || !entry || !tool) return null;
  const phrase = entry.slug === 'roommate-rent-split' && location.country === 'UK' ? 'flatmate rent split' : entry.phrase;
  return { location, entry, tool, phrase };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = resolve(await params);
  if (!found) return { title: 'Calculator not found' };
  const { location, tool, phrase } = found;
  const title = `${location.name} ${phrase} calculator`;
  const description = `Free ${phrase} calculator for renters in ${location.name}. ${tool.description}`;
  return {
    title,
    description,
    // These city pages share the main tool's content. The canonical points at
    // the main tool page so search engines index that one, and they stay out of
    // the index until each carries genuinely local figures.
    alternates: { canonical: absoluteSiteUrl(`/tools/${tool.slug}/`) },
    robots: { index: false, follow: true },
    openGraph: { title, description, url: absoluteSiteUrl(`/calculator/${location.slug}/${found.entry.slug}/`), locale: location.country === 'UK' ? 'en_GB' : 'en_US', type: 'website', siteName: 'RentWise', images: [{ url: SOCIAL_IMAGE, width: 736, height: 1104, alt: 'An evening city apartment' }] },
  };
}

export default async function LocationToolPage({ params }: PageProps) {
  const found = resolve(await params);
  if (!found) notFound();
  const { location, tool, phrase } = found;
  const guide = getToolGuide(tool.slug);
  const note = <div className="rw-place"><span className="rw-tag">{location.country}</span><div><b>{location.name} renter note</b><p>{location.note}</p></div></div>;
  return <SuiteApp slug={tool.slug} heading={`${location.name} ${phrase} calculator`} intro={tool.description} note={note} initialCurrency={location.currency}>
    {guide ? <ToolSEOContent guide={guide} tool={tool} /> : null}
  </SuiteApp>;
}
