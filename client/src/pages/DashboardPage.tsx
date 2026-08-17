import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import {
  Smartphone,
  CheckCircle2,
  Clock,
  Lock,
  AlertTriangle,
  PowerOff,
  Wallet,
  TrendingUp,
  PlusCircle,
  QrCode,
  RefreshCw,
  ArrowRight,
  CreditCard,
  ShieldAlert,
  Radio,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AddCustomerWizardModal } from '../components/modals/AddCustomerWizardModal.js';

export const DashboardPage: React.FC = () => {
  const { dealer, selectedDealerId, showToast, isStaff, isDealerAdmin } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<any>({
    totalDevices: 25,
    activeDevices: 17,
    pendingDevices: 2,
    lockedDevices: 3,
    overdueDevices: 3,
    inactiveDevices: 1,
    outstandingAmount: 1284500,
    collectedThisMonth: 642300,
    totalCollectedAllTime: 1845000,
  });

  const [charts, setCharts] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [evaluatingOverdue, setEvaluatingOverdue] = useState(false);
  const [showAddWizard, setShowAddWizard] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, chartsData] = await Promise.all([
        ApiService.getDashboardStats(selectedDealerId),
        ApiService.getDashboardCharts(selectedDealerId),
      ]);
      setStats(statsData);
      setCharts(chartsData);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDealerId]);

  const handleRunOverdueEngine = async () => {
    try {
      setEvaluatingOverdue(true);
      const res = await ApiService.evaluateOverdue();
      showToast(res.message || 'Overdue evaluation finished', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setEvaluatingOverdue(false);
    }
  };

  const dealerDisplayName = dealer?.ownerName || 'Tariq Mehmood';

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-navy-950 via-navy-900 to-blue-950 p-6 sm:p-8 rounded-3xl text-white shadow-xl shadow-navy-950/10 border border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ShieldAlert className="w-4 h-4" /> Financed Asset Protection
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Good morning, {dealerDisplayName}
          </h1>
          <p className="text-slate-300 text-sm mt-1 max-w-xl">
            Here's what's happening with your financed mobile portfolio and installment collections today.
          </p>
        </div>

        {/* Quick Action Shortcuts */}
        <div className="flex items-center gap-3 flex-wrap">
          {isStaff && (
          <button
            onClick={() => setShowAddWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-bold rounded-xl shadow-lg shadow-blue-600/30 transition-all hover:scale-105 active:scale-95"
          >
            <PlusCircle className="w-4 h-4" /> Add Financed Device
          </button>
          )}
          {isStaff && (
          <button
            onClick={() => navigate('/enrollment')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold rounded-xl border border-white/20 transition-all"
          >
            <QrCode className="w-4 h-4" /> QR Provisioning
          </button>
          )}
          {isDealerAdmin && (
          <button
            onClick={handleRunOverdueEngine}
            disabled={evaluatingOverdue}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs sm:text-sm font-bold rounded-xl border border-amber-500/40 transition-all"
            title="Scan all active installments and flag overdue devices according to grace period policy"
          >
            <RefreshCw className={`w-4 h-4 ${evaluatingOverdue ? 'animate-spin' : ''}`} />
            <span>{evaluatingOverdue ? 'Evaluating...' : 'Run Overdue Engine'}</span>
          </button>
          )}
        </div>
      </div>

      {/* Summary Cards Grid (Clickable to open filtered lists) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
        {/* Total Devices */}
        <div
          onClick={() => navigate('/devices?status=ALL')}
          className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Financed</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {stats.totalDevices}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Portfolio units</span>
            <ArrowRight className="w-3.5 h-3.5 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Active Devices */}
        <div
          onClick={() => navigate('/devices?status=ACTIVE')}
          className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-card hover:shadow-card-hover transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Active Devices</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-950 tracking-tight">
              {stats.activeDevices}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-emerald-600 font-semibold">
            <span>Compliant & Online</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Pending Enrollment */}
        <div
          onClick={() => navigate('/devices?status=PENDING')}
          className="bg-white p-5 rounded-2xl border border-amber-100 shadow-card hover:shadow-card-hover transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Pending QR</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-950 tracking-tight">
              {stats.pendingDevices}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-amber-600 font-semibold">
            <span>Awaiting scan</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Locked Devices */}
        <div
          onClick={() => navigate('/devices?status=LOCKED')}
          className="bg-white p-5 rounded-2xl border border-rose-200 shadow-card hover:shadow-card-hover transition-all cursor-pointer group bg-gradient-to-b from-white to-rose-50/30"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">Locked Devices</span>
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Lock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-rose-600 tracking-tight">
              {stats.lockedDevices}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-rose-600 font-bold">
            <span>Restricted Mode</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Overdue Devices */}
        <div
          onClick={() => navigate('/devices?status=OVERDUE')}
          className="bg-white p-5 rounded-2xl border border-orange-100 shadow-card hover:shadow-card-hover transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">Overdue Devices</span>
            <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-orange-950 tracking-tight">
              {stats.overdueDevices}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-orange-600 font-semibold">
            <span>Eligible for Lock</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Inactive Devices */}
        <div
          onClick={() => navigate('/devices?status=INACTIVE')}
          className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Inactive</span>
            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <PowerOff className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
              {stats.inactiveDevices}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Removed / Inactive</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Outstanding Balance */}
        <div
          onClick={() => navigate('/installments')}
          className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-card hover:shadow-card-hover transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Outstanding Portfolio</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-xl sm:text-2xl font-extrabold text-indigo-950 tracking-tight">
              Rs. {Number(stats.outstandingAmount).toLocaleString()}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-indigo-600 font-semibold">
            <span>Financed balance</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Collected This Month */}
        <div
          onClick={() => navigate('/payments')}
          className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-card hover:shadow-card-hover transition-all cursor-pointer group bg-gradient-to-b from-white to-emerald-50/20"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Collected This Month</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-100/70 text-emerald-700 flex items-center justify-center group-hover:scale-110 transition-transform">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-xl sm:text-2xl font-extrabold text-emerald-900 tracking-tight">
              Rs. {Number(stats.collectedThisMonth).toLocaleString()}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-emerald-700 font-bold">
            <span>Aug 2026 Collections</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>

      {/* Analytics & Distribution Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Trend Chart Representation */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Installment Collection Performance</h2>
              <p className="text-xs text-slate-500">Monthly recovery versus overdue exposure (PKR)</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="w-3 h-3 rounded-full bg-blue-600"></span> Collection
              </div>
              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="w-3 h-3 rounded-full bg-rose-500"></span> Overdue
              </div>
            </div>
          </div>

          {/* Bar Chart Visual */}
          <div className="space-y-4">
            {charts?.monthlyTrends?.map((item: any, idx: number) => {
              const maxVal = 850000;
              const collectionPct = Math.min(100, Math.round((item.collection / maxVal) * 100));
              const overduePct = Math.min(100, Math.round((item.overdue / maxVal) * 100));

              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>{item.month}</span>
                    <span>Rs. {item.collection.toLocaleString()}</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex gap-1">
                    <div
                      style={{ width: `${collectionPct}%` }}
                      className="bg-blue-600 rounded-full transition-all duration-500"
                    ></div>
                    <div
                      style={{ width: `${overduePct}%` }}
                      className="bg-rose-500 rounded-full transition-all duration-500"
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Brand Distribution & Quick Actions */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-card">
            <h2 className="text-base font-bold text-slate-900 mb-4">Device Brand Portfolio</h2>
            <div className="space-y-3">
              {charts?.brandDistribution?.map((b: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{b.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{b.count} devices</span>
                    <span className="text-slate-400">({Math.round((b.count / (stats.totalDevices || 1)) * 100)}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Info Box */}
          <div className="bg-gradient-to-br from-indigo-900 to-navy-950 p-5 rounded-3xl text-white">
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold mb-2">
              <Radio className="w-4 h-4 text-emerald-400" /> Interactive Phone Simulator
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Test live device locking, unlock triggers, and simulated customer lock screens in real time.
            </p>
            <button
              onClick={() => navigate('/simulator')}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              Launch Simulator <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Add Customer Wizard Modal */}
      {showAddWizard && (
        <AddCustomerWizardModal
          onClose={() => setShowAddWizard(false)}
          onSuccess={() => {
            setShowAddWizard(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};
