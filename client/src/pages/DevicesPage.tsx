import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Device, DeviceStatus } from '../types/index.js';
import {
  Smartphone,
  Search,
  Filter,
  Lock,
  Unlock,
  Eye,
  CreditCard,
  History,
  ShieldAlert,
  Wifi,
  WifiOff,
  Battery,
  AlertTriangle,
  Radio,
  PlusCircle,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AddCustomerWizardModal } from '../components/modals/AddCustomerWizardModal.js';
import { Pagination } from '../components/ui/Pagination.js';
import { ExportButton } from '../components/ui/ExportButton.js';
import { usePagination } from '../hooks/usePagination.js';
import { csvMoney, csvDateTime, CsvColumn } from '../utils/csv.js';

export const DevicesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || 'ALL';
  const initialSearch = searchParams.get('search') || '';

  const { selectedDealerId, showToast, isStaff, isDealerAdmin } = useAuth();
  const navigate = useNavigate();

  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [activeStatusTab, setActiveStatusTab] = useState<string>(initialStatus);
  const [selectedBrand, setSelectedBrand] = useState<string>('ALL');
  const [showAddWizard, setShowAddWizard] = useState(false);

  // Declared after the filters it watches, so changing any of them resets to page 1.
  const paged = usePagination([searchQuery, activeStatusTab, selectedBrand, selectedDealerId]);

  // Lock Confirmation Modal State
  const [lockModalDevice, setLockModalDevice] = useState<any | null>(null);
  const [lockReason, setLockReason] = useState('Installment overdue per financing agreement');
  const [lockProcessing, setLockProcessing] = useState(false);

  // Unlock Confirmation Modal State
  const [unlockModalDevice, setUnlockModalDevice] = useState<any | null>(null);
  const [unlockReason, setUnlockReason] = useState('Installment payment verified');
  const [unlockProcessing, setUnlockProcessing] = useState(false);

  // Quick Payment Modal State
  const [quickPayDevice, setQuickPayDevice] = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('JAZZCASH');
  const [payProcessing, setPayProcessing] = useState(false);

  /**
   * Single source of truth for the device query, so the table and the CSV
   * export can never drift apart and hand the user a differently-filtered file.
   */
  const deviceQuery = (extra: Record<string, unknown>) => ({
    search: searchQuery || undefined,
    status: activeStatusTab === 'ALL' ? undefined : activeStatusTab,
    brand: selectedBrand === 'ALL' ? undefined : selectedBrand,
    dealerId: selectedDealerId,
    ...extra,
  });

  const deviceCsvColumns: CsvColumn<any>[] = [
    { header: 'Brand', value: (d) => d.brand },
    { header: 'Model', value: (d) => d.model },
    { header: 'IMEI', value: (d) => d.imei ?? d.maskedImei },
    { header: 'Status', value: (d) => d.status },
    { header: 'Customer', value: (d) => d.customerName },
    { header: 'Customer Phone', value: (d) => d.customerPhone },
    { header: 'Monthly Installment (PKR)', value: (d) => csvMoney(d.monthlyAmount) },
    { header: 'Remaining Balance (PKR)', value: (d) => csvMoney(d.remainingBalance) },
    { header: 'Next Due Date', value: (d) => d.nextDueDate ?? '' },
    { header: 'Overdue Installments', value: (d) => d.overdueCount ?? 0 },
    { header: 'Online', value: (d) => (d.isOnline ? 'Yes' : 'No') },
    { header: 'Battery %', value: (d) => d.batteryLevel },
    { header: 'Last Seen', value: (d) => csvDateTime(d.lastSeen) },
  ];

  const loadDevices = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getDevices(deviceQuery(paged.params));
      setDevices(data.data);
      paged.setPagination(data.pagination);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, activeStatusTab, selectedBrand, paged.page, paged.limit]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadDevices();
  };

  const handleConfirmLock = async () => {
    if (!lockModalDevice) return;
    try {
      setLockProcessing(true);
      const res = await ApiService.lockDevice(lockModalDevice.id, {
        reason: lockReason,
      });
      showToast(res.message || 'Lock command executed', 'success');
      setLockModalDevice(null);
      loadDevices();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLockProcessing(false);
    }
  };

  const handleConfirmUnlock = async () => {
    if (!unlockModalDevice) return;
    try {
      setUnlockProcessing(true);
      const res = await ApiService.unlockDevice(unlockModalDevice.id, {
        reason: unlockReason,
      });
      showToast(res.message || 'Device unlocked successfully', 'success');
      setUnlockModalDevice(null);
      loadDevices();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUnlockProcessing(false);
    }
  };

  const handleQuickPaymentSubmit = async () => {
    if (!quickPayDevice) return;
    try {
      setPayProcessing(true);
      const res = await ApiService.recordPayment({
        dealerId: quickPayDevice.dealerId,
        customerId: quickPayDevice.customerId,
        amount: paymentAmount,
        paymentMethod,
        referenceNumber: `${paymentMethod.substring(0, 3)}-${Date.now().toString().slice(-6)}`,
        notes: `Quick payment recorded for ${quickPayDevice.brand} ${quickPayDevice.model}`,
        autoVerify: true,
      });
      showToast(res.message || 'Payment recorded successfully', 'success');
      setQuickPayDevice(null);
      loadDevices();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setPayProcessing(false);
    }
  };

  const statusTabs = ['ALL', 'ACTIVE', 'OVERDUE', 'LOCKED', 'PENDING', 'INACTIVE'];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Device Management Hub
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Monitor device health, MDM compliance, installment schedules, and trigger enforcement actions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton
            fetchPage={(p) => ApiService.getDevices(deviceQuery(p))}
            columns={deviceCsvColumns}
            filenamePrefix="devices"
          />
          {isStaff && (
          <button
            onClick={() => navigate('/simulator')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold transition-all"
          >
            <Radio className="w-4 h-4 text-indigo-600" /> Phone Simulator
          </button>
          )}
          {isStaff && (
          <button
            onClick={() => setShowAddWizard(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/30 transition-all"
          >
            <PlusCircle className="w-4 h-4" /> Add Financed Device
          </button>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-card space-y-4">
        {/* Status Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {statusTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveStatusTab(tab)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeStatusTab === tab
                  ? 'bg-navy-950 text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-600'
              }`}
            >
              {tab === 'ALL' ? 'All Devices' : tab}
            </button>
          ))}
        </div>

        {/* Search & Brand Filter Controls */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="flex-1 w-full relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by customer name, device model, or IMEI..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </form>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Brands</option>
              <option value="Samsung">Samsung</option>
              <option value="Infinix">Infinix</option>
              <option value="Tecno">Tecno</option>
              <option value="Xiaomi">Xiaomi</option>
              <option value="Vivo">Vivo</option>
              <option value="Oppo">Oppo</option>
            </select>
          </div>
        </div>
      </div>

      {/* Devices Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2 font-medium">
            <span className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></span>
            Loading portfolio devices...
          </div>
        ) : devices.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">No Financed Devices Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Add your first financed device to start managing installments, monitoring status, and securing hardware.
            </p>
            <button
              onClick={() => setShowAddWizard(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
            >
              Add Device Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Device & Model</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Masked IMEI</th>
                  <th className="py-3 px-4">Installment / mo</th>
                  <th className="py-3 px-4">Next Due Date</th>
                  <th className="py-3 px-4">Device Status</th>
                  <th className="py-3 px-4">Last Seen</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {devices.map((d) => {
                  const isLocked = d.status === 'LOCKED' || d.status === 'LOCK_PENDING';
                  const isOverdue = d.status === 'OVERDUE';
                  const isPending = d.status === 'PENDING';

                  return (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition-colors group">
                      {/* Device & Model */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                            <Smartphone className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block leading-tight">
                              {d.brand} {d.model}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">{d.ramStorage}</span>
                          </div>
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-800 block">{d.customerName}</span>
                        <span className="text-[10px] text-slate-400">{d.customerPhone}</span>
                      </td>

                      {/* Masked IMEI */}
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-slate-600 font-semibold bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                          {d.maskedImei}
                        </span>
                      </td>

                      {/* Installment */}
                      <td className="py-3.5 px-4">
                        <span className="font-extrabold text-slate-900">
                          Rs. {Number(d.monthlyAmount || 0).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-400 block">/ month</span>
                      </td>

                      {/* Next Due */}
                      <td className="py-3.5 px-4">
                        <span className="font-medium text-slate-700">{d.nextDueDate}</span>
                        {d.installmentStatus === 'OVERDUE' && (
                          <span className="text-[10px] text-rose-600 font-bold block">Overdue</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`status-pill ${
                            isLocked
                              ? 'status-locked'
                              : isOverdue
                              ? 'status-overdue'
                              : isPending
                              ? 'status-pending'
                              : 'status-active'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                          {d.status}
                        </span>
                      </td>

                      {/* Last Seen & Connectivity */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                          {d.isOnline ? (
                            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <WifiOff className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{d.isOnline ? 'Online now' : 'Offline'}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View 360 */}
                          <button
                            onClick={() => navigate(`/devices/${d.id}`)}
                            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Full Device 360 Detail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Quick Payment — counter staff and above */}
                          {isStaff && (
                          <button
                            onClick={() => {
                              setQuickPayDevice(d);
                              setPaymentAmount(d.monthlyAmount || 7500);
                            }}
                            className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Record Installment Payment"
                          >
                            <CreditCard className="w-4 h-4" />
                          </button>
                          )}

                          {/* Enforcement — restricted to the shop owner */}
                          {isDealerAdmin && (!isLocked ? (
                            <button
                              onClick={() => {
                                setLockModalDevice(d);
                                setLockReason(`Installment overdue for ${d.brand} ${d.model}`);
                              }}
                              className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Restricted Lock Device"
                            >
                              <Lock className="w-4 h-4 text-rose-500" />
                            </button>
                          ) : (
                            /* Unlock Action (if locked) */
                            <button
                              onClick={() => {
                                setUnlockModalDevice(d);
                                setUnlockReason(`Payment confirmed for ${d.brand} ${d.model}`);
                              }}
                              className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="Unlock Device"
                            >
                              <Unlock className="w-4 h-4 text-emerald-600" />
                            </button>
                          ))}

                          {/* Simulator Link — staff tool, not customer-facing */}
                          {isStaff && (
                          <button
                            onClick={() => navigate(`/simulator?deviceId=${d.id}`)}
                            className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Launch in Virtual Simulator"
                          >
                            <Radio className="w-4 h-4" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="devices"
              disabled={loading}
            />
          </div>
        )}
      </div>

      {/* MODAL: Lock Confirmation Dialog */}
      {lockModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl border border-rose-100">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-900">Lock Device?</h3>
              <p className="text-xs text-slate-500 mt-1">
                This will place the financed <strong>{lockModalDevice.brand} {lockModalDevice.model}</strong> (Customer: {lockModalDevice.customerName}) into restricted mode according to the active financing policy.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Enforcement Reason *</label>
              <input
                type="text"
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
              />
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-800">
              ⚠️ Emergency call access will remain preserved. All consumer applications will be restricted until an unlock command is authorized.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setLockModalDevice(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLock}
                disabled={lockProcessing}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30"
              >
                {lockProcessing ? 'Dispatching...' : 'Confirm Lock Device'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Unlock Confirmation Dialog */}
      {unlockModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl border border-emerald-100">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <Unlock className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-900">Authorize Device Unlock</h3>
              <p className="text-xs text-slate-500 mt-1">
                Restore full access for <strong>{unlockModalDevice.brand} {unlockModalDevice.model}</strong>.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Authorization Note</label>
              <input
                type="text"
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setUnlockModalDevice(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmUnlock}
                disabled={unlockProcessing}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30"
              >
                {unlockProcessing ? 'Authorizing...' : 'Confirm Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Quick Payment Dialog */}
      {quickPayDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">Record Installment Payment</h3>
              <button onClick={() => setQuickPayDevice(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 block">Customer / Financed Device:</span>
                <span className="font-bold text-slate-900">
                  {quickPayDevice.customerName} — {quickPayDevice.brand} {quickPayDevice.model}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Amount (PKR) *</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
                >
                  <option value="JAZZCASH">JazzCash</option>
                  <option value="EASYPAISA">Easypaisa</option>
                  <option value="CASH">Cash at Counter</option>
                  <option value="BANK_TRANSFER">Bank Transfer (Raast)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setQuickPayDevice(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleQuickPaymentSubmit}
                disabled={payProcessing}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30"
              >
                {payProcessing ? 'Recording...' : 'Record & Verify Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Wizard */}
      {showAddWizard && (
        <AddCustomerWizardModal
          onClose={() => setShowAddWizard(false)}
          onSuccess={() => {
            setShowAddWizard(false);
            loadDevices();
          }}
        />
      )}
    </div>
  );
};
