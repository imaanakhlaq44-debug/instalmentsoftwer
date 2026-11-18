import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CnicScanButton, parseScanReply, isExpired, type CnicScan } from './CnicScanButton.js';

const card: CnicScan = {
  cnic: '35202-1234567-1',
  name: 'Muhammad Aslam',
  fatherName: 'Muhammad Akram',
  dateOfBirth: '1990-01-01',
  dateOfExpiry: '2030-03-15',
  lifetime: false,
};

/** Stands in for the object the shop app puts on the page. */
function installBridge() {
  const bridge = { postMessage: vi.fn(), onmessage: null as ((e: { data: unknown }) => void) | null };
  (globalThis as { AlmasCnic?: unknown }).AlmasCnic = bridge;
  return bridge;
}

afterEach(() => {
  delete (globalThis as { AlmasCnic?: unknown }).AlmasCnic;
});

describe('parseScanReply', () => {
  it('reads what the shop app sends', () => {
    expect(parseScanReply(JSON.stringify({ ok: true, ...card }))).toEqual({ ok: true, card });
  });

  it('drops a CNIC that is not in the card shape', () => {
    const reply = parseScanReply({ ok: true, cnic: '3520212345671', name: 'Ali' });
    expect(reply.ok && reply.card.cnic).toBeNull();
  });

  it('treats a broken or unknown answer as an unreadable card', () => {
    expect(parseScanReply('not json')).toEqual({ ok: false, reason: 'unreadable' });
    expect(parseScanReply({ ok: false, reason: 'something new' })).toEqual({ ok: false, reason: 'unreadable' });
    expect(parseScanReply({ ok: false, reason: 'cancelled' })).toEqual({ ok: false, reason: 'cancelled' });
  });
});

describe('isExpired', () => {
  const today = new Date(2026, 10, 18);
  it('compares the expiry with today', () => {
    expect(isExpired({ ...card, dateOfExpiry: '2026-11-17' }, today)).toBe(true);
    expect(isExpired({ ...card, dateOfExpiry: '2026-11-18' }, today)).toBe(false);
  });
  it('never calls a lifetime card, or one with no expiry read, expired', () => {
    expect(isExpired({ ...card, dateOfExpiry: null }, today)).toBe(false);
    expect(isExpired({ ...card, lifetime: true, dateOfExpiry: '2000-01-01' }, today)).toBe(false);
  });
});

describe('CnicScanButton', () => {
  it('is not shown in an ordinary browser', () => {
    render(<CnicScanButton onScan={() => {}} />);
    expect(screen.queryByText('Scan CNIC card')).toBeNull();
  });

  it('asks the shop app for a scan and hands back the card', () => {
    const bridge = installBridge();
    const onScan = vi.fn();
    render(<CnicScanButton onScan={onScan} />);
    fireEvent.click(screen.getByText('Scan CNIC card'));
    expect(bridge.postMessage).toHaveBeenCalledWith('scan');
    expect(screen.getByText('Reading the card…')).toBeTruthy();

    act(() => bridge.onmessage?.({ data: JSON.stringify({ ok: true, ...card }) }));
    expect(onScan).toHaveBeenCalledWith(card);
    expect(screen.getByText('Filled from the card. Check them before saving.')).toBeTruthy();
    expect(screen.getByText('Muhammad Akram')).toBeTruthy();
  });

  it('warns about an expired card', () => {
    const bridge = installBridge();
    render(<CnicScanButton onScan={() => {}} />);
    fireEvent.click(screen.getByText('Scan CNIC card'));
    act(() => bridge.onmessage?.({ data: { ok: true, ...card, dateOfExpiry: '2020-03-15' } }));
    expect(screen.getByText('This CNIC has expired. Expiry on the card:')).toBeTruthy();
    expect(screen.getByText('15.03.2020')).toBeTruthy();
  });

  it('says how to retake an unreadable photo, and stays quiet when the camera is closed', () => {
    const bridge = installBridge();
    const onScan = vi.fn();
    render(<CnicScanButton onScan={onScan} />);
    fireEvent.click(screen.getByText('Scan CNIC card'));
    act(() => bridge.onmessage?.({ data: '{"ok":false,"reason":"unreadable"}' }));
    expect(screen.getByText(/Could not read the card/)).toBeTruthy();

    fireEvent.click(screen.getByText('Scan CNIC card'));
    act(() => bridge.onmessage?.({ data: '{"ok":false,"reason":"cancelled"}' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(onScan).not.toHaveBeenCalled();
  });
});
