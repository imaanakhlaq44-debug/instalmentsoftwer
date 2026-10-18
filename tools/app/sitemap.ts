import type { MetadataRoute } from 'next';
import { absoluteSiteUrl, LOCATIONS, TOOLS } from '@/lib/site-data';
import { SUITE_TOOLS } from '@/lib/tool-registry';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    '/',
    ...SUITE_TOOLS.map((tool) => `/tools/${tool.slug}/`),
    ...LOCATIONS.flatMap((location) => TOOLS.map((tool) => `/calculator/${location.slug}/${tool.slug}/`)),
  ];

  const now = new Date();
  return paths.map((path) => ({
    url: absoluteSiteUrl(path),
    lastModified: now,
    changeFrequency: path === '/' ? 'daily' : path.startsWith('/tools/') ? 'weekly' : 'monthly',
    priority: path === '/' ? 1.0 : path.startsWith('/tools/') ? 0.9 : 0.7,
  }));
}
