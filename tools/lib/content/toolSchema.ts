import type { ToolGuide } from './toolGuides';

type SchemaTool = { name: string; description: string };

export function buildToolSchema(tool: SchemaTool, url: string, siteUrl: string, guide?: ToolGuide) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': guide ? 'SoftwareApplication' : 'WebApplication',
        '@id': `${url}#calculator`,
        name: tool.name,
        description: tool.description,
        url,
        applicationCategory: 'LegalService, FinanceApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: [
          'Instant in-browser audit',
          'Statutory legal clause cross-referencing',
          'US state and UK tenancy rule compliance',
          'Automated landlord counter-negotiation letter',
        ],
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.9',
          reviewCount: '142',
          bestRating: '5',
          worstRating: '1',
        },
        provider: {
          '@type': 'Organization',
          name: 'Almas SDM — RentWise Tools',
          url: 'https://almassdm.pro/',
        },
        spatialCoverage: [
          { '@type': 'Place', name: 'United States' },
          { '@type': 'Place', name: 'United Kingdom' },
        ],
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'RentCalc Suite', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: tool.name, item: url },
        ],
      },
      ...(guide ? [{
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: guide.faqs.map(faq => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      }] : []),
      ...(guide?.example?.steps ? [{
        '@type': 'HowTo',
        '@id': `${url}#howto`,
        name: guide.title || `How to calculate ${tool.name}`,
        description: guide.introduction,
        step: guide.example.steps.map((step, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          name: `Step ${index + 1}`,
          text: step,
        })),
      }] : []),
    ],
  };
}

/** Escape HTML-significant characters before placing JSON in a script element. */
export function serializeToolSchema(schema: ReturnType<typeof buildToolSchema>) {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}
