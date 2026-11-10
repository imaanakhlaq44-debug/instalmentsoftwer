import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Hand,
  Loader2,
  Maximize2,
  QrCode,
  RefreshCw,
  ScanLine,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { usePagination } from '../hooks/usePagination.js';
import { Card, CardHeader, EmptyState, Skeleton } from '../components/ui/Card.js';

/**
 * Connect a phone.
 *
 * The counter flow is: pick the phone the customer is buying, show its QR,
 * scan it on the new handset. The QR is always issued for one particular
 * device, because a handset provisioned from a QR that names no device has
 * nothing to attach to and the server refuses it. The page used to offer four
 * "profiles" that differed only in their label; they are gone.
 */

interface AwaitingDevice {
  id: string;
  dealerId?: string;
  brand: string;
  model: string;
  imei?: string;
  maskedImei?: string;
  customerName: string;
  customerPhone?: string;
  createdAt?: string;
}

interface ActiveQr {
  deviceId: string;
  token: string;
  expiresAt: string;
  image?: string;
  ready: boolean;
  warning?: string;
}

/** "1h 59m", "12m", "expired" — counting down to the code's expiry. */
export function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const imeiTail = (d: AwaitingDevice) => {
  const raw = d.imei || d.maskedImei || '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `IMEI …${digits.slice(-4)}` : '';
};

const STEPS = [
  {
    icon: Smartphone,
    title: 'Switch on the new phone',
    body: 'It must be brand new or factory reset. Stop on the first "Welcome" screen.',
  },
  {
    icon: Hand,
    title: 'Tap the screen 6 times',
    body: 'Tap any empty part of the Welcome screen six times quickly. A QR scanner opens.',
  },
  {
    icon: Wifi,
    title: 'Connect to Wi-Fi',
    body: 'Use the shop Wi-Fi, or turn on a hotspot from another phone. Needed for about 2 minutes.',
  },
  {
    icon: ScanLine,
    title: 'Scan this QR',
    body: 'The phone downloads the Almas SDM app, checks it, and joins your shop by itself.',
  },
  {
    icon: CheckCircle2,
    title: 'Finish setup with the customer',
    body: 'The phone shows as Active on your dashboard. One lock is used for this phone.',
  },
];

