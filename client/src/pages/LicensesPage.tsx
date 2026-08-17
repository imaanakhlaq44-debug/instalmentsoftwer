import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { KeyRound, ShieldCheck, CheckCircle2, Clock, Sparkles, RefreshCw } from 'lucide-react';

export const LicensesPage: React.FC = () => {
  const { selectedDealerId, showToast } = useAuth();
  const [licenses, setLicenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLicenses = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getLicenses(selectedDealerId);
      setLicenses(data);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLicenses();
  }, [selectedDealerId]);

  const activeLicense = licenses[0] || {
    plan: 'PROFESSIONAL',
    deviceLimit: 100,
    usedDevices: 25,
    availableDevices: 75,
    licenseKey: 'EMIS-PRO-8892-4410-LHR',
    expiryDate: '2027-01-10',
    status: 'ACTIVE',
  };

  const utilization = Math.round((activeLicense.usedDevices / (activeLicense.deviceLimit || 1)) * 100);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
          License Keys & Subscription Plans
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Dealer license key activation, device allocation capacity, and enterprise quota tiering.
        </p>
      </div>

      {/* Active License Overview Banner */}
      <div className="bg-gradient-to-r from-navy-950 to-blue-950 text-white p-6 sm:p-8 rounded-3xl border border-slate-800 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Active SaaS Tier
            </span>
            <h2 className="text-2xl font-extrabold text-white mt-1">
              {activeLicense.plan} Plan License
            </h2>
            <p className="text-xs text-slate-300 font-mono mt-1">
              Key: {activeLicense.licenseKey} | Valid until: {activeLicense.expiryDate}
            </p>
          </div>

          <div>
            <span className="status-pill status-active">Active & Verified</span>
          </div>
        </div>

        {/* Utilization Bar */}
        <div className="space-y-2 bg-slate-900/80 p-5 rounded-2xl border border-slate-800">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-slate-300">Device Quota Utilization</span>
            <span className="text-blue-400">{activeLicense.usedDevices} / {activeLicense.deviceLimit} Devices ({utilization}%)</span>
          </div>
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
            <div
              style={{ width: `${utilization}%` }}
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-500"
            ></div>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 pt-1">
            <span>{activeLicense.availableDevices} Financed Slots Remaining</span>
            <span>Renew Plan</span>
          </div>
        </div>
      </div>

      {/* Available Tiers Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { name: 'Starter', limit: '25 devices', price: 'Rs. 4,500/mo', desc: 'Single counter mobile shops' },
          { name: 'Professional', limit: '100 devices', price: 'Rs. 12,000/mo', desc: 'Growing multi-counter dealers', active: true },
          { name: 'Business', limit: '500 devices', price: 'Rs. 35,000/mo', desc: 'High-volume mobile distributors' },
          { name: 'Enterprise', limit: 'Unlimited', price: 'Custom Quote', desc: 'Financing houses & telecom chains' },
        ].map((plan) => (
          <div
            key={plan.name}
            className={`p-5 rounded-3xl border transition-all ${
              plan.active
                ? 'bg-white border-blue-600 shadow-lg ring-2 ring-blue-600/20'
                : 'bg-white border-slate-200/80 shadow-card'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400 uppercase">{plan.name}</span>
              {plan.active && <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Active</span>}
            </div>
            <p className="text-lg font-extrabold text-slate-900 mt-2">{plan.limit}</p>
            <span className="text-xs font-bold text-blue-600">{plan.price}</span>
            <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{plan.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
