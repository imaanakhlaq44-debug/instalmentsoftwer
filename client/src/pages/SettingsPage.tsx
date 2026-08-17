import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
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
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { selectedDealerId, showToast, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    autoUnlockEnabled: true,
    lockWarningDays: 2,
    customerReminderEnabled: true,
    emergencyCallsAllowed: true,
  });

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
          autoUnlockEnabled: data.policy.autoUnlockEnabled,
          lockWarningDays: data.policy.lockWarningDays,
          customerReminderEnabled: data.policy.customerReminderEnabled,
          emergencyCallsAllowed: data.policy.emergencyCallsAllowed,
        });
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
        policyData: policy,
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
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
          Dealer Settings & Enforcement Policies
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Configure business details, grace periods, automated device locking rules, and security controls.
        </p>
      </div>

      {/* Policy Settings Card */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-card space-y-6">
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
            <p className="text-[11px] text-slate-500">
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
            <p className="text-[11px] text-slate-500">
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
              <span className="text-[11px] text-slate-500">
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

          {/* Auto Unlock Toggle */}
          <div className="p-4 bg-slate-50 border rounded-2xl flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-800 text-xs block">Automated Unlock on Verified Payment</span>
              <span className="text-[11px] text-slate-500">
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
              <span className="text-[11px] text-slate-500">
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
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/30 transition-all"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Policy Settings'}</span>
          </button>
        </div>
      </div>

      {/* Business Profile Card */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-card space-y-6">
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
    </div>
  );
};