export const EnrollmentPage: React.FC = () => {
  const { selectedDealerId, showToast, isDealerAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [awaiting, setAwaiting] = useState<AwaitingDevice[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('device'));
  const [qr, setQr] = useState<ActiveQr | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tokens, setTokens] = useState<any[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [frpConfigured, setFrpConfigured] = useState<boolean | null>(null);
  // An older phone cannot read a small QR off a laptop screen; full screen
  // gives its setup scanner several pixels per square.
  const [fullScreen, setFullScreen] = useState(false);

  const paged = usePagination([selectedDealerId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadAwaiting = useCallback(async () => {
    try {
      const res = await ApiService.getDevices({ dealerId: selectedDealerId, status: 'PENDING', lockable: 'true', limit: 50 });
      setAwaiting(res.data ?? []);
    } catch (err: any) {
      setAwaiting([]);
      showToast(err?.message || 'Could not load phones waiting for a QR', 'error');
    }
  }, [selectedDealerId, showToast]);

  const loadTokens = useCallback(async () => {
    try {
      setLoadingTokens(true);
      const res = await ApiService.getEnrollmentTokens({ dealerId: selectedDealerId, ...paged.params });
      paged.setPagination(res.pagination);
      setTokens(res.data ?? []);
    } catch (err: any) {
      showToast(err?.message || 'Could not load recent QR codes', 'error');
    } finally {
      setLoadingTokens(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, paged.page, paged.limit, showToast]);

  useEffect(() => {
    loadAwaiting();
  }, [loadAwaiting]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  useEffect(() => {
    let cancelled = false;
    if (!isDealerAdmin || (user?.role === 'SUPER_ADMIN' && !selectedDealerId)) {
      setFrpConfigured(null);
      return;
    }
    ApiService.getSettings(selectedDealerId)
      .then((data) => {
        if (cancelled) return;
        const ids = data?.policy?.frpAccountIds;
        setFrpConfigured(Array.isArray(ids) && ids.length > 0);
      })
      .catch(() => {
        if (!cancelled) setFrpConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDealerAdmin, user?.role, selectedDealerId]);

  const generate = useCallback(
    async (deviceId: string) => {
      try {
        setGenerating(true);
        setSelectedId(deviceId);
        // A super admin looking at every shop issues the QR in the phone's own shop.
        const owner = awaiting?.find((d) => d.id === deviceId)?.dealerId;
        const res = await ApiService.generateEnrollmentToken({
          dealerId: selectedDealerId ?? owner,
          deviceId,
          qrType: 'STANDARD',
          expiresInMinutes: 120,
        });
        setQr({
          deviceId,
          token: res.token.token,
          expiresAt: res.token.expiresAt,
          image: res.qrImageDataUrl,
          ready: res.qrProvisioningReady !== false,
          warning: res.qrWarning,
        });
        loadTokens();
      } catch (err: any) {
        showToast(err?.message || 'Could not create the QR', 'error');
      } finally {
        setGenerating(false);
      }
    },
    [selectedDealerId, awaiting, showToast, loadTokens]
  );

  // Arriving from a device's page (?device=…) opens its QR straight away.
  useEffect(() => {
    const fromLink = params.get('device');
    if (fromLink && !qr && !generating) generate(fromLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => awaiting?.find((d) => d.id === (qr?.deviceId ?? selectedId)) ?? null,
    [awaiting, qr, selectedId]
  );

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    showToast('Code copied', 'info');
  };

  const expired = qr ? timeLeft(qr.expiresAt, now) === 'expired' : false;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">QR enrollment</p>
          <h1 className="mt-1 text-display text-ink-900">Connect a new phone</h1>
          <p className="mt-1 max-w-xl text-body text-ink-500">
            Choose the phone the customer is buying, then scan its QR on the handset. Takes about 3 minutes.
          </p>
        </div>
        <button type="button" className="btn-secondary self-start" onClick={() => navigate('/')}>
          + New financed sale
        </button>
      </header>

      {frpConfigured === false && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-0.5 text-xs text-amber-900">
              <p className="text-sm font-extrabold">Factory Reset Protection is off for this shop</p>
              <p>
                Add at least one Google Account ID in Settings before scanning QR codes so recovery-mode resets lock the
                phone back to your shop.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="btn-secondary shrink-0 self-start sm:self-auto"
          >
            Open Settings
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Step 1: which phone */}
        <Card className="lg:col-span-2" flush>
          <div className="p-5 pb-3">
            <CardHeader title="1. Choose the phone" hint="Phones registered for a sale and not yet connected" />
          </div>
          <div className="max-h-[32rem] overflow-y-auto px-3 pb-4">
            {awaiting === null ? (
              <div className="space-y-2 px-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : awaiting.length === 0 ? (
              <EmptyState
                icon={<Smartphone className="h-6 w-6" aria-hidden="true" />}
                title="No phone is waiting"
                body="Register the sale first (New financed sale). The phone then appears here, ready for its QR."
              />
            ) : (
              <ul className="space-y-2">
                {awaiting.map((d) => {
                  const active = d.id === (qr?.deviceId ?? selectedId);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => generate(d.id)}
                        disabled={generating}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-3 rounded-md border-2 px-3 py-3 text-left transition ${
                          active
                            ? 'border-ink-900 bg-sun-400 shadow-[3px_3px_0_#0F1419]'
                            : 'border-transparent hover:border-ink-900 hover:bg-sun-100'
                        }`}
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border-2 border-ink-900 bg-white">
                          <Smartphone className="h-5 w-5 text-ink-900" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-extrabold text-ink-900">
                            {d.brand} {d.model}
                          </span>
                          <span className="block truncate text-caption text-ink-700">
                            {d.customerName}
                            {imeiTail(d) ? ` · ${imeiTail(d)}` : ''}
                          </span>
                        </span>
                        <QrCode className={`h-5 w-5 shrink-0 ${active ? 'text-ink-900' : 'text-ink-400'}`} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* Step 2: the QR and how to use it */}
        <Card className="lg:col-span-3">
          <CardHeader
            title="2. Scan it on the phone"
            hint={selected ? `${selected.brand} ${selected.model} for ${selected.customerName}` : 'Choose a phone to show its QR'}
            action={
              qr && (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-caption"
                  onClick={() => generate(qr.deviceId)}
                  disabled={generating}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} aria-hidden="true" /> New QR
                </button>
              )
            }
          />

          <div className="mt-5 grid items-start gap-6 md:grid-cols-[auto,1fr]">
            <div className="mx-auto w-full max-w-[18rem]">
              <div className="relative grid aspect-square place-items-center rounded-lg border-2 border-ink-900 bg-white p-3 shadow-[5px_5px_0_#0F1419]">
                {generating ? (
                  <Loader2 className="h-10 w-10 animate-spin text-ink-400" aria-label="Creating QR" />
                ) : qr?.image ? (
                  <img
                    src={qr.image}
                    alt="QR code to scan on the new phone"
                    className={`h-full w-full [image-rendering:pixelated] ${expired ? 'opacity-20' : ''}`}
                  />
                ) : (
                  <div className="text-center text-ink-400">
                    <QrCode className="mx-auto h-16 w-16" aria-hidden="true" />
                    <p className="mt-2 text-caption">The QR appears here</p>
                  </div>
                )}
                {expired && (
                  <button
                    type="button"
                    className="btn-primary absolute"
                    onClick={() => qr && generate(qr.deviceId)}
                  >
                    Expired, make a new QR
                  </button>
                )}
              </div>

              {qr && (
                <div className="mt-4 space-y-2">
                  {!expired && (
                    <button type="button" className="btn-primary w-full justify-center" onClick={() => setFullScreen(true)}>
                      <Maximize2 className="h-4 w-4" aria-hidden="true" /> Show QR full screen
                    </button>
                  )}
                  <p className="flex items-center justify-center gap-1.5 text-caption font-bold text-ink-700">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {expired ? 'This QR has expired' : `Valid for ${timeLeft(qr.expiresAt, now)}, one phone only`}
                  </p>
                  <button
                    type="button"
                    onClick={() => copy(qr.token)}
                    className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-paper-400 bg-paper-50 px-3 py-2 font-mono text-caption text-ink-700 hover:border-ink-900"
                    title="Copy the code, for typing in by hand"
                  >
                    {qr.token}
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              {qr && !qr.ready && (
                <div className="mt-3 flex gap-2 rounded-md border-2 border-critical-600 bg-critical-50 p-3 text-caption text-critical-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <b>This QR cannot set up a new phone yet.</b> {qr.warning}
                  </span>
                </div>
              )}
            </div>

            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-ink-900 bg-sun-100 text-ink-900">
                    <s.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-extrabold text-ink-900">
                      {i + 1}. {s.title}
                    </span>
                    <span className="block text-caption text-ink-700">{s.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </div>

      {/* Recent codes */}
      <Card flush>
        <div className="p-5 pb-3">
          <CardHeader title="Recent QR codes" hint="Each code works once, for the phone it was made for, for 2 hours" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body">
            <thead>
              <tr className="border-y-2 border-ink-900 bg-paper-200/60 text-micro font-extrabold uppercase tracking-[0.1em] text-ink-700">
                <th className="px-5 py-2.5">Phone and customer</th>
                <th className="px-3 py-2.5">Code</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Expires</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {loadingTokens && tokens.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-4">
                    <Skeleton className="h-8" />
                  </td>
                </tr>
              ) : tokens.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-caption text-ink-500">
                    No QR codes yet.
                  </td>
                </tr>
              ) : (
                tokens.map((t) => (
                  <tr key={t.id} className="hover:bg-sun-100/60">
                    <td className="px-5 py-3">
                      {t.deviceInfo && t.deviceInfo !== 'Unassigned' ? (
                        <>
                          <span className="block font-bold text-ink-900">{t.deviceInfo}</span>
                          {t.customerName && t.customerName !== 'Unassigned' && (
                            <span className="block text-caption text-ink-500">{t.customerName}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-400">Not linked to a phone (cannot be used)</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-caption text-ink-700">{t.token ?? '—'}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`status-pill ${
                          t.status === 'ENROLLED' ? 'status-active' : t.isExpired ? 'status-inactive' : 'status-pending'
                        }`}
                      >
                        {t.status === 'ENROLLED' ? 'Connected' : t.isExpired ? 'Expired' : 'Waiting for scan'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-caption text-ink-500">
                      {t.status === 'ENROLLED' || t.isExpired ? '—' : timeLeft(t.expiresAt, now)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.token && (
                        <button type="button" onClick={() => copy(t.token)} className="btn-ghost px-2 py-1" aria-label="Copy code">
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination
            pagination={paged.pagination}
            onPageChange={paged.setPage}
            onLimitChange={paged.setLimit}
            itemLabel="QR codes"
            disabled={loadingTokens}
          />
        </div>
      </Card>
      {fullScreen && qr?.image && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR code, full screen"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white p-4"
          onClick={() => setFullScreen(false)}
        >
          <img
            src={qr.image}
            alt="QR code to scan on the new phone"
            className="aspect-square w-[min(92vw,82vh)] [image-rendering:pixelated]"
          />
          <p className="text-center text-sm font-bold text-ink-900">
            Turn screen brightness up. Hold the phone 20 to 30 cm away, straight on. Tap anywhere to close.
          </p>
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full border-2 border-ink-900 bg-white p-2"
            aria-label="Close full screen QR"
            onClick={() => setFullScreen(false)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};

export default EnrollmentPage;
