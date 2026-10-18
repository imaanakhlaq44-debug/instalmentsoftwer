import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTool, toolDefaults } from '../lib/suite-calculations';
import { getToolGuide } from '../lib/content/toolGuides';

test('investment guide examples reproduce the implemented model', () => {
  const buy = calculateTool('rent-vs-buy', toolDefaults['rent-vs-buy'], 'USD');
  assert.equal(buy.value, 5);
  assert.equal(buy.rows.find(r => r.label === 'Your 10-year stay — buying net cost')?.value, 182222.07);
  assert.equal(buy.rows.find(r => r.label === 'Your 10-year stay — renting net cost')?.value, 234873.37);
  const cap = calculateTool('cap-rate-calculator', toolDefaults['cap-rate-calculator'], 'USD');
  assert.equal(cap.value, 5.96);
  assert.equal(cap.rows.find(r => r.label === 'Annual net operating income (NOI)')?.value, 17880);
  assert.equal(cap.rows.find(r => r.label === 'Annual cash flow after debt service')?.value, -323.56);
  assert.equal(cap.rows.find(r => r.label === 'Cash-on-cash return')?.value, -0.5);
  assert.equal(calculateTool('rent-per-sqft', { rent: 2000, area: 1000, benchmark: 0 }, 'USD').value, 2);
  assert.equal(calculateTool('rent-per-sqft', { rent: 2000, area: 100, benchmark: 0 }, 'GBP').value, 20);
});

test('tenancy guide examples preserve notice, cash and inclusive-day conventions', () => {
  const increase = calculateTool('rent-increase', { currentRent: 1800, newRent: 1980, noticeDate: '2026-10-18', renewalDate: '2026-12-18', jurisdiction: 'England', cpi: 0 }, 'GBP');
  assert.equal(increase.value, 180);
  assert.equal(increase.rows.find(r => r.label === 'Increase percentage')?.value, 10);
  assert.equal(increase.rows.find(r => r.label === 'Notice period (days)')?.value, 61);
  const short = calculateTool('rent-increase', { currentRent: 1800, newRent: 1980, noticeDate: '2026-10-18', renewalDate: '2026-12-17', jurisdiction: 'England', cpi: 0 }, 'GBP');
  assert.equal(short.status, 'warn');
  assert.match(getToolGuide('rent-increase')!.faqs.find(f => f.question.includes('check two calendar months'))!.answer, /warns if it is earlier/);
  assert.equal(calculateTool('move-in-cash', { rent: 1800, depositMonths: 1, lastMonth: true, moving: 500, fees: 100, utilities: 150 }, 'USD').value, 6150);
  const sublease = calculateTool('sublease-rate', { rent: 1800, startDate: '2026-06-01', endDate: '2026-06-30', premium: 10, includeUtilities: true, utilities: 150 }, 'USD');
  assert.equal(sublease.value, 2100.82);
  assert.equal(sublease.rows.find(r => r.label === 'Inclusive sublease days')?.value, 30);
  assert.equal(sublease.rows.find(r => r.label === 'Monthly equivalent rate')?.value, 2130);
});

test('household guide examples reproduce allocations, moving fuel and commute trade-offs', () => {
  const utility = calculateTool('utility-splitter', { electric: 120, gas: 60, water: 30, internet: 60, billingDays: 30, people: [{ name: 'Alex', away: 0, paid: 120 }, { name: 'Blair', away: 10, paid: 100 }, { name: 'Casey', away: 5, paid: 50 }] }, 'USD');
  assert.equal(utility.value, 270);
  assert.deepEqual(utility.rows.map(r => r.value), [104, 76, 90, -16, -24, 40]);
  const move = calculateTool('moving-cost-estimator', { apartmentSize: '2', distance: 40, service: 'diy', fuelPrice: 3.5, mpg: 10, baseCost: 125, labor: 75 }, 'USD');
  assert.equal(move.value, 228);
  assert.equal(move.rows.find(r => r.label === 'Estimated fuel (round trip)')?.value, 28);
  const commute = calculateTool('commute-vs-rent', { rentA: 2100, rentB: 1900, distanceA: 10, distanceB: 18, minutesA: 25, minutesB: 40, workdays: 22, mpg: 25, gasPrice: 3.5, transitA: 0, transitB: 0, mode: 'car' }, 'USD');
  assert.equal(commute.value, -150.72);
  assert.equal(commute.rows.find(r => r.label === 'Annual hours lost: A')?.value, 220);
  assert.equal(commute.rows.find(r => r.label === 'Annual hours lost: B')?.value, 352);
  assert.equal(commute.rows.find(r => r.label === 'Break-even value per additional commute hour')?.value, 13.7);
});
