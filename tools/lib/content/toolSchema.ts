import type { ToolGuide } from './toolGuides';
import type { SuiteTool } from '../tool-registry';

const ORIGIN = 'https://almassdm.pro';
const FINANCE = new Set(['Budget', 'Planning', 'Investment', 'Roommates', 'Moving']);

type SchemaTool = Pick<SuiteTool, 'name' | 'h1' | 'description' | 'category' | 'answer'> & Partial<SuiteTool>;

/**
 * JSON-LD for one tool page: the page (with the short answer marked as
 * speakable), the calculator itself, where it sits, and the FAQ — built from
 * the same data the page shows, so the two never disagree.
 */
export function buildToolSchema(tool: SchemaTool, url: string, siteUrl: string, guide?: ToolGuide) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: tool.seoTitle || tool.h1,
        description: tool.metaDescription || tool.description,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', '@id': `${siteUrl}/#website`, name: 'RentWise', url: `${siteUrl}/` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: { '@id': `${url}#app` },
        speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.rw-answer p'] },
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: tool.h1,
        alternateName: tool.name,
        description: tool.description,
        abstract: tool.answer,
        url,
        applicationCategory: FINANCE.has(tool.category) ? 'FinanceApplication' : 'UtilitiesApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        ...(guide ? { featureList: guide.formula.methods.map((m) => m.name) } : {}),
        provider: { '@type': 'Organization', name: 'Almas SDM', url: `${ORIGIN}/` },
        spatialCoverage: [{ '@type': 'Country', name: 'United States' }, { '@type': 'Country', name: 'United Kingdom' }],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Almas SDM', item: `${ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'RentWise', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 3, name: tool.h1, item: url },
        ],
      },
      ...(guide ? [{
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: guide.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      }] : []),
    ],
  };
}

/** Escape HTML-significant characters before placing JSON in a script element. */
export function serializeToolSchema(schema: object) {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}
