import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { getToolGuide, toolGuides } from '../lib/content/toolGuides';
import { buildToolSchema, serializeToolSchema } from '../lib/content/toolSchema';
import { calculateTool } from '../lib/suite-calculations';

const slugs = ['prorated-rent', 'rent-affordability', 'roommate-rent-splitter', 'rent-vs-buy', 'rent-increase', 'move-in-cash', 'utility-splitter', 'moving-cost-estimator', 'commute-vs-rent', 'sublease-rate', 'cap-rate-calculator', 'rent-per-sqft', 'couple-rent-splitter', 'security-deposit-refund', 'ai-lease-scanner'];

test('all registered tools receive complete, sourced guides', () => {
  assert.deepEqual(Object.keys(toolGuides).sort(), [...slugs].sort());
  for (const slug of slugs) {
    const guide = getToolGuide(slug)!;
    assert.ok(guide.title && guide.introduction && guide.formula.equation && guide.formula.explanation);
    assert.ok(guide.formula.methods.length >= 3);
    assert.ok(guide.example.steps.length >= 3 && guide.example.takeaway);
    assert.ok(guide.legalNotes.length >= 3);
    for (const note of guide.legalNotes) {
      assert.ok(note.jurisdiction && note.title && note.body && note.sourceLabel);
      assert.match(note.sourceUrl, /^https:\/\//);
    }
    assert.ok(guide.faqs.length >= 5);
    assert.equal(new Set(guide.faqs.map(faq => faq.question)).size, guide.faqs.length);
    assert.ok(guide.faqs.every(faq => faq.question.trim() && faq.answer.trim()));
  }
  assert.equal(getToolGuide('not-a-tool'), undefined);
});

test('FAQ schema exactly mirrors visible FAQ content and uses subdirectory URLs', () => {
  for (const slug of slugs) {
    const guide = getToolGuide(slug)!;
    const url = `https://almassdm.pro/rentwise/tools/${slug}/`;
    const schema = buildToolSchema({ name: guide.title, description: guide.introduction }, url, 'https://almassdm.pro/rentwise', guide);
    const app = schema['@graph'].find(node => node['@type'] === 'SoftwareApplication')!;
    assert.equal('url' in app && app.url, url);
    const faq = schema['@graph'].find(node => node['@type'] === 'FAQPage')!;
    assert.deepEqual('mainEntity' in faq && faq.mainEntity, guide.faqs.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })));
    const plain = buildToolSchema({ name: 'Other', description: 'Other tool' }, url, 'https://almassdm.pro/rentwise');
    assert.ok(!plain['@graph'].some(node => node['@type'] === 'FAQPage'));
  }
});

test('JSON-LD serialization prevents script termination', () => {
  const schema = buildToolSchema({ name: '</script><script>alert(1)</script>', description: 'x' }, 'https://example.com/', 'https://example.com');
  const json = serializeToolSchema(schema);
  assert.ok(!json.includes('<'));
  assert.deepEqual(JSON.parse(json), schema);
});

test('guide formula conventions match real calculator behavior', () => {
  const exact = calculateTool('prorated-rent', { monthlyRent: 2100, moveIn: '2026-10-12', moveOut: '2026-10-31', method: 'exact' }, 'USD');
  assert.equal(exact.value, 1354.84);
  assert.equal(exact.rows.find(row => row.label === 'Occupied days (inclusive)')?.value, 20);
  const affordability = calculateTool('rent-affordability', { annualIncome: 72000, incomeMode: 'annual', debt: 300 }, 'USD');
  assert.equal(affordability.value, 1800);
  assert.equal(affordability.rows.find(row => row.label === '3× monthly gross income')?.value, 2000);
  assert.equal(affordability.rows.find(row => row.label === 'UK 40× annual income')?.value, 1800);
  assert.equal(affordability.rows.find(row => row.label === '30% guideline after debt')?.value, 1500);
  const split = calculateTool('roommate-rent-splitter', { totalRent: 2400, rooms: [{ name: 'A', area: 150, bath: true, view: true, parking: true }, { name: 'B', area: 100 }] }, 'USD');
  assert.equal(split.rows[0].value + split.rows[1].value, 2400);
  assert.equal(split.rows[0].value, Math.floor(240000 * (150 * 1.3) / (150 * 1.3 + 100)) / 100);
});

test('the first three approved guides remain byte-for-byte equivalent as data', () => {
  const hashes = {
    "prorated-rent": "371debf3d89bf76a084e774c221e74a97586a044fc462167751ce8daa6b5f626",
    "rent-affordability": "dea6ca7ce7584a264b6bd2336604633fce121fbac654727d5787de97af8419bd",
    "roommate-rent-splitter": "cba9a0a9bb2a9d39409dae32ef0cd92207bc03a5484c852f23f9cb65e1a29f76"
};
  for (const [slug, hash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(JSON.stringify(toolGuides[slug])).digest('hex'), hash, slug);
  }
});
