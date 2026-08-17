import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Smartphone,
  Wifi,
  WifiOff,
  Battery,
  BatteryCharging,
  Lock,
  Unlock,
  RefreshCw,
  PhoneCall,
  CreditCard,
  AlertOctagon,
  ShieldAlert,
  Send,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCw,
  Phone,
  MessageSquare,
  Globe,
  Camera,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

export const SimulatorPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const urlDeviceId = searchParams.get('deviceId');
  const { showToast } = useAuth();

  const [devices, setDevices] = useState<any[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [enrollTokenInput, setEnrollTokenInput] = useState('');
  const [showCallModal, setShowCallModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  const loadDevices = async () => {
    try {
      const list = await ApiService.getSimulatorDevices();
      setDevices(list);
      if (list.length > 0) {
        if (urlDeviceId && list.some((d) => d.id === urlDeviceId)) {
          setSelectedDeviceId(urlDeviceId);
        } else if (!selectedDeviceId) {
          // Default to a locked or active device
          const defaultDev = list.find((d) => d.status === 'LOCKED') || list[0];
          setSelectedDeviceId(defaultDev.id);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 4000); // Polling for live sync
    return () => clearInterval(interval);
  }, []);

  const currentDevice = devices.find((d) => d.id === selectedDeviceId) || devices[0];

  const handleSimAction = async (action: string, payload: any = {}) => {
    if (!currentDevice) return;
    try {
      setActionLoading(true);
      if (action === 'SIMULATE_REBOOT') {
        setIsRebooting(true);
        setTimeout(() => setIsRebooting(false), 2000);
      }
      await ApiService.updateSimulatorState({
        deviceId: currentDevice.id,
        action,
        payload,
      });
      await loadDevices();
      showToast(`Simulator action applied: ${action.replace('_', ' ')}`, 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleScanToken = async () => {
    if (!enrollTokenInput) {
      showToast('Please enter an enrollment token', 'error');
      return;
    }
    try {
      setActionLoading(true);
      const res = await ApiService.updateSimulatorState({
        deviceId: currentDevice.id,
        action: 'SCAN_QR_TOKEN',
        payload: { token: enrollTokenInput },
      });
      showToast(res.message || 'Device Enrolled Successfully!', 'success');
      setEnrollTokenInput('');
      await loadDevices();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSimulatedPayment = async () => {
    try {
      setActionLoading(true);
      const res = await ApiService.recordPayment({
        dealerId: currentDevice.dealerId,
        customerId: currentDevice.customerId,
        amount: currentDevice.overdueAmount || 7500,
        paymentMethod: 'JAZZCASH',
        referenceNumber: `SIM-JC-${Date.now().toString().slice(-6)}`,
        notes: 'Simulated customer lock screen repayment',
        autoVerify: true,
      });
      setShowPayModal(false);
      showToast(res.message || 'Payment received & device unlocked!', 'success');
      await loadDevices();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && devices.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-slate-500 font-semibold">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-600" /> Loading virtual device simulator...
        </div>
      </div>
    );
  }

  const isLocked = currentDevice?.status === 'LOCKED';
  const isPending = currentDevice?.status === 'PENDING';
  const isOverdue = currentDevice?.status === 'OVERDUE';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 text-white p-5 sm:p-6 rounded-3xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Smartphone className="w-4 h-4 text-emerald-400" /> Virtual Hardware Simulator
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold">Interactive Android Phone Simulator</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Test real-time lock screens, lock/unlock acknowledgment, offline queueing, and customer self-service actions.
          </p>
        </div>

        {/* Device Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 font-semibold whitespace-nowrap hidden sm:inline">Select Virtual Phone:</label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.brand} {d.model} ({d.status}) - {d.customerName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Simulator Workspace: Phone Frame on Left, Control Deck on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT: Virtual Android Smartphone Container */}
        <div className="lg:col-span-5 flex justify-center">
          <div className="relative w-[340px] sm:w-[360px] h-[680px] bg-slate-950 rounded-[48px] p-3 shadow-2xl ring-1 ring-slate-800 phone-screen-frame flex flex-col overflow-hidden select-none transition-all">
            {/* Phone Speaker & Front Camera Hole */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
              <div className="w-12 h-1 bg-slate-800 rounded-full"></div>
              <div className="w-3.5 h-3.5 bg-slate-900 rounded-full border border-slate-700/50"></div>
            </div>

            {/* Screen Inner Frame */}
            <div className="w-full h-full bg-slate-900 rounded-[38px] overflow-hidden flex flex-col relative text-white">
              {/* Android System Status Bar */}
              <div className="h-7 px-6 flex items-center justify-between text-[11px] font-semibold text-slate-300 pt-1.5 z-20">
                <span>10:45 AM</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">{currentDevice?.simCarrier || 'Jazz 4G'}</span>
                  {currentDevice?.isOnline ? (
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  )}
                  <div className="flex items-center gap-1">
                    <span>{currentDevice?.batteryLevel}%</span>
                    <Battery className="w-3.5 h-3.5 text-slate-300" />
                  </div>
                </div>
              </div>

              {/* REBOOT SCREEN OVERLAY */}
              {isRebooting && (
                <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center space-y-3">
                  <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
                  <span className="text-xs font-bold text-slate-400">Android System Restarting...</span>
                </div>
              )}

              {/* SCREEN CONTENT: 1. LOCKED RESTRICTED SCREEN */}
              {isLocked && !isRebooting && (
                <div className="flex-1 flex flex-col justify-between p-6 bg-gradient-to-b from-rose-950 via-slate-950 to-slate-950 text-center animate-fade-in">
                  <div className="pt-6 space-y-3">
                    <div className="w-16 h-16 rounded-3xl bg-rose-600/20 border-2 border-rose-500 flex items-center justify-center mx-auto text-rose-500 animate-pulse">
                      <Lock className="w-8 h-8" />
                    </div>

                    <div>
                      <h2 className="text-xl font-extrabold text-rose-400 tracking-tight">DEVICE RESTRICTED</h2>
                      <p className="text-xs text-rose-200/80 mt-1">
                        "Your installment payment is overdue."
                      </p>
                    </div>

                    {/* Outstanding Card */}
                    <div className="bg-slate-900/90 border border-rose-500/30 rounded-2xl p-4 space-y-2 mt-4 text-left">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Outstanding:</span>
                        <span className="font-extrabold text-rose-400 text-sm">
                          Rs. {Number(currentDevice?.overdueAmount || 7500).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Due Date:</span>
                        <span className="font-semibold text-slate-200">{currentDevice?.nextDueDate || '20 Aug 2026'}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Reason:</span>
                        <span className="font-semibold text-rose-300">Installment overdue</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 px-2 leading-relaxed">
                      This device has been temporarily restricted per your financing contract. Clear the balance to instantly restore full phone access.
                    </p>
                  </div>

                  {/* Lock Screen Action Buttons */}
                  <div className="space-y-2.5 pb-2">
                    <button
                      onClick={() => setShowPayModal(true)}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-extrabold shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2"
                    >
                      <CreditCard className="w-4 h-4" /> PAY NOW (RESTORE ACCESS)
                    </button>

                    <button
                      onClick={() => setShowCallModal(true)}
                      className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 flex items-center justify-center gap-2"
                    >
                      <PhoneCall className="w-3.5 h-3.5 text-blue-400" /> CONTACT DEALER
                    </button>

                    <button
                      onClick={() => setShowEmergencyModal(true)}
                      className="w-full py-2 text-rose-400 hover:text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" /> EMERGENCY CALL (1122 / 15)
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN CONTENT: 2. ACTIVE UNLOCKED ANDROID HOME */}
              {!isLocked && !isPending && !isRebooting && (
                <div className="flex-1 flex flex-col justify-between p-5 bg-gradient-to-b from-blue-950/60 via-slate-900 to-slate-950 animate-fade-in">
                  {/* Top Notification Widget */}
                  <div className="space-y-3 pt-2">
                    {/* EMI Shield Service Indicator */}
                    <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-2xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20"></div>
                        <span className="font-semibold text-slate-200">EMI Shield Active</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Policy Compliant</span>
                    </div>

                    {/* Overdue Alert Banner if overdue */}
                    {isOverdue && (
                      <div className="p-3 bg-amber-500/20 border border-amber-500/50 rounded-2xl flex items-center gap-2.5 text-xs text-amber-200 animate-pulse">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <div>
                          <p className="font-bold">Installment Due Soon</p>
                          <p className="text-[10px] text-amber-300">Rs. {Number(currentDevice?.overdueAmount).toLocaleString()} overdue</p>
                        </div>
                      </div>
                    )}

                    {/* Clock Display */}
                    <div className="text-center py-4">
                      <h3 className="text-4xl font-extrabold tracking-tight text-white">10:45</h3>
                      <p className="text-xs text-slate-400 mt-1">Monday, 17 August 2026</p>
                    </div>
                  </div>

                  {/* App Grid */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-3 text-center text-[10px] font-medium text-slate-300">
                      <div className="space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white mx-auto shadow-md">
                          <Phone className="w-5 h-5" />
                        </div>
                        <span>Phone</span>
                      </div>
                      <div className="space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white mx-auto shadow-md">
                          <MessageSquare className="w-5 h-5" />
                        </div>
                        <span>Messages</span>
                      </div>
                      <div className="space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-red-600 flex items-center justify-center text-white mx-auto shadow-md">
                          <CreditCard className="w-5 h-5" />
                        </div>
                        <span>JazzCash</span>
                      </div>
                      <div className="space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center text-white mx-auto shadow-md">
                          <CreditCard className="w-5 h-5" />
                        </div>
                        <span>Easypaisa</span>
                      </div>
                      <div className="space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white mx-auto shadow-md">
                          <Globe className="w-5 h-5" />
                        </div>
                        <span>Chrome</span>
                      </div>
                      <div className="space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-amber-600 flex items-center justify-center text-white mx-auto shadow-md">
                          <Camera className="w-5 h-5" />
                        </div>
                        <span>Camera</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SCREEN CONTENT: 3. PENDING ENROLLMENT */}
              {isPending && !isRebooting && (
                <div className="flex-1 flex flex-col justify-between p-6 bg-slate-950 text-center animate-fade-in">
                  <div className="pt-10 space-y-4">
                    <div className="w-16 h-16 rounded-3xl bg-blue-600/20 border-2 border-blue-500 flex items-center justify-center mx-auto text-blue-400">
                      <QrCode className="w-8 h-8" />
                    </div>

                    <div>
                      <h2 className="text-lg font-bold text-white">Enrollment Required</h2>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                        This financed device has not been provisioned with EMI Shield DPC yet.
                      </p>
                    </div>

                    <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-slate-300">
                      Enter or scan the enrollment QR token from the dealer dashboard to activate.
                    </div>
                  </div>

                  <div className="pb-4">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">
                      EMI Shield DPC Client v2.4
                    </span>
                  </div>
                </div>
              )}

              {/* Android Bottom Navigation Pill */}
              <div className="h-6 flex items-center justify-center pb-1">
                <div className="w-28 h-1 bg-slate-600 rounded-full"></div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Remote Simulator Control Deck */}
        <div className="lg:col-span-7 space-y-6">
          {/* Device Info & Live Status Card */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Target Virtual Phone</span>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {currentDevice?.brand} {currentDevice?.model}
                </h2>
                <p className="text-xs text-slate-500 font-mono">
                  IMEI: {currentDevice?.imei} | Customer: {currentDevice?.customerName}
                </p>
              </div>

              {/* Status Pill */}
              <div>
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
                  <span className="w-2 h-2 rounded-full bg-current"></span>
                  {currentDevice?.status}
                </span>
              </div>
            </div>

            {/* Remote Hardware Controls Grid */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Simulate Hardware & Environment
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Online / Offline Toggle */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Cellular / WiFi Network</span>
                    <span className="text-[11px] text-slate-500">
                      {currentDevice?.isOnline ? 'Online (Connected)' : 'Offline (Disconnected)'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleSimAction('TOGGLE_ONLINE', { isOnline: !currentDevice?.isOnline })}
                    disabled={actionLoading}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      currentDevice?.isOnline
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-rose-600 text-white hover:bg-rose-700'
                    }`}
                  >
                    {currentDevice?.isOnline ? 'Toggle Offline' : 'Toggle Online'}
                  </button>
                </div>

                {/* Battery Slider */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">Battery Level</span>
                    <span className="font-bold text-blue-600">{currentDevice?.batteryLevel}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={currentDevice?.batteryLevel || 75}
                    onChange={(e) => handleSimAction('SET_BATTERY', { batteryLevel: Number(e.target.value) })}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>
              </div>
            </div>

            {/* Remote MDM & Lock Actions */}
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Remote Enforcement Commands
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Force Lock */}
                <button
                  onClick={() => handleSimAction('FORCE_LOCK')}
                  disabled={actionLoading || isLocked}
                  className="p-3 bg-rose-50 hover:bg-rose-100/80 border border-rose-200 text-rose-700 rounded-2xl text-xs font-bold flex flex-col items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  <Lock className="w-4 h-4" />
                  <span>Lock Device</span>
                </button>

                {/* Force Unlock */}
                <button
                  onClick={() => handleSimAction('FORCE_UNLOCK')}
                  disabled={actionLoading || !isLocked}
                  className="p-3 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-700 rounded-2xl text-xs font-bold flex flex-col items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  <Unlock className="w-4 h-4" />
                  <span>Unlock Device</span>
                </button>

                {/* Trigger Overdue */}
                <button
                  onClick={() => handleSimAction('SIMULATE_OVERDUE')}
                  disabled={actionLoading}
                  className="p-3 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-700 rounded-2xl text-xs font-bold flex flex-col items-center gap-1.5 transition-all"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Mark Overdue</span>
                </button>

                {/* Simulate Reboot */}
                <button
                  onClick={() => handleSimAction('SIMULATE_REBOOT')}
                  disabled={actionLoading}
                  className="p-3 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 rounded-2xl text-xs font-bold flex flex-col items-center gap-1.5 transition-all"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Reboot OS</span>
                </button>
              </div>
            </div>

            {/* QR Token Enrollment Scanner Tool */}
            <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-400">
                <QrCode className="w-4 h-4" /> Simulate Android QR Enrollment Scanner
              </div>
              <p className="text-xs text-slate-300">
                Paste any single-use enrollment token code below to simulate the phone scanning the dealer QR code:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. EMIS-STA-XXXX-XXXX"
                  value={enrollTokenInput}
                  onChange={(e) => setEnrollTokenInput(e.target.value)}
                  className="flex-1 px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleScanToken}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all"
                >
                  Scan & Enroll
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: Call Dealer Modal */}
      {showCallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-sm w-full text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{currentDevice?.dealerName}</h3>
              <p className="text-xs text-slate-500 mt-1">Authorized Installment Financing Partner</p>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl font-mono font-bold text-blue-800 text-sm">
              {currentDevice?.dealerPhone}
            </div>
            <button
              onClick={() => setShowCallModal(false)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Simulated Instant Payment Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-sm w-full space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CreditCard className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-900">Instant Online Installment Payment</h3>
              <p className="text-xs text-slate-500 mt-1">Clear pending overdue balance to trigger immediate unlock.</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Amount Due:</span>
                <span className="font-bold text-slate-900">Rs. {Number(currentDevice?.overdueAmount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Gateway:</span>
                <span className="font-bold text-emerald-700">JazzCash / Raast 1-Link</span>
              </div>
            </div>
            <button
              onClick={handleSimulatedPayment}
              disabled={actionLoading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-extrabold shadow-lg shadow-emerald-600/30"
            >
              {actionLoading ? 'Processing & Unlocking...' : 'Confirm & Pay Rs. ' + Number(currentDevice?.overdueAmount).toLocaleString()}
            </button>
            <button
              onClick={() => setShowPayModal(false)}
              className="w-full py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Emergency Call Modal */}
      {showEmergencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-sm w-full text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Emergency Services (Pakistan)</h3>
              <p className="text-xs text-slate-500 mt-1">Emergency dialer remains fully accessible even while restricted.</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="p-3 bg-slate-50 border rounded-xl flex justify-between font-bold">
                <span>Rescue 1122:</span>
                <span className="text-rose-600">1122</span>
              </div>
              <div className="p-3 bg-slate-50 border rounded-xl flex justify-between font-bold">
                <span>Police Emergency:</span>
                <span className="text-rose-600">15</span>
              </div>
            </div>
            <button
              onClick={() => setShowEmergencyModal(false)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
