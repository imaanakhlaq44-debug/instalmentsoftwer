import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { EditDeviceModal } from '../components/modals/EditDeviceModal.js';
import { GoogleIdGuideModal } from '../components/modals/GoogleIdGuideModal.js';
import { FindPhoneCard } from '../components/devices/FindPhoneCard.js';
import { RestructurePlanModal, WaiveLateFeeModal } from '../components/installments/PlanAdjustments.js';
import { relativeTime } from '../utils/format.js';
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
  Clock,
  ShieldCheck,
  Send,
  RotateCw,
  Pencil,
  FileText,
  HelpCircle,
} from 'lucide-react';

const TAMPER_FLAG_LABELS: Record<string, string> = {
  IMEI_MISMATCH: 'IMEI mismatch',
  BOOTLOADER_UNLOCKED: 'Bootloader unlocked',
  ROOTED: 'Rooted handset',
  CUSTOM_ROM_TEST_KEYS: 'Custom OS (test-keys)',
  DEVICE_OWNER_LOST: 'Device Owner lost',
  SERIAL_MISMATCH: 'Serial number changed',
  ATTESTED_IMEI_MISMATCH: 'Chip IMEI mismatch',
  ATTESTATION_INVALID: 'Forged hardware proof',
  ATTESTATION_REVOKED: 'Revoked hardware key',
};

/** What the secure-chip check last said, for the Security Status card. */
const ATTESTATION_STATUS_LABELS: Record<string, string> = {
  VERIFIED: 'Hardware verified',
  INVALID: 'Hardware proof failed',
  UNTRUSTED_ROOT: 'Hardware proof not from Google',
  REVOKED: 'Hardware key revoked',
  CHALLENGE_MISMATCH: 'Hardware check pending',
  SOFTWARE_ONLY: 'No hardware proof (software only)',
  UNAVAILABLE: 'Phone cannot give hardware proof',
};

