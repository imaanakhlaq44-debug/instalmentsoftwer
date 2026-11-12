import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { SettingsPage } from './SettingsPage.js';
import { mockApi, renderPage, fill, fail } from '../test/harness.js';

/**
 * Shop settings: when late phones lock, and reset protection.
 *
 * These switches decide whether customers' phones lock by themselves, so the
 * tests check that the page shows what the server has, and saves exactly what
 * the owner chose.
 */

const SETTINGS = {
  dealer: {
    name: 'Bismillah Mobiles',
    ownerName: 'Kashif Ali',
    phone: '0300-1234567',
    city: 'Faisalabad',
    address: 'Shop 12, Rail Bazaar',
  },
  policy: {
    gracePeriodDays: 5,
    autoLockEnabled: false,
    stagedRestrictionsEnabled: false,
    locationOnRecoveryEnabled: false,
    autoUnlockEnabled: true,
    lockWarningDays: 2,
    offlineLockAfterDays: 0,
    customerReminderEnabled: true,
    emergencyCallsAllowed: true,
    frpAccountIds: ['118223344556677889900'],
  },
};

function open(routes: Record<string, unknown> = {}) {
  const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /settings': SETTINGS, ...routes } });
  renderPage(<SettingsPage />, { path: '/settings' });
  return api;
}

/** A switch is found by the title of the row it sits in. */
const toggleFor = (title: string) =>
  screen.getByText(title).closest('.rounded-2xl')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
const sliderFor = (title: string) =>
  screen.getByText(title).closest('.rounded-2xl')!.querySelector('input[type="range"]') as HTMLInputElement;

