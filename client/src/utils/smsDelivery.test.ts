import { describe, expect, it } from 'vitest';
import { describeDelivery, smsCostLabel } from './smsDelivery.js';
import { toRomanUrdu } from '../i18n/translate.js';

describe('describeDelivery', () => {
  it('says which sender sent a message', () => {
    expect(describeDelivery({ status: 'SENT', sentVia: 'AGGREGATOR' })).toEqual({
      label: 'Sent', tone: 'sent', via: 'via SMS gateway',
    });
    expect(describeDelivery({ status: 'SENT', sentVia: 'PHONE' }).via).toBe('via paired phone');
  });

  it('never dresses a queued message up as sent', () => {
    const view = describeDelivery({ status: 'QUEUED' });
    expect(view).toEqual({ label: 'Queued', tone: 'waiting' });
    expect(view.via).toBeUndefined();
  });

  it('shows why a message failed', () => {
    expect(describeDelivery({ status: 'FAILED', failureReason: 'Insufficient balance' })).toEqual({
      label: 'Failed', tone: 'failed', reason: 'Insufficient balance',
    });
  });

  it('says a refused message will be tried again, and why it was refused', () => {
    expect(
      describeDelivery({ status: 'QUEUED', failureReason: 'gateway busy', nextAttemptAt: '2026-11-12T10:00:00Z' })
    ).toEqual({ label: 'Will retry', tone: 'waiting', reason: 'gateway busy' });
  });

  it('says when the gateway has passed a message to the phone', () => {
    expect(
      describeDelivery({ status: 'QUEUED', failureReason: 'gateway busy', phoneFallbackAt: '2026-11-12T10:00:00Z' }).label
    ).toBe('Waiting for paired phone');
  });

  it('does not credit a sender for a message that was not sent', () => {
    expect(describeDelivery({ status: 'FAILED', sentVia: undefined }).via).toBeUndefined();
  });
});

describe('smsCostLabel', () => {
  it('counts a plain message', () => {
    expect(smsCostLabel({ encoding: 'GSM-7', unicode: false, length: 80, segments: 1 })).toBe('1 SMS · 80 characters');
  });

  it('flags an Urdu message, which costs more per character', () => {
    expect(smsCostLabel({ encoding: 'UCS-2', unicode: true, length: 71, segments: 2 })).toBe(
      '2 SMS · 71 characters · Urdu script'
    );
  });

  it('says nothing for a message that is not an SMS', () => {
    expect(smsCostLabel(undefined)).toBeUndefined();
  });
});

describe('Roman Urdu for the delivery wording', () => {
  it('translates every status the page can show', () => {
    for (const label of ['Sent', 'Delivered', 'Failed', 'Queued', 'Will retry', 'Waiting for paired phone',
      'via SMS gateway', 'via paired phone']) {
      expect(toRomanUrdu(label), label).not.toBe(label);
    }
  });

  it('translates the SMS count with its numbers intact', () => {
    expect(toRomanUrdu('2 SMS · 71 characters · Urdu script')).toBe('2 SMS · 71 huroof · Urdu likhai');
    expect(toRomanUrdu('1 SMS · 80 characters')).toBe('1 SMS · 80 huroof');
  });
});
