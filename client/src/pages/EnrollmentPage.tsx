import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { usePagination } from '../hooks/usePagination.js';

import {
  QrCode,
  Smartphone,
  Copy,
  RefreshCw,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  PlusCircle,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { QRType } from '../types/index.js';

export const EnrollmentPage: React.FC = () => {
  const { selectedDealerId, showToast } = useAuth();
  const navigate = useNavigate();

  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeQrType, setActiveQrType] = useState<QRType>('STANDARD');
  const [activeGeneratedToken, setActiveGeneratedToken] = useState<any | null>(null);
  const [generating, setGenerating] = useState(false);
  /** The rendered provisioning QR, and whether it can actually provision a phone. */
  const [activeQr, setActiveQr] = useState<{ image?: string; ready: boolean; warning?: string } | null>(null);

  const paged = usePagination([selectedDealerId]);

  const qrCategories: { type: QRType; title: string; desc: string; badge: string }[] = [
    {
      type: 'STANDARD',
      title: 'Standard Enrollment QR',
      desc: 'Default Android Enterprise DPC zero-touch & 6-tap provisioning bundle.',
      badge: 'Recommended',
    },
    {
      type: 'PRO',
      title: 'Advanced / Pro Enrollment QR',
      desc: 'Hardened Knox Guard & OEM security policy wrapper with offline enforcement.',
      badge: 'High Security',
    },
    {
      type: 'LEGACY',
      title: 'Legacy Enrollment QR',
      desc: 'Universal compatibility profile for older Android 10-12 devices.',
      badge: 'Compatibility',
    },
    {
      type: 'QC',
      title: 'Quality Check QR',
      desc: 'Bench-testing and diagnostic verification profile prior to customer handover.',
      badge: 'Testing',
    },
  ];

  const loadTokens = async () => {
    try {
      setLoading(true);
      const res = await ApiService.getEnrollmentTokens({ dealerId: selectedDealerId, ...paged.params });
      const data = res.data;
      paged.setPagination(res.pagination);
      setTokens(data);
      if (data.length > 0 && !activeGeneratedToken) {
        setActiveGeneratedToken(data[0]);
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, paged.page, paged.limit]);

  const handleGenerateNewQR = async (type: QRType) => {
    try {
      setGenerating(true);
      setActiveQrType(type);
      const res = await ApiService.generateEnrollmentToken({
        dealerId: selectedDealerId,
        qrType: type,
        expiresInMinutes: 120,
      });
      setActiveGeneratedToken(res.token);
      setActiveQr({
        image: res.qrImageDataUrl,
        ready: res.qrProvisioningReady !== false,
        warning: res.qrWarning,
      });
      showToast(`Generated new ${type} Enrollment QR token!`, 'success');
      loadTokens();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const copyToken = (tokStr: string) => {
    navigator.clipboard.writeText(tokStr);
    showToast('Enrollment code copied to clipboard!', 'info');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            QR Provisioning & Device Enrollment
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Generate single-use expirable QR codes for standard and advanced mobile device enrollment.
          </p>
        </div>

        <button
          onClick={() => handleGenerateNewQR(activeQrType)}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/30 transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
          <span>{generating ? 'Generating...' : 'Regenerate QR Token'}</span>
        </button>
      </div>

      {/* QR Profile Shortcuts Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {qrCategories.map((c) => (
          <div
            key={c.type}
            onClick={() => handleGenerateNewQR(c.type)}
            className={`p-5 rounded-3xl border transition-all cursor-pointer group ${
              activeQrType === c.type
                ? 'bg-navy-950 text-white border-slate-800 shadow-xl shadow-navy-950/10 ring-2 ring-blue-500'
                : 'bg-white text-slate-800 border-slate-200/80 hover:border-slate-300 shadow-card'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                  activeQrType === c.type
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {c.badge}
              </span>
              <QrCode
                className={`w-5 h-5 ${
                  activeQrType === c.type ? 'text-blue-400' : 'text-slate-400 group-hover:text-blue-600'
                }`}
              />
            </div>
            <h2 className="text-sm font-extrabold mt-3">{c.title}</h2>
            <p
              className={`text-xs mt-1 leading-relaxed ${
                activeQrType === c.type ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {c.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Active QR Display & Instructions Card */}
      {activeGeneratedToken && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-card items-center">
          {/* Left: Visual QR Box */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-950 text-white rounded-3xl shadow-xl space-y-4 text-center">
            <div className="bg-white p-4 rounded-2xl shadow-md">
              {activeQr?.image ? (
                <img
                  src={activeQr.image}
                  alt="Android provisioning QR code"
                  className="w-48 h-48"
                />
              ) : (
                <QrCode className="w-48 h-48 text-slate-900" />
              )}
            </div>

            {activeQr && !activeQr.ready && (
              <div className="text-[11px] text-left bg-amber-500/15 border border-amber-400/40 text-amber-200 rounded-xl p-3">
                <strong className="block text-amber-100">This QR will not provision a new phone yet.</strong>
                {activeQr.warning}
              </div>
            )}

            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Single-Use Enrollment Token
              </span>
              <div className="font-mono text-xs font-bold text-emerald-400 bg-slate-800/90 py-2 px-3 rounded-xl mt-1 flex items-center justify-center gap-2">
                <span>{activeGeneratedToken.token}</span>
                <button onClick={() => copyToken(activeGeneratedToken.token)} title="Copy Code">
                  <Copy className="w-3.5 h-3.5 text-slate-300 hover:text-white" />
                </button>
              </div>
            </div>

            <button
              onClick={() => navigate(`/simulator`)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Test in Phone Simulator
            </button>
          </div>

          {/* Right: Enrollment Details & Security Guide */}
          <div className="lg:col-span-7 space-y-4">
            <div>
              <span className="text-xs uppercase font-bold text-blue-600 tracking-wider">
                {activeGeneratedToken.qrType || activeQrType} Profile Ready
              </span>
              <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">Android Device Provisioning Instructions</h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                To link a newly unboxed phone to this dealer account, follow the standardized Android Enterprise enrollment workflow:
              </p>
            </div>

            {/* Step list */}
            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">1</span>
                <div>
                  <span className="font-bold text-slate-900">Power on New Phone & Tap Welcome Screen 6 Times</span>
                  <p className="text-slate-500 text-[11px] mt-0.5">Tap anywhere on the initial setup welcome screen to activate the built-in Android QR code camera scanner.</p>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">2</span>
                <div>
                  <span className="font-bold text-slate-900">Scan this QR Code</span>
                  <p className="text-slate-500 text-[11px] mt-0.5">The phone will automatically download and install the official EMI Shield Device Policy Controller (DPC).</p>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">3</span>
                <div>
                  <span className="font-bold text-slate-900">Hand Device to Financed Customer</span>
                  <p className="text-slate-500 text-[11px] mt-0.5">Device status will automatically switch to <strong>ACTIVE</strong> in your dashboard once handshake completes.</p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-[11px] text-blue-800">
              🔒 <strong>Security Guarantee:</strong> This token does not contain any plain-text retailer credentials or WiFi passwords. It expires automatically in 2 hours.
            </div>
          </div>
        </div>
      )}

      {/* History of Generated Tokens */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
        <div className="p-4 border-b border-slate-100 font-bold text-slate-900 text-xs">
          Recent Enrollment Token History
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-400 text-[10px] uppercase">
                <th className="py-2.5 px-4">Token Code</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Assigned Phone / Customer</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Expires At</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tokens.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-bold text-slate-800">{t.token}</td>
                  <td className="py-3 px-4 font-semibold text-slate-700">{t.qrType}</td>
                  <td className="py-3 px-4 text-slate-600">{t.deviceInfo || 'Unassigned'}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`status-pill text-[10px] ${
                        t.status === 'ENROLLED' ? 'status-active' : t.isExpired ? 'status-inactive' : 'status-pending'
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-[11px]">{new Date(t.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => copyToken(t.token)}
                      className="p-1 text-slate-500 hover:text-blue-600 rounded"
                      title="Copy Code"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            pagination={paged.pagination}
            onPageChange={paged.setPage}
            onLimitChange={paged.setLimit}
            itemLabel="enrollment codes"
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
};