const loaded = () => screen.findByDisplayValue('Bismillah Mobiles');
const savePolicy = () => fireEvent.click(screen.getByRole('button', { name: /Save Policy Settings/ }));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('lock policy', () => {
  it('shows the shop’s saved policy, not the built-in defaults', async () => {
    open();
    await loaded();

    expect(screen.getByText('5 Days')).toBeInTheDocument();
    expect(toggleFor('Automated Remote Device Locking')).not.toBeChecked();
    expect(toggleFor('Automated Unlock on Verified Payment')).toBeChecked();
    expect(screen.getByPlaceholderText('e.g. 118223344556677889900')).toHaveValue('118223344556677889900');
  });

  it('saves exactly the switches the owner changed', async () => {
    const api = open({ 'PUT /settings/policy': { success: true } });
    await loaded();

    fireEvent.click(toggleFor('Automated Remote Device Locking'));
    fireEvent.click(screen.getByLabelText('Staged restrictions'));
    fireEvent.change(sliderFor('Grace Period Threshold'), { target: { value: '7' } });
    savePolicy();

    expect(await screen.findByText('Financing & lock enforcement policies updated!')).toBeInTheDocument();
    const sent = api.to('PUT /settings/policy')[0].body;
    expect(sent.dealerId).toBe('dealer-1');
    expect(sent.policyData).toEqual({
      ...SETTINGS.policy,
      autoLockEnabled: true,
      stagedRestrictionsEnabled: true,
      gracePeriodDays: 7,
    });
  });

  it('never lets emergency calls be switched off', async () => {
    open();
    await loaded();

    expect(toggleFor('Emergency Dialing Access (1122 / 15)')).toBeChecked();
    expect(toggleFor('Emergency Dialing Access (1122 / 15)')).toBeDisabled();
  });

  it('warns that staged restrictions do nothing while automatic locking is off', async () => {
    open();
    await loaded();

    fireEvent.click(screen.getByLabelText('Staged restrictions'));
    expect(screen.getByText('Automated locking is off, so no handset will act on this.')).toBeInTheDocument();

    fireEvent.click(toggleFor('Automated Remote Device Locking'));
    expect(screen.queryByText('Automated locking is off, so no handset will act on this.')).not.toBeInTheDocument();
  });

  it('only allows the offline rule with automatic locking on, and skips 1 and 2 days', async () => {
    const api = open({ 'PUT /settings/policy': { success: true } });
    await loaded();
    const offline = sliderFor('Restrict a Handset That Stops Reporting');

    expect(offline).toBeDisabled();
    fireEvent.click(toggleFor('Automated Remote Device Locking'));
    expect(offline).toBeEnabled();

    // The server refuses 1 and 2; the slider lands on 3 instead.
    fireEvent.change(offline, { target: { value: '2' } });
    expect(screen.getByText('3 Days')).toBeInTheDocument();
    savePolicy();

    await waitFor(() => expect(api.to('PUT /settings/policy')).toHaveLength(1));
    expect(api.to('PUT /settings/policy')[0].body.policyData.offlineLockAfterDays).toBe(3);
  });

  it('shows the server’s reason when the policy is refused', async () => {
    open({ 'PUT /settings/policy': fail(422, 'Offline lock needs automated locking to be on.') });
    await loaded();

    savePolicy();

    expect(await screen.findByText('Offline lock needs automated locking to be on.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Policy Settings/ })).toBeEnabled());
  });
});

describe('factory reset protection accounts', () => {
  it('is shown as off, with a warning, when no account is saved', async () => {
    open({ 'GET /settings': { ...SETTINGS, policy: { ...SETTINGS.policy, frpAccountIds: [] } } });
    await loaded();

    expect(screen.getByText('Factory Reset Protection is currently OFF')).toBeInTheDocument();

    fill(screen.getByPlaceholderText('e.g. 118223344556677889900'), '118223344556677889900');
    expect(screen.queryByText('Factory Reset Protection is currently OFF')).not.toBeInTheDocument();
  });

  it('points out an email address typed where the numeric ID belongs', async () => {
    open();
    await loaded();

    fill(screen.getByPlaceholderText('e.g. 118223344556677889900'), '118223344556677889900\nshop@gmail.com');

    expect(screen.getByText(/Not a Google account ID: shop@gmail\.com\./)).toBeInTheDocument();
  });

  it('saves each account once, however they were separated', async () => {
    const api = open({ 'PUT /settings/policy': { success: true } });
    await loaded();

    fill(
      screen.getByPlaceholderText('e.g. 118223344556677889900'),
      '118223344556677889900, 109876543210987654321\n118223344556677889900\n'
    );
    savePolicy();

    await waitFor(() => expect(api.to('PUT /settings/policy')).toHaveLength(1));
    expect(api.to('PUT /settings/policy')[0].body.policyData.frpAccountIds).toEqual([
      '118223344556677889900',
      '109876543210987654321',
    ]);
  });

  it('opens the step-by-step guide', async () => {
    open();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /How to get Google Account ID/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('shop profile', () => {
  it('saves the edited shop details', async () => {
    const api = open({ 'PUT /settings/profile': { success: true } });
    fill(await loaded(), 'Bismillah Mobiles & Electronics');
    fill(screen.getByDisplayValue('0300-1234567'), '0301-7654321');

    fireEvent.click(screen.getByRole('button', { name: /Update Profile/ }));

    expect(await screen.findByText('Business profile updated successfully!')).toBeInTheDocument();
    expect(api.to('PUT /settings/profile')[0].body).toEqual({
      dealerId: 'dealer-1',
      profileData: { ...SETTINGS.dealer, name: 'Bismillah Mobiles & Electronics', phone: '0301-7654321' },
    });
    // Saving the profile does not touch the lock policy.
    expect(api.to('PUT /settings/policy')).toHaveLength(0);
  });

  it('shows the reason when the profile is refused', async () => {
    open({ 'PUT /settings/profile': fail(422, 'Enter a Pakistani mobile number.') });
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /Update Profile/ }));

    expect(await screen.findByText('Enter a Pakistani mobile number.')).toBeInTheDocument();
  });

  it('says so when settings cannot be loaded', async () => {
    open({ 'GET /settings': fail(500, 'Settings are unavailable.') });

    expect(await screen.findByText('Settings are unavailable.')).toBeInTheDocument();
  });
});
