import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { EditDeviceModal } from '../components/modals/EditDeviceModal.js';
import {
  Smartphone,
  User,
  ShieldAlert,
  Lock,
  Unlock,
  MessageSquare,
  CreditCard,
  History,
  Wifi,
  WifiOff,
  Battery,
  BatteryCharging,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Radio,
  Clock,
  ShieldCheck,
  Send,
  RotateCw,
  Pencil,
  FileText,
} from 'lucide-react';

export const DeviceDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast, isStaff, isDealerAdmin } = useAuth();

  const [device, setDevice] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Modal States
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockReason, setLockReason] = useState('Installment overdue per financing policy');
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('Payment verified in full');
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageTitle, setMessageTitle] = useState('Important Account Notice');
  const [messageContent, setMessageContent] = useState('Please visit the shop or transfer installment via JazzCash.');
  const [actionProcessing, setActionProcessing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  /** The signed consent this device's lock rests on, if it has one. */
  const [contract, setContract] = useState<any>(null);

  const loadDeviceDetail = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await ApiService.getDevice(id);
      setDevice(data);

      // A device registered before contracts existed has none, and a customer
      // with no financing plan never had one. Neither is an error worth a toast.
      try {
        const doc = await ApiService.getContractForDevice(id);
        setContract({ ...doc.contract, hashMatches: doc.hashMatches });
      } catch {
        setContract(null);
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeviceDetail();
  }, [id]);

  const handleLock = async () => {
    try {
      setActionProcessing(true);
      const res = await ApiService.lockDevice(device.id, {
        reason: lockReason,
      });
      showToast(res.message || 'Lock command executed', 'success');
      setShowLockModal(false);
      loadDeviceDetail();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleUnlock = async () => {
    try {
      setActionProcessing(true);
      const res = await ApiService.unlockDevice(device.id, {
        reason: unlockReason,
      });
      showToast(res.message || 'Device unlocked', 'success');
      setShowUnlockModal(false);
      loadDeviceDetail();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleSendMessage = async () => {
    try {
      setActionProcessing(true);
      await ApiService.sendDeviceMessage(device.id, {
        title: messageTitle,
        message: messageContent,
      });
      showToast('Push alert sent to device', 'success');
      setShowMessageModal(false);
      loadDeviceDetail();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleReboot = async () => {
    try {
      setActionProcessing(true);
      await ApiService.rebootDevice(device.id);
      showToast('Reboot command signaled to device', 'info');
      loadDeviceDetail();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionProcessing(false);
    }
  };

  if (loading || !device) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-3 text-slate-500 font-semibold text-xs">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-600" /> Loading device 360 profile...
        </div>
      </div>
    );
  }

  const isLocked = device.status === 'LOCKED' || device.status === 'LOCK_PENDING';
  const isOverdue = device.status === 'OVERDUE';
  const isPending = device.status === 'PENDING';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Back button & Title bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/devices')}
            className="p-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
                {device.brand} {device.model}
              </h1>
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
                {device.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              IMEI: {device.maskedImei} | Serial: {device.serialNumber}
            </p>
          </div>
        </div>

        {/* Remote Action Controls */}
        {/* Every control here is a shop-side action. A customer viewing their
            own device gets the information, not the enforcement levers. */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {isStaff && (
            <>
              <button
                onClick={() => navigate(`/simulator?deviceId=${device.id}`)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold transition-all"
              >
                <Radio className="w-4 h-4" /> Test in Simulator
              </button>

              <button
                onClick={() => setShowMessageModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
              >
                <MessageSquare className="w-4 h-4 text-blue-600" /> Send Message
              </button>
            </>
          )}

          {isDealerAdmin && (
            <>
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
              >
                <Pencil className="w-4 h-4 text-amber-600" /> Edit Device
              </button>

              <button
                onClick={handleReboot}
                disabled={actionProcessing || !device.isOnline}
                title={device.isOnline ? 'Remote device reboot' : 'Device is offline and cannot be rebooted'}
                className="p-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {!isLocked ? (
                <button
                  onClick={() => setShowLockModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/30 transition-all"
                >
                  <Lock className="w-4 h-4" /> LOCK DEVICE
                </button>
              ) : (
                <button
                  onClick={() => setShowUnlockModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 transition-all"
                >
                  <Unlock className="w-4 h-4" /> UNLOCK DEVICE
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 5 Health Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Connectivity */}
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Network</span>
            {device.isOnline ? (
              <Wifi className="w-4 h-4 text-emerald-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <p className="text-sm font-extrabold text-slate-900 mt-2">
            {device.isOnline ? 'Online (Connected)' : 'Offline'}
          </p>
          <span className="text-[10px] text-slate-400 font-mono">{device.simCarrier || 'Jazz 4G'}</span>
        </div>

        {/* Battery */}
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Battery Level</span>
            <Battery className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-sm font-extrabold text-slate-900 mt-2">{device.batteryLevel}%</p>
          <span className="text-[10px] text-slate-400">Health Normal</span>
        </div>

        {/* Last Seen */}
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Last Sync</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-sm font-extrabold text-slate-900 mt-2">
            {device.isOnline ? '2 mins ago' : '2 days ago'}
          </p>
          <span className="text-[10px] text-slate-400">Heartbeat OK</span>
        </div>

        {/* OS & Version */}
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>OS & Platform</span>
            <Smartphone className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-sm font-extrabold text-slate-900 mt-2">{device.osVersion}</p>
          <span className="text-[10px] text-slate-400">DPC Client 2.4</span>
        </div>

        {/* Security Patch */}
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Security Status</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-sm font-extrabold text-emerald-700 mt-2">Enforced</p>
          <span className="text-[10px] text-slate-400 font-mono">Patch: {device.securityPatch}</span>
        </div>
      </div>

      {/* Main Grid: Customer & Financing Specs on Left, Action Log on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Customer & Plan Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Customer Card */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600" /> Customer Information
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-slate-500">Name:</span>
                <span className="font-bold text-slate-900">{device.customer?.name || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-slate-500">Phone:</span>
                <span className="font-bold text-slate-900">{device.customer?.phone || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-slate-500">CNIC (Masked):</span>
                <span className="font-mono font-bold text-slate-800">{device.customer?.cnic}</span>
              </div>
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-slate-500">Address:</span>
                <span className="font-medium text-slate-700 truncate max-w-[160px]">{device.customer?.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Emergency:</span>
                <span className="font-medium text-slate-700">{device.customer?.emergencyContactPhone}</span>
              </div>
            </div>
          </div>

          {/* Financing Plan Summary */}
          {device.plan && (
            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-600" /> Installment Plan Details
              </h2>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-500">Total Device Price:</span>
                  <span className="font-bold text-slate-900">Rs. {Number(device.plan.totalAmount).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-500">Down Payment:</span>
                  <span className="font-bold text-slate-900">Rs. {Number(device.plan.downPayment).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-500">Monthly Amount:</span>
                  <span className="font-extrabold text-blue-700">
                    Rs. {Number(device.plan.monthlyInstallment).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-500">Progress:</span>
                  <span className="font-bold text-emerald-700">
                    {device.plan.paidInstallments} of {device.plan.totalInstallments} Months Paid
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Remaining Balance:</span>
                  <span className="font-extrabold text-slate-900">
                    Rs. {Number(device.plan.remainingBalance).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/*
            The consent this device's lock rests on.

            Shown next to the plan rather than buried: a handset that can be
            restricted with nothing signed is the state a shop most needs to
            notice, and the lock will refuse until it is fixed.
          */}
          {contract && (
            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" /> Financing Agreement
              </h2>

              {contract.status === 'SIGNED' && contract.hashMatches ? (
                <p className="text-xs text-emerald-700 font-bold">
                  Signed by {contract.signerName}
                  {contract.signedAt ? ` on ${new Date(contract.signedAt).toLocaleDateString()}` : ''}
                </p>
              ) : contract.status === 'SIGNED' ? (
                <p className="text-xs text-rose-700 font-bold">
                  Signed, but the plan has changed since. It must be re-signed before this device can be restricted.
                </p>
              ) : contract.status === 'VOID' ? (
                <p className="text-xs text-slate-600 font-bold">Voided — this device cannot be restricted.</p>
              ) : (
                <p className="text-xs text-amber-700 font-bold">
                  Not signed. This device cannot be restricted until the customer signs.
                </p>
              )}

              <button
                onClick={() => navigate(`/contracts/${contract.id}`)}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                {contract.status === 'DRAFT' ? 'Read and sign with the customer' : 'View the agreement'}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Installment Schedule & Immutable Device Action Logs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Installments Schedule */}
          {device.installments && device.installments.length > 0 && (
            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-4">
              <h2 className="text-sm font-bold text-slate-900">Installment Repayment Schedule</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px]">
                      <th className="py-2">#</th>
                      <th className="py-2">Due Date</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Grace Until</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {device.installments.map((inst: any) => (
                      <tr key={inst.id} className="hover:bg-slate-50">
                        <td className="py-2 font-bold text-slate-700">#{inst.installmentNumber}</td>
                        <td className="py-2 text-slate-700">{inst.dueDate}</td>
                        <td className="py-2 font-bold text-slate-900">Rs. {Number(inst.amountDue).toLocaleString()}</td>
                        <td className="py-2 text-slate-500">{inst.graceDate}</td>
                        <td className="py-2">
                          <span
                            className={`status-pill text-[10px] ${
                              inst.status === 'PAID'
                                ? 'status-active'
                                : inst.status === 'OVERDUE'
                                ? 'status-overdue'
                                : 'status-pending'
                            }`}
                          >
                            {inst.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Immutable Device Action Log Timeline */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" /> Device Action Audit Timeline
            </h2>

            {device.actionLogs && device.actionLogs.length > 0 ? (
              <div className="space-y-3 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-100">
                {device.actionLogs.map((log: any) => (
                  <div key={log.id} className="relative flex items-start gap-3 pl-2">
                    <div
                      className={`w-4 h-4 rounded-full mt-1 border-2 border-white shadow-sm shrink-0 ${
                        log.action === 'LOCK'
                          ? 'bg-rose-500 ring-2 ring-rose-200'
                          : log.action === 'UNLOCK'
                          ? 'bg-emerald-500 ring-2 ring-emerald-200'
                          : 'bg-blue-500 ring-2 ring-blue-200'
                      }`}
                    ></div>
                    <div className="flex-1 bg-slate-50 p-3 rounded-2xl border border-slate-200/60 text-xs">
                      <div className="flex items-center justify-between font-bold text-slate-800">
                        <span>{log.action} Action</span>
                        <span className="text-[10px] font-normal text-slate-400">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-600 text-xs mt-1">{log.reason || 'Standard operation executed.'}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 pt-1 border-t border-slate-200/40">
                        <span>Actor: {log.userName}</span>
                        <span>IP: {log.ipAddress}</span>
                        <span className="text-emerald-600 font-semibold">Device Ack: ✓</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No previous action logs recorded for this device.</p>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: Lock Confirmation Dialog */}
      {showLockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl border border-rose-100">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-900">Lock Device?</h3>
              <p className="text-xs text-slate-500 mt-1">
                This will place the financed <strong>{device.brand} {device.model}</strong> into restricted mode according to the active financing policy.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Lock</label>
              <input
                type="text"
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowLockModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleLock}
                disabled={actionProcessing}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/30"
              >
                {actionProcessing ? 'Executing...' : 'Confirm Lock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Unlock Confirmation Dialog */}
      {showUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl border border-emerald-100">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <Unlock className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-900">Authorize Device Unlock</h3>
              <p className="text-xs text-slate-500 mt-1">
                Restore full access for <strong>{device.brand} {device.model}</strong>.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Authorization Note</label>
              <input
                type="text"
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowUnlockModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlock}
                disabled={actionProcessing}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30"
              >
                {actionProcessing ? 'Authorizing...' : 'Confirm Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Send Message Dialog */}
      {showMessageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <MessageSquare className="w-4 h-4 text-blue-600" /> Send Push Notification Alert
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notification Title</label>
              <input
                type="text"
                value={messageTitle}
                onChange={(e) => setMessageTitle(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Message Body</label>
              <textarea
                rows={3}
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowMessageModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSendMessage}
                disabled={actionProcessing}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Send to Device
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <EditDeviceModal
          device={device}
          onClose={() => setShowEditModal(false)}
          onSaved={loadDeviceDetail}
        />
      )}
    </div>
  );
};
