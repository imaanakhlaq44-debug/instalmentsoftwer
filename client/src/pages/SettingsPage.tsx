import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { GoogleIdGuideModal } from '../components/modals/GoogleIdGuideModal.js';
import {
  Settings,
  Building2,
  ShieldAlert,
  Save,
  Users,
  Bell,
  Lock,
  Unlock,
  CheckCircle2,
  Key,
  HelpCircle,
} from 'lucide-react';

/** Splits the FRP textarea into distinct account ids (whitespace or comma separated). */
function parseFrpAccountIds(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

export const SettingsPage: React.FC = () => {
  const { selectedDealerId, showToast, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showGoogleIdGuide, setShowGoogleIdGuide] = useState(false);

  // Profile Form
  const [dealerProfile, setDealerProfile] = useState({
    name: 'Al-Madina Mobile Hub',
    ownerName: 'Tariq Mehmood',
    phone: '0300-8451299',
    city: 'Lahore',
    address: 'Shop 42, Ground Floor, Hafeez Centre, Gulberg III, Lahore',
  });

  // Financing & Enforcement Policy Form
  const [policy, setPolicy] = useState({
    gracePeriodDays: 3,
    autoLockEnabled: false,
    stagedRestrictionsEnabled: false,
    locationOnRecoveryEnabled: false,
    autoUnlockEnabled: true,
    lockWarningDays: 2,
    offlineLockAfterDays: 0,
    customerReminderEnabled: true,
    emergencyCallsAllowed: true,
  });

  // Factory Reset Protection accounts, one Google account id per line.
  const [frpAccountsText, setFrpAccountsText] = useState('');
  const frpInvalid = frpAccountsText
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((id) => !/^\d{6,30}$/.test(id));

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getSettings(selectedDealerId);
      if (data.dealer) {
        setDealerProfile({
          name: data.dealer.name,
          ownerName: data.dealer.ownerName,
          phone: data.dealer.phone,
          city: data.dealer.city,
          address: data.dealer.address,
        });
      }
      if (data.policy) {
        setPolicy({
          gracePeriodDays: data.policy.gracePeriodDays,
          autoLockEnabled: data.policy.autoLockEnabled,
          stagedRestrictionsEnabled: data.policy.stagedRestrictionsEnabled ?? false,
          locationOnRecoveryEnabled: data.policy.locationOnRecoveryEnabled ?? false,
          autoUnlockEnabled: data.policy.autoUnlockEnabled,
          lockWarningDays: data.policy.lockWarningDays,
          offlineLockAfterDays: data.policy.offlineLockAfterDays ?? 0,
          customerReminderEnabled: data.policy.customerReminderEnabled,
          emergencyCallsAllowed: data.policy.emergencyCallsAllowed,
        });
        setFrpAccountsText((data.policy.frpAccountIds ?? []).join('\n'));
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [selectedDealerId]);

  const handleSavePolicy = async () => {
    try {
      setSaving(true);
      await ApiService.updatePolicy({
        dealerId: selectedDealerId,
        policyData: { ...policy, frpAccountIds: parseFrpAccountIds(frpAccountsText) },
      });
      showToast('Financing & lock enforcement policies updated!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      await ApiService.updateProfile({
        dealerId: selectedDealerId,
        profileData: dealerProfile,
      });
      showToast('Business profile updated successfully!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <p className="eyebrow">Settings</p>
        <h1 className="mt-1 text-display text-ink-900">Shop settings</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-500">Your shop details, when late phones get locked, and reset protection.</p>
      </div>

      {/* Policy Settings Card */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border-2 border-ink-900 shadow-card space-y-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Device Lock & Installment Enforcement Policy</h2>
            <p className="text-xs text-slate-500">Configure parameters governing automated and manual lock actions.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          {/* Grace Period Slider */}
          <div className="p-4 bg-slate-50 border rounded-2xl space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-800">Grace Period Threshold</span>
              <span className="font-extrabold text-blue-600 text-sm">{policy.gracePeriodDays} Days</span>
            </div>
            <p className="text-xs text-slate-500">
              Days past installment due date before device becomes eligible for restriction.
            </p>
            <input
              type="range"
              min="0"
              max="15"
              value={policy.gracePeriodDays}
              onChange={(e) => setPolicy({ ...policy, gracePeriodDays: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mt-2"
            />
          </div>

          {/* Warning Days */}
          <div className="p-4 bg-slate-50 border rounded-2xl space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-800">Pre-Due Warning Notice</span>
              <span className="font-extrabold text-blue-600 text-sm">{policy.lockWarningDays} Days Prior</span>
            </div>
            <p className="text-xs text-slate-500">
              Dispatch upcoming installment reminder SMS prior to the payment due date.
            </p>
            <input
              type="range"
              min="1"
              max="7"
              value={policy.lockWarningDays}
              onChange={(e) => setPolicy({ ...policy, lockWarningDays: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mt-2"
            />
          </div>
        </div>

        {/* Enforcement Toggles */}
        <div className="space-y-3 pt-2">
          {/* Auto Lock Toggle */}
          <div className="p-4 bg-slate-50 border rounded-2xl flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-800 text-xs block">Automated Remote Device Locking</span>
              <span className="text-xs text-slate-500">
                When enabled, devices with unpaid installments exceeding grace period are automatically restricted.
              </span>
            </div>
            <input
              type="checkbox"
              checked={policy.autoLockEnabled}
              onChange={(e) => setPolicy({ ...policy, autoLockEnabled: e.target.checked })}
              className="w-5 h-5 text-blue-600 rounded-lg focus:ring-blue-500 cursor-pointer"
            />
          </div>

          {/* Staged restrictions — calls/SMS, then apps, then the full lock */}
          <div className="p-4 bg-slate-50 border rounded-2xl flex items-center justify-between gap-4">
            <div>
              <span className="font-bold text-slate-800 text-xs block">Staged Restrictions (calls → apps → lock)</span>
              <span className="text-xs text-slate-500">
                1 installment late: outgoing calls and SMS blocked. 2 late: WhatsApp, Facebook, TikTok, YouTube and
                similar apps paused too. 3 late (or the last installment): full lock. Incoming and emergency calls
                always work. Off: the first late installment locks the phone. Applies to agreements signed while it is on.
              </span>
              {!policy.autoLockEnabled && policy.stagedRestrictionsEnabled && (
                <span className="mt-1 block text-xs font-bold text-amber-700">
                  Automated locking is off, so no handset will act on this.
                </span>
              )}
            </div>
            <input
              type="checkbox"
              aria-label="Staged restrictions"
              checked={policy.stagedRestrictionsEnabled}
              onChange={(e) => setPolicy({ ...policy, stagedRestrictionsEnabled: e.target.checked })}
              className="w-5 h-5 shrink-0 text-blue-600 rounded-lg focus:ring-blue-500 cursor-pointer"
            />
          </div>

          {/* Location for recovery — consent-gated, owner-only, logged */}
          <div className="p-4 bg-slate-50 border rounded-2xl flex items-center justify-between gap-4">
            <div>
              <span className="font-bold text-slate-800 text-xs block">Location for Phone Recovery</span>
              <span className="text-xs text-slate-500">
                Lets the shop owner ask a locked or overdue phone for its location, to recover it. Never for a customer
                who is up to date. The customer's agreement says so, the phone shows them a notice each time, and every
                request and view is recorded. Applies only to agreements signed while it is on, and needs phone app 1.3
                or newer.
              </span>
            </div>
            <input
              type="checkbox"
              aria-label="Location for phone recovery"
              checked={policy.locationOnRecoveryEnabled}
              onChange={(e) => setPolicy({ ...policy, locationOnRecoveryEnabled: e.target.checked })}
              className="w-5 h-5 shrink-0 text-blue-600 rounded-lg focus:ring-blue-500 cursor-pointer"
            />
          </div>

          {/* Offline rule — enforced on the handset, so it is described as such */}
          <div className="p-4 bg-slate-50 border rounded-2xl space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-800 text-xs">Restrict a Handset That Stops Reporting</span>
              <span className="font-extrabold text-amber-600 text-sm">
                {policy.offlineLockAfterDays === 0 ? 'Off' : `${policy.offlineLockAfterDays} Days`}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              A phone kept offline cannot receive a lock command. With this on, the phone restricts itself
              after this many days without reaching the server — but only while an installment is actually
              past its grace period, and only for customers whose signed agreement says so. Requires
              automated locking to be on. 0 turns it off; the minimum otherwise is 3 days.
            </p>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={policy.offlineLockAfterDays}
              onChange={(e) => {
                // The server refuses 1 and 2 — a weekend with no signal is not
                // evidence of anything. The slider skips them rather than
                // letting somebody pick a value that will be rejected on save.
                const raw = Number(e.target.value);
                setPolicy({ ...policy, offlineLockAfterDays: raw > 0 && raw < 3 ? 3 : raw });
              }}
              disabled={!policy.autoLockEnabled}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-600 mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            {!policy.autoLockEnabled && policy.offlineLockAfterDays > 0 && (
              <p className="text-xs font-bold text-amber-700">
                Automated locking is off, so no handset will act on this.
              </p>
            )}
          </div>

          {/* Factory Reset Protection — what survives a recovery-mode wipe */}
          <div className="p-4 bg-slate-50 border rounded-2xl space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-xs">Factory Reset Protection</span>
                <button
                  type="button"
                  onClick={() => setShowGoogleIdGuide(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>How to get Google Account ID</span>
                </button>
              </div>
              <span className="font-extrabold text-amber-600 text-sm">
                {parseFrpAccountIds(frpAccountsText).length === 0 ? 'Off' : 'On'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Settings-menu resets are already blocked, but a reset from the phone&apos;s recovery menu (power +
              volume buttons) wipes the app. With this on, a phone wiped that way cannot be set up again until
              one of these Google accounts signs in — so bring it to the shop and re-enrol it. Applied only
              while money is owed; it is removed automatically once the plan is paid off. Enter the numeric
              Google account ID (not the email), one per line, up to 5.
            </p>
            {parseFrpAccountIds(frpAccountsText).length === 0 && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
                <p className="font-bold">Factory Reset Protection is currently OFF</p>
                <p>
                  Without at least one Google Account ID here, someone who wipes a financed phone from the recovery
                  menu (power + volume buttons) can set it up again as a fresh phone without returning to the shop.
                  Add your shop&apos;s numeric Google Account ID below and save policy settings.
                </p>
                <button
                  type="button"
                  onClick={() => setShowGoogleIdGuide(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-extrabold text-amber-950 hover:bg-amber-100 transition-colors"
                >
                  <Key className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                  <span>Open Step-by-Step Guide (English + Roman Urdu)</span>
                </button>
              </div>
            )}
            <textarea
              value={frpAccountsText}
              onChange={(e) => setFrpAccountsText(e.target.value)}
              rows={2}
              placeholder="e.g. 118223344556677889900"
              className="w-full px-3 py-2 text-xs font-mono bg-white border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {frpInvalid.length > 0 && (
              <p className="text-xs font-bold text-rose-600">
                Not a Google account ID: {frpInvalid.join(', ')}. Use the long number, not an email address.
              </p>
            )}
          </div>

          {/* Auto Unlock Toggle */}
          <div className="p-4 bg-slate-50 border rounded-2xl flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-800 text-xs block">Automated Unlock on Verified Payment</span>
              <span className="text-xs text-slate-500">
                Instantly transmit unlock signal to phone as soon as overdue installment is verified in full.
              </span>
            </div>
            <input
              type="checkbox"
              checked={policy.autoUnlockEnabled}
              onChange={(e) => setPolicy({ ...policy, autoUnlockEnabled: e.target.checked })}
              className="w-5 h-5 text-emerald-600 rounded-lg focus:ring-emerald-500 cursor-pointer"
            />
          </div>

          {/* Emergency Calls */}
          <div className="p-4 bg-slate-50 border rounded-2xl flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-800 text-xs block">Emergency Dialing Access (1122 / 15)</span>
              <span className="text-xs text-slate-500">
                Always allow emergency outgoing phone calls even in restricted lock mode (Mandatory Regulatory Policy).
              </span>
            </div>
            <input
              type="checkbox"
              checked={policy.emergencyCallsAllowed}
              disabled
              className="w-5 h-5 text-emerald-600 rounded-lg focus:ring-emerald-500 opacity-80"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSavePolicy}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Policy Settings'}</span>
          </button>
        </div>
      </div>

      {/* Business Profile Card */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border-2 border-ink-900 shadow-card space-y-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Dealer Business Profile</h2>
            <p className="text-xs text-slate-500">Information displayed to customers on lock screens and receipts.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Dealership / Shop Name</label>
            <input
              type="text"
              value={dealerProfile.name}
              onChange={(e) => setDealerProfile({ ...dealerProfile, name: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Owner / Primary Contact Name</label>
            <input
              type="text"
              value={dealerProfile.ownerName}
              onChange={(e) => setDealerProfile({ ...dealerProfile, ownerName: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Official Support Phone</label>
            <input
              type="text"
              value={dealerProfile.phone}
              onChange={(e) => setDealerProfile({ ...dealerProfile, phone: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">City</label>
            <input
              type="text"
              value={dealerProfile.city}
              onChange={(e) => setDealerProfile({ ...dealerProfile, city: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Shop Address</label>
            <input
              type="text"
              value={dealerProfile.address}
              onChange={(e) => setDealerProfile({ ...dealerProfile, address: e.target.value })}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Update Profile'}</span>
          </button>
        </div>
      </div>

      <GoogleIdGuideModal
        isOpen={showGoogleIdGuide}
        onClose={() => setShowGoogleIdGuide(false)}
      />
    </div>
  );
};