export const DeviceDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast, isStaff, isDealerAdmin } = useAuth();

  const [device, setDevice] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Modal States
  const [showRestructure, setShowRestructure] = useState(false);
  const [waiveFor, setWaiveFor] = useState<any>(null);
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockReason, setLockReason] = useState('Installment overdue per financing policy');
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('Payment verified in full');
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageTitle, setMessageTitle] = useState('Important Account Notice');
  const [messageContent, setMessageContent] = useState('Please visit the shop or transfer installment via JazzCash.');
  const [actionProcessing, setActionProcessing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showReEnrollModal, setShowReEnrollModal] = useState(false);
  const [reEnrollReason, setReEnrollReason] = useState('Phone was factory reset from recovery mode');
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const [showClearTamperModal, setShowClearTamperModal] = useState(false);
  const [clearTamperReason, setClearTamperReason] = useState('Handset inspected in shop; confirmed authentic');
  const [showGoogleIdGuide, setShowGoogleIdGuide] = useState(false);
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
        setContract({
          ...doc.contract,
          hashMatches: doc.hashMatches,
          planMatches: doc.planMatches,
          planChanges: doc.planChanges ?? [],
        });
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

  const handleReEnroll = async () => {
    try {
      setActionProcessing(true);
      await ApiService.reEnrollDevice(device.id, { reason: reEnrollReason });
      showToast('Ready for a new QR. Scan it on the reset phone.', 'success');
      setShowReEnrollModal(false);
      navigate(`/enrollment?device=${device.id}`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleRelease = async () => {
    try {
      setActionProcessing(true);
      await ApiService.releaseDevice(device.id, { reason: releaseReason });
      showToast('Phone released. Its restrictions come off the next time it connects.', 'success');
      setShowReleaseModal(false);
      loadDeviceDetail();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionProcessing(false);
    }
  };

  const handleClearTamperAlert = async () => {
    try {
      setActionProcessing(true);
      await ApiService.clearTamperAlert(device.id, { reason: clearTamperReason });
      showToast('Security alert resolved', 'success');
      setShowClearTamperModal(false);
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
  /** Handed back to its owner: paid off, or released by the shop. */
  const isReleased = device.status === 'INACTIVE';

  const tamperFlags: string[] = Array.isArray(device.tamperFlags) ? device.tamperFlags : [];
  const hasTamperAlert = tamperFlags.length > 0 || Boolean(device.tamperDetectedAt);
  const lastContactIso = device.lastCheckInAt || device.lastSeen;
  const lastContactMs = lastContactIso ? Date.parse(lastContactIso) : NaN;
  const isSilentOver72h =
    !device.noLock &&
    !isPending &&
    !isReleased &&
    device.status !== 'REMOVED' &&
    Number.isFinite(lastContactMs) &&
    Date.now() - lastContactMs >= 72 * 3_600_000;

  const reportedImeiDisplay = device.reportedImei || device.maskedReportedImei;
  const attestedImeis: string[] = Array.isArray(device.attestedImeis)
    ? device.attestedImeis
    : Array.isArray(device.maskedAttestedImeis)
    ? device.maskedAttestedImeis
    : [];
  const attestationLabel = device.attestationStatus
    ? ATTESTATION_STATUS_LABELS[device.attestationStatus] ?? device.attestationStatus
    : null;
  const securitySummary = device.noLock
    ? { label: 'Unprotected (No Lock)', color: 'text-slate-600', icon: AlertTriangle, iconColor: 'text-slate-400' }
    : hasTamperAlert
    ? { label: 'Tamper Alert', color: 'text-rose-700', icon: ShieldAlert, iconColor: 'text-rose-600' }
    : device.isDeviceOwner === false
    ? { label: 'Not Device Owner', color: 'text-amber-700', icon: AlertTriangle, iconColor: 'text-amber-600' }
    : isSilentOver72h
    ? { label: 'Silent (>72h)', color: 'text-amber-700', icon: AlertTriangle, iconColor: 'text-amber-600' }
    : !device.lastCheckInAt && !device.integrityCheckedAt
    ? { label: 'Awaiting first check-in', color: 'text-slate-600', icon: Clock, iconColor: 'text-slate-400' }
    : { label: 'Verified', color: 'text-emerald-700', icon: ShieldCheck, iconColor: 'text-emerald-500' };
  const SecurityStatusIcon = securitySummary.icon;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Back button & Title bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/devices')}
            className="p-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 transition-colors"
          >
            <ArrowLeft className="rtl:rotate-180 w-4 h-4" />
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
                {device.noLock ? 'NO LOCK' : isReleased ? 'RELEASED' : device.status}
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

              {!device.noLock && !isPending && device.status !== 'INACTIVE' && device.status !== 'REMOVED' && (
                <button
                  onClick={() => setShowReEnrollModal(true)}
                  title="The phone was factory reset and the app is gone"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                >
                  <RefreshCw className="w-4 h-4 text-blue-600" /> Re-enroll
                </button>
              )}

              {!isReleased && device.status !== 'REMOVED' && (
                <button
                  onClick={() => {
                    setReleaseReason('');
                    setShowReleaseModal(true);
                  }}
                  title="Hand the phone back: no more lock, and the app can be removed"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Release phone
                </button>
              )}

              {!isReleased && (
                <button
                  onClick={handleReboot}
                  disabled={actionProcessing || !device.isOnline}
                  title={device.isOnline ? 'Remote device reboot' : 'Device is offline and cannot be rebooted'}
                  className="p-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              )}

              {device.noLock || isReleased ? null : !isLocked ? (
                <button
                  onClick={() => setShowLockModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md transition-all"
                >
                  <Lock className="w-4 h-4" /> LOCK DEVICE
                </button>
              ) : (
                <button
                  onClick={() => setShowUnlockModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md transition-all"
                >
                  <Unlock className="w-4 h-4" /> UNLOCK DEVICE
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        A self-lock is not a status change, so it gets its own notice rather
        than being folded into the status badge. The shop needs to know the
        difference: nobody at the counter issued this, and the phone is holding
        itself until it can reach the server again.
      */}
      {isReleased && (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl">
          <p className="text-sm font-extrabold text-emerald-900">Released: this phone belongs to the customer</p>
          <p className="text-xs text-emerald-900 mt-1 leading-relaxed">
            It is no longer managed and cannot be locked. The next time the phone connects to the internet, the app
            removes every restriction and reset protection, and the customer can delete the app (app 1.2 or newer;
            on older versions the customer can factory reset the phone instead).
          </p>
        </div>
      )}

      {device.noLock && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
          <p className="text-xs font-extrabold text-slate-900">Sold without a lock</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            This phone cannot run the lock app, so it has no QR code and cannot be locked or restricted.
            Installments, payments, reminders and the signed agreement work as for any other sale.
          </p>
        </div>
      )}

      {device.offlineLockActive && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <p className="text-xs font-extrabold text-amber-900">
            This handset restricted itself under the offline rule
          </p>
          <p className="text-xs text-amber-800 mt-1">
            It could not reach the server for longer than the configured limit while an installment was
            overdue, so it applied the restriction on its own
            {device.offlineLockSince ? ` on ${new Date(device.offlineLockSince).toLocaleString()}` : ''}. It
            lifts itself once the phone reaches the server and the account is clear — no unlock command is
            needed for that. Nobody at the counter issued this lock.
          </p>
        </div>
      )}

      {hasTamperAlert && (
        <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-extrabold text-rose-950">Security & hardware integrity alert</p>
                {device.tamperDetectedAt && (
                  <p className="text-micro font-mono text-rose-700">
                    {`Detected ${new Date(device.tamperDetectedAt).toLocaleString()}`}
                  </p>
                )}
              </div>
            </div>
            {isDealerAdmin && (
              <button
                type="button"
                onClick={() => {
                  setClearTamperReason('Handset inspected in shop; confirmed authentic');
                  setShowClearTamperModal(true);
                }}
                className="px-3.5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-bold shrink-0 self-start"
              >
                Resolve Alert
              </button>
            )}
          </div>

          {tamperFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tamperFlags.map((flag) => (
                <span
                  key={flag}
                  className="inline-flex items-center rounded-full bg-rose-200/80 px-2.5 py-0.5 text-micro font-extrabold text-rose-950"
                >
                  {TAMPER_FLAG_LABELS[flag] ?? flag}
                </span>
              ))}
            </div>
          )}

          {device.tamperReason && (
            <p className="text-xs text-rose-900 leading-relaxed">{device.tamperReason}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-rose-200/80 text-xs">
            <div>
              <span className="text-micro font-semibold text-rose-700 block">Registered IMEI</span>
              <span className="font-mono font-bold text-rose-950">{device.imei || device.maskedImei}</span>
            </div>
            <div>
              <span className="text-micro font-semibold text-rose-700 block">Reported IMEI</span>
              <span className="font-mono font-bold text-rose-950">
                {reportedImeiDisplay || 'Not reported'}
              </span>
            </div>
            {Array.isArray(device.reportedImeis) && device.reportedImeis.length > 0 && (
              <div>
                <span className="text-micro font-semibold text-rose-700 block">Reported Slots</span>
                <span className="font-mono font-bold text-rose-950">{device.reportedImeis.join(', ')}</span>
              </div>
            )}
            {device.reportedSerial && (
              <div>
                <span className="text-micro font-semibold text-rose-700 block">Reported Serial</span>
                <span className="font-mono font-bold text-rose-950">{device.reportedSerial}</span>
              </div>
            )}
            {device.enrolledSerial && (
              <div>
                <span className="text-micro font-semibold text-rose-700 block">Serial at Enrollment</span>
                <span className="font-mono font-bold text-rose-950">{device.enrolledSerial}</span>
              </div>
            )}
            {attestedImeis.length > 0 && (
              <div>
                <span className="text-micro font-semibold text-rose-700 block">Chip IMEI (factory)</span>
                <span className="font-mono font-bold text-rose-950">{attestedImeis.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!device.noLock && !isPending && !isReleased && device.status !== 'REMOVED' && device.frpStatus === 'REFUSED' && (
        <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl space-y-1.5">
          <div className="flex items-start gap-2.5 text-xs text-rose-950">
            <ShieldAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-extrabold text-rose-950">Reset Protection Refused by Phone OS</p>
              <p className="leading-relaxed">
                {`This handset did not hold OS-level Factory Reset Protection${
                  device.frpError ? ` (${device.frpError})` : ''
                }. A recovery-mode wipe may not ask for your shop Google account. Check Play Services / Android version in person; Android 15+ gives strongest recovery reset protection.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {isStaff && !device.noLock && !isPending && !isReleased && device.status !== 'REMOVED' && device.frpStatus === 'NOT_CONFIGURED' && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              <strong>Factory Reset Protection was off</strong> when this handset last checked in. Add your shop&apos;s
              numeric Google Account ID in Settings so financed phones require it after a recovery reset.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowGoogleIdGuide(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-100"
            >
              <HelpCircle className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>How to get Google Account ID</span>
            </button>
            {isDealerAdmin && (
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800"
              >
                Open Settings
              </button>
            )}
          </div>
        </div>
      )}

      {!device.noLock && !isPending && !isReleased && device.status !== 'REMOVED' && (device.isDeviceOwner === false || isSilentOver72h) && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl space-y-1.5">
          {device.isDeviceOwner === false && (
            <div className="flex items-start gap-2.5 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                DPC is not active as Device Owner — OS-level lock and anti-reset protections cannot be enforced until
                the handset is wiped and re-enrolled.
              </p>
            </div>
          )}
          {isSilentOver72h && (
            <div className="flex items-start gap-2.5 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                This handset has not checked in for over 72 hours — verify whether it is offline, powered off, or
                tampered with.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 5 Health Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Connectivity */}
        <div className="p-4 bg-white rounded-2xl border-2 border-ink-900 shadow-card">
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
          <span className="text-micro text-slate-400 font-mono">{device.simCarrier || 'Jazz 4G'}</span>
        </div>

        {/* Battery */}
        <div className="p-4 bg-white rounded-2xl border-2 border-ink-900 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Battery Level</span>
            <Battery className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-sm font-extrabold text-slate-900 mt-2">{device.batteryLevel}%</p>
          <span className="text-micro text-slate-400">Health Normal</span>
        </div>

        {/* Last Seen */}
        <div className="p-4 bg-white rounded-2xl border-2 border-ink-900 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Last Sync</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          {/*
            The real timestamp. This card used to print "2 mins ago" or
            "2 days ago" from `isOnline` alone, which was invented — and it is
            the very number the offline rule counts, so a made-up one here would
            contradict what the handset is doing.
          */}
          <p className="text-sm font-extrabold text-slate-900 mt-2">
            {relativeTime(device.lastCheckInAt)}
          </p>
          <span className="text-micro text-slate-400">
            {device.lastCheckInAt ? 'Last DPC check-in' : 'The handset has never reported'}
          </span>
        </div>

        {/* OS & Version */}
        <div className="p-4 bg-white rounded-2xl border-2 border-ink-900 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>OS & Platform</span>
            <Smartphone className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-sm font-extrabold text-slate-900 mt-2">{device.osVersion}</p>
          <span className="text-micro text-slate-400">
            {device.noLock
              ? 'No DPC app'
              : device.dpcVersion
              ? `DPC v${device.dpcVersion}`
              : 'Not reported yet'}
          </span>
          {device.isDeviceOwner === false && !device.noLock && (
            <span className="mt-1 block text-micro font-bold text-amber-700">Not Device Owner</span>
          )}
        </div>

        {/* Security Status */}
        <div className="p-4 bg-white rounded-2xl border-2 border-ink-900 shadow-card">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Security Status</span>
            <SecurityStatusIcon className={`w-4 h-4 ${securitySummary.iconColor}`} />
          </div>
          <p className={`text-sm font-extrabold mt-2 ${securitySummary.color}`}>{securitySummary.label}</p>
          <span className="text-micro text-slate-400 font-mono">Patch: {device.securityPatch}</span>
          {attestationLabel && !device.noLock && (
            <span
              className={`mt-1 block text-micro font-bold ${
                device.attestationStatus === 'VERIFIED'
                  ? 'text-emerald-700'
                  : device.attestationStatus === 'INVALID' || device.attestationStatus === 'REVOKED'
                  ? 'text-rose-700'
                  : 'text-slate-500'
              }`}
              title={device.attestationReason || undefined}
            >
              {attestationLabel}
              {device.attestationStatus === 'VERIFIED' && device.attestedModel ? ` · ${device.attestedModel}` : ''}
            </span>
          )}
          {!device.noLock && device.frpStatus && (
            <span
              className={`mt-1 block text-micro font-bold ${
                device.frpStatus === 'ACTIVE'
                  ? 'text-emerald-700'
                  : device.frpStatus === 'REFUSED'
                  ? 'text-rose-700'
                  : 'text-amber-700'
              }`}
              title={device.frpError || undefined}
            >
              {device.frpStatus === 'ACTIVE'
                ? 'FRP Protected'
                : device.frpStatus === 'LEGACY'
                ? 'FRP Legacy (Android 8–10)'
                : device.frpStatus === 'REFUSED'
                ? 'FRP Refused'
                : 'FRP Off'}
            </span>
          )}
        </div>
      </div>

      {/* Main Grid: Customer & Financing Specs on Left, Action Log on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Customer & Plan Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Customer Card */}
          <div className="bg-white p-5 rounded-3xl border-2 border-ink-900 shadow-card space-y-3">
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
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
            <div className="bg-white p-5 rounded-3xl border-2 border-ink-900 shadow-card space-y-3">
              <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
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
              {/* Owners only: restructuring rewrites the signed figures. */}
              {isDealerAdmin && device.plan.status !== 'COMPLETED' && device.plan.status !== 'CANCELLED' && (
                <button type="button" onClick={() => setShowRestructure(true)} className="btn-secondary w-full">
                  Restructure plan
                </button>
              )}
            </div>
          )}

          {/*
            The consent this device's lock rests on.

            Shown next to the plan rather than buried: a handset that can be
            restricted with nothing signed is the state a shop most needs to
            notice, and the lock will refuse until it is fixed.
          */}
          {/* Owners only, and never for a phone that has no lock or has been released. */}
          {isDealerAdmin && !device.noLock && !isReleased && !isPending && <FindPhoneCard deviceId={device.id} />}

          {contract && (
            <div className="bg-white p-5 rounded-3xl border-2 border-ink-900 shadow-card space-y-3">
              <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" /> Financing Agreement
              </h2>

              {contract.status === 'SIGNED' && contract.hashMatches && contract.planMatches ? (
                <p className="text-xs text-emerald-700 font-bold">
                  Signed by {contract.signerName}
                  {contract.signedAt ? ` on ${new Date(contract.signedAt).toLocaleDateString()}` : ''}
                </p>
              ) : contract.status === 'SIGNED' && contract.hashMatches === false ? (
                <p className="text-xs text-rose-700 font-bold">
                  Signed, but the stored record has been altered since. It must be re-issued and re-signed before
                  this device can be restricted.
                </p>
              ) : contract.status === 'SIGNED' ? (
                <p className="text-xs text-rose-700 font-bold">
                  Signed, but the plan has changed since
                  {contract.planChanges?.length ? ` (${contract.planChanges.join(', ')})` : ''}. It must be
                  re-signed before this device can be restricted.
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
            <div className="bg-white p-5 rounded-3xl border-2 border-ink-900 shadow-card space-y-4">
              <h2 className="text-sm font-bold text-slate-900">Installment Repayment Schedule</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-600 uppercase text-micro">
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
                            className={`status-pill text-micro ${
                              inst.status === 'PAID'
                                ? 'status-active'
                                : inst.status === 'OVERDUE'
                                ? 'status-overdue'
                                : 'status-pending'
                            }`}
                          >
                            {inst.status}
                          </span>
                          {isDealerAdmin && Number(inst.lateFee || 0) - Number(inst.lateFeePaid || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => setWaiveFor(inst)}
                              className="ms-2 rounded-md border-2 border-ink-900 bg-sun-200 px-2 py-0.5 text-micro font-extrabold text-ink-900 hover:bg-sun-400"
                            >
                              Waive late fee
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Immutable Device Action Log Timeline */}
          <div className="bg-white p-5 rounded-3xl border-2 border-ink-900 shadow-card space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" /> Device Action Audit Timeline
            </h2>

            {device.actionLogs && device.actionLogs.length > 0 ? (
              <div className="space-y-3 relative before:absolute before:inset-0 before:start-3.5 before:w-0.5 before:bg-slate-100">
                {device.actionLogs.map((log: any) => (
                  <div key={log.id} className="relative flex items-start gap-3 ps-2">
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
                        <span className="text-micro font-normal text-slate-400">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-600 text-xs mt-1">{log.reason || 'Standard operation executed.'}</p>
                      <div className="flex items-center justify-between text-micro text-slate-400 mt-2 pt-1 border-t border-slate-200/40">
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
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-overlay border-2 border-ink-900">
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
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md"
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
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-overlay border-2 border-ink-900">
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
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md"
              >
                {actionProcessing ? 'Authorizing...' : 'Confirm Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-overlay border-2 border-ink-900">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto">
              <RefreshCw className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-title font-extrabold text-slate-900">Re-enroll this phone</h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                Use this when <strong>{device.brand} {device.model}</strong> was factory reset and the lock app is
                gone. It gets a fresh QR on the same lock, so no new lock is used.
              </p>
            </div>

            <ol className="p-3 rounded-xl bg-slate-50 border-2 border-slate-200 text-sm text-slate-800 space-y-1.5 list-decimal ps-8">
              <li>Factory reset the phone again and stop on the first Welcome screen.</li>
              <li>Do not add a Google account or finish setup.</li>
              <li>Tap 6 times, connect Wi-Fi and scan the new QR.</li>
            </ol>

            {isLocked && (
              <p className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                This phone is locked now. It comes back unlocked, so lock it again after it connects if money is
                still owed.
              </p>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reason</label>
              <input
                type="text"
                value={reEnrollReason}
                onChange={(e) => setReEnrollReason(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowReEnrollModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleReEnroll}
                disabled={actionProcessing || reEnrollReason.trim().length < 5}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md"
              >
                {actionProcessing ? 'Working...' : 'Re-enroll and show QR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReleaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-overlay border-2 border-ink-900">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-title font-extrabold text-slate-900">Release this phone</h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                <strong>{device.brand} {device.model}</strong> will belong to the customer. A plan paid in full does
                this by itself; use this when the balance was settled another way.
              </p>
            </div>

            <ul className="p-3 rounded-xl bg-slate-50 border-2 border-slate-200 text-sm text-slate-800 space-y-1.5 list-disc ps-8">
              <li>The lock, app blocks and reset protection come off when the phone next connects.</li>
              <li>The customer can then delete the app.</li>
              <li className="font-bold text-rose-700">This cannot be undone. To manage the phone again it must be re-enrolled from scratch.</li>
            </ul>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reason</label>
              <input
                type="text"
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                placeholder="e.g. Customer paid the full balance in cash"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowReleaseModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleRelease}
                disabled={actionProcessing || releaseReason.trim().length < 5}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md"
              >
                {actionProcessing ? 'Releasing...' : 'Release phone'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Send Message Dialog */}
      {showMessageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-overlay border-2 border-ink-900">
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

      {showClearTamperModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white p-6 rounded-3xl max-w-md w-full space-y-4 shadow-overlay border-2 border-ink-900">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-title font-extrabold text-slate-900">Resolve Security Alert</h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                Clear the active security alert once the handset has been inspected. Existing lock status will not
                change.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Inspection Note</label>
              <input
                type="text"
                value={clearTamperReason}
                onChange={(e) => setClearTamperReason(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowClearTamperModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleClearTamperAlert}
                disabled={actionProcessing || clearTamperReason.trim().length < 5}
                className="px-5 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md"
              >
                {actionProcessing ? 'Working...' : 'Resolve Alert'}
              </button>
            </div>
          </div>
        </div>
      )}

      <GoogleIdGuideModal
        isOpen={showGoogleIdGuide}
        onClose={() => setShowGoogleIdGuide(false)}
        onGoToSettings={isDealerAdmin ? () => navigate('/settings') : undefined}
      />
      {showRestructure && device.plan && (
        <RestructurePlanModal
          plan={device.plan}
          installments={device.installments ?? []}
          onClose={() => setShowRestructure(false)}
          onDone={(message) => {
            setShowRestructure(false);
            showToast(message, 'success');
            loadDeviceDetail();
          }}
        />
      )}
      {waiveFor && (
        <WaiveLateFeeModal
          installment={waiveFor}
          onClose={() => setWaiveFor(null)}
          onDone={(message) => {
            setWaiveFor(null);
            showToast(message, 'success');
            loadDeviceDetail();
          }}
        />
      )}
    </div>
  );
};
