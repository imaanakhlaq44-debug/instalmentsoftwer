import type { MetadataRoute } from 'next';
import { absoluteSiteUrl } from '@/lib/site-data';
import { SUITE_TOOLS } from '@/lib/tool-registry';

export const dynamic = 'force-static';

/**
 * Only pages meant to be indexed. The `/calculator/{location}/…` pages are
 * `noindex` until they carry local figures of their own, and listing a noindex
 * page here would send search engines a contradiction.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['/', ...SUITE_TOOLS.map((tool) => `/tools/${tool.slug}/`)];

  const now = new Date();
  return paths.map((path) => ({
    url: absoluteSiteUrl(path),
    lastModified: now,
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1.0 : 0.9,
  }));
}
