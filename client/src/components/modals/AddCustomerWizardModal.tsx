import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, ApiService } from '../../services/api.js';
import {
  SaleErrors,
  SaleField,
  SALE_FIELD_ORDER,
  fieldsFromServer,
  validateSale,
} from '../../utils/saleValidation.js';
import { useAuth } from '../../context/AuthContext.js';
import { GoogleIdGuideModal } from './GoogleIdGuideModal.js';
import { SaleSignStep, SaleSignState } from '../contract/SaleSignStep.js';
import {
  X,
  User,
  Smartphone,
  CalendarDays,
  CheckCircle2,
  Copy,
  Maximize2,
  Wifi,
  Hand,
  RotateCcw,
  AlertTriangle,
  HelpCircle,
  UserCheck,
  Lock,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PHONE_BRANDS } from '../../utils/brands.js';
import { checkPhoneSupport, AndroidVersion } from '../../utils/phoneSupport.js';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type RecentModel = { brand: string; model: string; ramStorage: string; price: number };
type Returning = { name: string; phonesOnFile: number; overdueInstallments: number };

const MONTH_CHOICES = [3, 6, 9, 12];
const ADVANCE_CHOICES = [20, 25, 30];

/** An advance as a round figure: 25% of Rs 54,321 is Rs 13,600, not Rs 13,580. */
const advanceFor = (price: number, percent: number) => Math.round((price * percent) / 100 / 100) * 100;

const rupees = (n: number) => `Rs ${Math.max(0, Math.round(n)).toLocaleString('en-PK')}`;

const inAMonth = () => new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

/**
 * Registering a financed sale, on one page.
 *
 * The counter used to walk four screens and eighteen boxes for every phone.
 * Now: the CNIC comes first, and a customer already on file needs nothing
 * else typed; a model the shop sold recently is one tap; the advance and the
 * months are buttons; everything rarely changed is folded away. The figures
 * the customer is agreeing to stay in view the whole time, and one button
 * registers the sale.
 */
export const AddCustomerWizardModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const { selectedDealerId, showToast, isDealerAdmin, user } = useAuth();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  // Two taps on "Register" must not register two sales; state alone updates too late.
  const inFlight = useRef(false);
  const [createdResult, setCreatedResult] = useState<any>(null);
  // An older phone cannot read a small QR off a laptop screen.
  const [qrFull, setQrFull] = useState(false);
  const [signState, setSignState] = useState<SaleSignState>('loading');
  const [frpConfigured, setFrpConfigured] = useState<boolean | null>(null);
  const [showGoogleIdGuide, setShowGoogleIdGuide] = useState(false);
  const [recentModels, setRecentModels] = useState<RecentModel[]>([]);
  const [returning, setReturning] = useState<Returning | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    customerCnic: '',
    customerAddress: '',
    emergencyName: '',
    emergencyPhone: '',
    brand: 'Samsung',
    model: '',
    // Typed from the phone (*#06#). A made-up default never passes the
    // checksum the server applies, and would invite a wrong IMEI on record.
    imei: '',
    serialNumber: '',
    purchasePrice: 0,
    color: '',
    ramStorage: '',
    android: '11+' as AndroidVersion,
    playStore: true,
    downPayment: 0,
    totalInstallments: 6,
    firstDueDate: inAMonth(),
    gracePeriodDays: 3,
    qrType: 'STANDARD',
  });

  // Field-level problems, from the form check or from the server's 422 details.
  const [errors, setErrors] = useState<SaleErrors>({});

  const noDealer = user?.role === 'SUPER_ADMIN' && !selectedDealerId;
  const dealerParam = selectedDealerId || undefined;

  useEffect(() => {
    let cancelled = false;
    if (noDealer) {
      setFrpConfigured(null);
      return;
    }
    ApiService.getEnrollmentReadiness(dealerParam)
      .then((res) => {
        if (!cancelled) setFrpConfigured(res?.frpConfigured ?? null);
      })
      .catch(() => {
        if (!cancelled) setFrpConfigured(null);
      });
    // Recent models and the shop's own grace period. Only a convenience: the
    // form works the same without them.
    ApiService.getSaleHelper({ dealerId: dealerParam })
      .then((res) => {
        if (cancelled || !res) return;
        setRecentModels(res.recentModels ?? []);
        if (Number.isInteger(res.gracePeriodDays)) {
          setFormData((prev) => ({ ...prev, gracePeriodDays: res.gracePeriodDays }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dealerParam, noDealer]);

  // A full CNIC is looked up: a customer already on file needs nothing else typed.
  const cnicDigits = formData.customerCnic.replace(/\D/g, '');
  useEffect(() => {
    if (cnicDigits.length !== 13 || noDealer) {
      setReturning(null);
      return;
    }
    let cancelled = false;
    setLookingUp(true);
    const timer = setTimeout(() => {
      ApiService.getSaleHelper({ cnic: cnicDigits, dealerId: dealerParam })
        .then((res) => {
          if (cancelled) return;
          const found = res?.customer ?? null;
          setReturning(found);
          if (found) {
            setFormData((prev) => ({ ...prev, customerName: found.name }));
            setErrors((prev) => {
              const next = { ...prev };
              for (const f of ['customerName', 'customerPhone', 'customerAddress', 'emergencyName', 'emergencyPhone'] as const) {
                delete next[f];
              }
              return next;
            });
          }
        })
        .catch(() => {
          if (!cancelled) setReturning(null);
        })
        .finally(() => {
          if (!cancelled) setLookingUp(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setLookingUp(false);
    };
  }, [cnicDigits, dealerParam, noDealer]);

  /** Updates one box and clears its error, so the red goes away as the shop fixes it. */
  const setField = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key as SaleField]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as SaleField];
        return next;
      });
    }
  };

  /** A new price keeps the same share as the advance the shop had chosen. */
  const setPrice = (price: number) => {
    const percent = formData.purchasePrice > 0 ? (formData.downPayment / formData.purchasePrice) * 100 : 25;
    setField('purchasePrice', price);
    setField('downPayment', price > 0 ? advanceFor(price, ADVANCE_CHOICES.includes(Math.round(percent)) ? Math.round(percent) : 25) : 0);
  };

  const pickModel = (m: RecentModel) => {
    setFormData((prev) => ({
      ...prev,
      brand: m.brand,
      model: m.model,
      ramStorage: m.ramStorage || prev.ramStorage,
      purchasePrice: m.price,
      downPayment: advanceFor(m.price, 25),
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.model;
      delete next.purchasePrice;
      delete next.downPayment;
      return next;
    });
  };

  const financedAmount = formData.purchasePrice - formData.downPayment;
  const monthlyAmount = Math.round(financedAmount / (formData.totalInstallments || 1));
  const advancePercent =
    formData.purchasePrice > 0 ? Math.round((formData.downPayment / formData.purchasePrice) * 100) : 0;

  // Checked at the counter, before the customer leaves with the phone: a
  // handset that cannot run the lock app is still a sale, just without a lock.
  const support = checkPhoneSupport({ brand: formData.brand, android: formData.android, playStore: formData.playStore });
  const noLock = support.level === 'none';
  const isApple = formData.brand === 'Apple';

  const showProblems = (problems: SaleErrors, message?: string) => {
    setErrors(problems);
    showToast(message || 'Please fix the fields marked in red.', 'error');
    const first = SALE_FIELD_ORDER.find((f) => problems[f]);
    if (first) {
      const el = document.getElementById(`sale-${first}`);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      (el as HTMLInputElement | null)?.focus?.({ preventScroll: true });
    }
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;
    const problems = validateSale(formData, { returningCustomer: !!returning });
    if (Object.keys(problems).length > 0) {
      showProblems(problems);
      return;
    }
    try {
      inFlight.current = true;
      setSubmitting(true);
      const payload = {
        // A super admin works inside the shop picked at the top; without this the
        // server cannot tell which shop the sale belongs to and refuses it.
        dealerId: dealerParam,
        // A returning customer's details are on file: the server uses those.
        customer: returning
          ? { name: formData.customerName, cnic: formData.customerCnic }
          : {
              name: formData.customerName,
              phone: formData.customerPhone,
              cnic: formData.customerCnic,
              address: formData.customerAddress,
              emergencyContactName: formData.emergencyName,
              emergencyContactPhone: formData.emergencyPhone,
            },
        device: {
          brand: formData.brand,
          model: formData.model,
          imei: formData.imei.replace(/\D/g, ''),
          serialNumber: formData.serialNumber,
          purchasePrice: formData.purchasePrice,
          ...(formData.color.trim() ? { color: formData.color.trim() } : {}),
          ...(formData.ramStorage.trim() ? { ramStorage: formData.ramStorage.trim() } : {}),
        },
        plan: {
          downPayment: formData.downPayment,
          totalInstallments: formData.totalInstallments,
          firstDueDate: formData.firstDueDate,
          gracePeriodDays: formData.gracePeriodDays,
        },
        qrType: formData.qrType,
        noLock,
      };

      const res = await ApiService.createCustomerWithDevice(payload);
      setCreatedResult(res);
      showToast(noLock ? 'Sale registered without a lock.' : 'Sale registered. Scan the QR on the phone.', 'success');
    } catch (err: any) {
      // A 422 names each bad field: mark it and take the shop to it, instead of
      // a bare "not valid" that points nowhere.
      const serverErrors = err instanceof ApiError ? fieldsFromServer(err.details) : {};
      if (Object.keys(serverErrors).length > 0) {
        showProblems(serverErrors, Object.values(serverErrors)[0]);
      } else {
        const detail = err instanceof ApiError ? err.details?.map((d) => d.message).join(' ') : '';
        showToast(detail || err.message || 'Failed to create record', 'error');
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const copyTokenToClipboard = () => {
    if (createdResult?.enrollmentToken?.token) {
      navigator.clipboard.writeText(createdResult.enrollmentToken.token);
      showToast('Enrollment code copied to clipboard!', 'info');
    }
  };

  // --------------------------------------------------------------- pieces

  const fieldError = (field: SaleField) =>
    errors[field] ? (
      <p role="alert" className="mt-1.5 flex items-start gap-1 text-caption font-semibold text-critical-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{errors[field]}</span>
      </p>
    ) : null;

  const inputClass = (field: SaleField, extra = '') =>
    `input ${extra} ${errors[field] ? '!border-critical-600 bg-critical-50/60' : ''}`;

  const chip = (active: boolean) =>
    `rounded-md border-2 border-ink-900 px-3 py-1.5 text-body font-extrabold transition ${
      active ? 'bg-sun-200 shadow-[2px_2px_0_#0F1419]' : 'bg-white hover:bg-sun-100'
    }`;

  const section = (num: number, icon: React.ReactNode, title: string, hint: string, body: React.ReactNode) => (
    <section className="surface p-5 sm:p-6" aria-labelledby={`sale-section-${num}`}>
      <header className="mb-5 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-ink-900 bg-sun-400 font-display text-lede font-black text-ink-900">
          {num}
        </span>
        <div className="min-w-0">
          <h3 id={`sale-section-${num}`} className="flex items-center gap-2 font-display text-title font-black text-ink-900">
            {icon}
            <span>{title}</span>
          </h3>
          <p className="mt-0.5 text-caption text-ink-500">{hint}</p>
        </div>
      </header>
      {body}
    </section>
  );

  // --------------------------------------------------------------- done

  if (createdResult) {
    // The QR waits for the signature (or a deliberate "Sign later"): a phone
    // enrolled with an unsigned agreement is a phone the shop cannot lock.
    const showQr = !createdResult.contractId || signState === 'signed' || signState === 'later';
    const signStep = createdResult.contractId ? (
      <SaleSignStep contractId={createdResult.contractId} onStateChange={setSignState} />
    ) : null;

    return createPortal(
      <div className="fixed inset-0 z-50 overflow-y-auto bg-paper-100 animate-fade-in">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {!createdResult.enrollmentToken ? (
            <div className="surface p-6 text-center sm:p-8">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border-2 border-ink-900 bg-mint-100">
                <CheckCircle2 className="h-7 w-7 text-positive-700" />
              </div>
              <h2 className="mt-4 font-display text-display font-black text-ink-900">Sale registered without a lock</h2>
              <p className="mx-auto mt-2 max-w-md text-body text-ink-500">
                No QR is needed for this phone. Get the agreement signed from the customer's page; installments and
                reminders run as usual.
              </p>
              {signStep && <div className="mt-6 text-start">{signStep}</div>}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onSuccess();
                    navigate(`/customers/${createdResult.customer?.id}`);
                  }}
                  className="btn-primary"
                >
                  Open customer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSuccess();
                    onClose();
                  }}
                  className="btn-secondary"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="surface space-y-6 p-6 sm:p-8">
              <div className="text-center">
                <p className="eyebrow">Sale registered</p>
                <h2 className="mt-1 font-display text-display font-black text-ink-900">Scan this QR on the customer's phone</h2>
                <p className="mt-1 text-body text-ink-500">
                  {formData.brand} {formData.model} for {formData.customerName}. Valid for 1 hour, this phone only.
                </p>
              </div>

              {signStep}

              {showQr && (
              <>

              <div className="grid items-center gap-6 sm:grid-cols-[auto,1fr]">
                {/* The real code: the server renders it, the dashboard never draws one */}
                <div className="mx-auto">
                  {createdResult.qrImageDataUrl ? (
                    <button
                      type="button"
                      onClick={() => setQrFull(true)}
                      title="Show full screen"
                      className="block rounded-lg border-2 border-ink-900 bg-white p-2 shadow-raised transition-transform hover:-translate-y-0.5"
                    >
                      <img
                        src={createdResult.qrImageDataUrl}
                        alt="QR code to scan on the new phone"
                        className="h-56 w-56 [image-rendering:pixelated]"
                      />
                    </button>
                  ) : (
                    <div className="well grid h-56 w-56 place-items-center p-4 text-center text-caption text-ink-500">
                      Open the QR Enrollment page to show this phone's QR.
                    </div>
                  )}
                </div>

                <ol className="space-y-4 text-body">
                  {[
                    { icon: <RotateCcw className="h-4 w-4" />, title: 'Factory reset the phone', hint: 'Stop on the first Welcome screen.' },
                    { icon: <Hand className="h-4 w-4" />, title: 'Tap 6 times on one blank spot', hint: 'Away from the Start button. A QR scanner opens.' },
                    { icon: <Wifi className="h-4 w-4" />, title: 'Connect Wi-Fi, then scan', hint: 'Show the QR full screen, brightness up, phone 20 to 30 cm away.' },
                  ].map((s) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-ink-900 bg-sun-200 text-ink-900">
                        {s.icon}
                      </span>
                      <span>
                        <strong className="block text-ink-900">{s.title}</strong>
                        <span className="text-caption text-ink-500">{s.hint}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {createdResult.qrProvisioningReady === false && (
                <div className="flex gap-2 rounded-md border-2 border-critical-200 bg-critical-50 p-3 text-caption text-critical-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>The app download is not set up on this server, so this QR cannot install the app yet.</span>
                </div>
              )}

              {frpConfigured === false && (
                <div className="flex flex-col justify-between gap-2 rounded-md border-2 border-caution-200 bg-caution-50 p-3 text-caption text-caution-700 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>Factory Reset Protection is off:</strong> add your shop&apos;s Google Account ID in Settings
                      before handing over this phone.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGoogleIdGuide(true)}
                    className="btn-secondary shrink-0 self-start px-2.5 py-1 text-caption sm:self-auto"
                  >
                    <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>How to get Google Account ID</span>
                  </button>
                </div>
              )}

              <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                {createdResult.qrImageDataUrl && (
                  <button type="button" onClick={() => setQrFull(true)} className="btn-primary">
                    <Maximize2 className="h-4 w-4" /> Show QR full screen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onSuccess();
                    navigate(`/enrollment?device=${createdResult.device?.id}`);
                  }}
                  className="btn-secondary"
                >
                  Open QR page
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSuccess();
                    onClose();
                  }}
                  className="btn-ghost"
                >
                  Done
                </button>
              </div>

              <button
                type="button"
                onClick={copyTokenToClipboard}
                className="mx-auto flex items-center gap-2 font-mono text-caption text-ink-500 hover:text-ink-900"
                title="Copy the code, for typing in by hand"
              >
                Code: {createdResult.enrollmentToken?.token} <Copy className="h-3.5 w-3.5" />
              </button>
              </>
              )}
            </div>
          )}
        </div>

        {qrFull && createdResult.qrImageDataUrl && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="QR code, full screen"
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white p-4"
            onClick={() => setQrFull(false)}
          >
            <img
              src={createdResult.qrImageDataUrl}
              alt="QR code to scan on the new phone"
              className="aspect-square w-[min(92vw,82vh)] [image-rendering:pixelated]"
            />
            <p className="text-center text-body font-bold text-ink-900">
              Brightness up. Hold the phone 20 to 30 cm away, straight on. Tap anywhere to close.
            </p>
            <button
              type="button"
              className="absolute end-4 top-4 rounded-full border-2 border-ink-900 bg-white p-2"
              aria-label="Close full screen QR"
              onClick={() => setQrFull(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <GoogleIdGuideModal
          isOpen={showGoogleIdGuide}
          onClose={() => setShowGoogleIdGuide(false)}
          onGoToSettings={
            isDealerAdmin
              ? () => {
                  onClose();
                  navigate('/settings');
                }
              : undefined
          }
        />
      </div>,
      document.body
    );
  }

  // --------------------------------------------------------------- the form

  const submitLabel = submitting ? 'Registering…' : noLock ? 'Register sale' : 'Register sale & show QR';

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper-100 animate-fade-in" role="dialog" aria-modal="true" aria-label="New sale">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b-2 border-ink-900 bg-paper-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow">New sale</p>
            <h2 className="truncate font-display text-title font-black text-ink-900 sm:text-display">Sell a phone on installments</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary px-2.5" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <form
        noValidate
        onSubmit={handleCreate}
        className="mx-auto grid max-w-6xl gap-6 px-4 pb-32 pt-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-10"
      >
        <div className="space-y-6">
          {/* 1 — Customer */}
          {section(
            1,
            <User className="h-5 w-5" aria-hidden="true" />,
            'Customer',
            'Start with the CNIC. A customer who bought from you before fills in by itself.',
            <div className="space-y-4">
              <div>
                <label htmlFor="sale-customerCnic" className="field-label">CNIC number</label>
                <input
                  id="sale-customerCnic"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="35202-1234567-1"
                  value={formData.customerCnic}
                  onChange={(e) => setField('customerCnic', e.target.value)}
                  aria-invalid={!!errors.customerCnic}
                  className={inputClass('customerCnic', 'font-mono text-lede tracking-wide')}
                />
                {fieldError('customerCnic')}
                {lookingUp && <p className="mt-1.5 text-caption text-ink-400">Checking your customers…</p>}
              </div>

              {returning && (
                <div role="status" className="rounded-md border-2 border-ink-900 bg-mint-100 p-4">
                  <div className="flex items-start gap-3">
                    <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive-700" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-ink-900">Returning customer</p>
                      <p className="mt-0.5 text-lede font-black text-ink-900" data-i18n-skip>{returning.name}</p>
                      <p className="mt-1 text-caption text-ink-700">
                        <span>{returning.phonesOnFile}</span> <span>phone(s) already with your shop.</span>{' '}
                        <span>Address and numbers are on file — nothing to retype.</span>
                      </p>
                      {returning.overdueInstallments > 0 && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-md border-2 border-caution-200 bg-caution-50 p-2 text-caption font-semibold text-caution-700">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            <span>{returning.overdueInstallments}</span>{' '}
                            <span>installment(s) overdue on an earlier phone. Check before selling another.</span>
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className={returning ? 'sm:col-span-2' : ''}>
                  <label htmlFor="sale-customerName" className="field-label">Full name</label>
                  <input
                    id="sale-customerName"
                    placeholder="e.g. Muhammad Aslam"
                    value={formData.customerName}
                    readOnly={!!returning}
                    onChange={(e) => setField('customerName', e.target.value)}
                    aria-invalid={!!errors.customerName}
                    className={inputClass('customerName', returning ? 'bg-paper-200' : '')}
                  />
                  {fieldError('customerName')}
                </div>

                {!returning && (
                  <>
                    <div>
                      <label htmlFor="sale-customerPhone" className="field-label">Mobile number</label>
                      <input
                        id="sale-customerPhone"
                        inputMode="tel"
                        placeholder="0300-1234567"
                        value={formData.customerPhone}
                        onChange={(e) => setField('customerPhone', e.target.value)}
                        aria-invalid={!!errors.customerPhone}
                        className={inputClass('customerPhone', 'font-mono')}
                      />
                      {fieldError('customerPhone')}
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="sale-customerAddress" className="field-label">Home address</label>
                      <input
                        id="sale-customerAddress"
                        placeholder="House / Street / City"
                        value={formData.customerAddress}
                        onChange={(e) => setField('customerAddress', e.target.value)}
                        aria-invalid={!!errors.customerAddress}
                        className={inputClass('customerAddress')}
                      />
                      {fieldError('customerAddress')}
                    </div>

                    <div>
                      <label htmlFor="sale-emergencyName" className="field-label">Emergency contact</label>
                      <input
                        id="sale-emergencyName"
                        placeholder="e.g. Asif Aslam (Brother)"
                        value={formData.emergencyName}
                        onChange={(e) => setField('emergencyName', e.target.value)}
                        aria-invalid={!!errors.emergencyName}
                        className={inputClass('emergencyName')}
                      />
                      {fieldError('emergencyName')}
                    </div>

                    <div>
                      <label htmlFor="sale-emergencyPhone" className="field-label">Emergency number</label>
                      <input
                        id="sale-emergencyPhone"
                        inputMode="tel"
                        placeholder="0321-7654321"
                        value={formData.emergencyPhone}
                        onChange={(e) => setField('emergencyPhone', e.target.value)}
                        aria-invalid={!!errors.emergencyPhone}
                        className={inputClass('emergencyPhone', 'font-mono')}
                      />
                      {fieldError('emergencyPhone')}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 2 — Phone */}
          {section(
            2,
            <Smartphone className="h-5 w-5" aria-hidden="true" />,
            'The phone',
            'Tap a model you sold recently, or type it. Dial *#06# on the phone for the IMEI.',
            <div className="space-y-4">
              {recentModels.length > 0 && (
                <div>
                  <p className="field-label">Sold recently</p>
                  <div className="flex flex-wrap gap-2">
                    {recentModels.map((m) => {
                      const active = formData.brand === m.brand && formData.model === m.model;
                      return (
                        <button
                          key={`${m.brand}|${m.model}`}
                          type="button"
                          aria-pressed={active}
                          onClick={() => pickModel(m)}
                          className={`${chip(active)} text-start`}
                        >
                          <span className="block leading-tight" data-i18n-skip>{m.brand} {m.model}</span>
                          <span className="block text-micro font-bold text-ink-500">{rupees(m.price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sale-brand" className="field-label">Brand</label>
                  <select
                    id="sale-brand"
                    value={formData.brand}
                    onChange={(e) => setField('brand', e.target.value)}
                    className="input"
                  >
                    {PHONE_BRANDS.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sale-model" className="field-label">Model</label>
                  <input
                    id="sale-model"
                    placeholder="e.g. Galaxy A15 / Spark 20"
                    value={formData.model}
                    onChange={(e) => setField('model', e.target.value)}
                    aria-invalid={!!errors.model}
                    className={inputClass('model')}
                  />
                  {fieldError('model')}
                </div>

                <div>
                  <label htmlFor="sale-imei" className="field-label">IMEI (15 digits)</label>
                  <input
                    id="sale-imei"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="15-digit IMEI"
                    value={formData.imei}
                    onChange={(e) => setField('imei', e.target.value)}
                    aria-invalid={!!errors.imei}
                    className={inputClass('imei', 'font-mono tracking-wide')}
                  />
                  {fieldError('imei')}
                </div>

                <div>
                  <label htmlFor="sale-purchasePrice" className="field-label">Phone price (Rs)</label>
                  <input
                    id="sale-purchasePrice"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="e.g. 54000"
                    value={formData.purchasePrice || ''}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    aria-invalid={!!errors.purchasePrice}
                    className={inputClass('purchasePrice', 'font-black text-lede')}
                  />
                  {fieldError('purchasePrice')}
                </div>
              </div>

              {/* Can this handset take the lock? Two taps, answered on the spot. */}
              <div className="rounded-md border-2 border-paper-300 bg-paper-100 p-4">
                <p className="eyebrow">Phone check</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <fieldset disabled={isApple} className="disabled:opacity-50">
                    <legend className="field-label">Android version</legend>
                    <div className="flex flex-wrap gap-2">
                      {([
                        ['11+', '11 or newer'],
                        ['8-10', '8 – 10'],
                        ['7-', '7 or older'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={formData.android === value}
                          onClick={() => setField('android', value)}
                          className={chip(formData.android === value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset disabled={isApple} className="disabled:opacity-50">
                    <legend className="field-label">Google Play Store</legend>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-pressed={formData.playStore}
                        onClick={() => setField('playStore', true)}
                        className={chip(formData.playStore)}
                      >
                        Play Store works
                      </button>
                      <button
                        type="button"
                        aria-pressed={!formData.playStore}
                        onClick={() => setField('playStore', false)}
                        className={chip(!formData.playStore)}
                      >
                        No Play Store
                      </button>
                    </div>
                  </fieldset>
                </div>

                <div
                  role="status"
                  className={`mt-4 rounded-md border-2 p-3 text-caption leading-relaxed ${
                    support.level === 'full'
                      ? 'border-positive-200 bg-positive-50 text-positive-700'
                      : support.level === 'partial'
                        ? 'border-caution-200 bg-caution-50 text-caution-700'
                        : 'border-critical-200 bg-critical-50 text-critical-700'
                  }`}
                >
                  <p className="font-extrabold">
                    {support.level === 'full' ? '✓ ' : support.level === 'partial' ? '! ' : '✕ '}
                    {support.title}
                  </p>
                  <p className="mt-0.5">{support.detail}</p>
                  {noLock && (
                    <p className="mt-1.5 font-bold">
                      No lock will be used and no QR is needed. Take a larger advance or a guarantor for this sale.
                    </p>
                  )}
                </div>

                {!noLock && frpConfigured === false && (
                  <div className="mt-3 space-y-2 rounded-md border-2 border-caution-200 bg-caution-50 p-3 text-caption text-caution-700">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-extrabold">Factory Reset Protection is off for this shop</p>
                        <p className="mt-0.5">
                          Without a shop Google Account ID saved in Settings, a recovery-mode reset can erase the lock app
                          without asking for your shop account.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 ps-6">
                      <button
                        type="button"
                        onClick={() => setShowGoogleIdGuide(true)}
                        className="btn-secondary px-2.5 py-1 text-caption"
                      >
                        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>How to get Google Account ID</span>
                      </button>
                      {isDealerAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            navigate('/settings');
                          }}
                          className="btn-primary px-2.5 py-1 text-caption"
                        >
                          Open Settings
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <details className="group rounded-md border-2 border-paper-300 bg-white" open={!!(errors.serialNumber || errors.ramStorage)}>
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-body font-bold text-ink-700">
                  <span>More phone details (optional)</span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="grid gap-4 border-t-2 border-paper-300 p-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="sale-serialNumber" className="field-label">Serial number</label>
                    <input
                      id="sale-serialNumber"
                      value={formData.serialNumber}
                      onChange={(e) => setField('serialNumber', e.target.value)}
                      aria-invalid={!!errors.serialNumber}
                      className={inputClass('serialNumber', 'font-mono')}
                    />
                    {fieldError('serialNumber')}
                  </div>
                  <div>
                    <label htmlFor="sale-ramStorage" className="field-label">RAM / storage</label>
                    <input
                      id="sale-ramStorage"
                      placeholder="e.g. 8GB / 128GB"
                      value={formData.ramStorage}
                      onChange={(e) => setField('ramStorage', e.target.value)}
                      aria-invalid={!!errors.ramStorage}
                      className={inputClass('ramStorage')}
                    />
                    {fieldError('ramStorage')}
                  </div>
                  <div>
                    <label htmlFor="sale-color" className="field-label">Colour</label>
                    <input
                      id="sale-color"
                      placeholder="e.g. Black"
                      value={formData.color}
                      onChange={(e) => setField('color', e.target.value)}
                      className="input"
                    />
                  </div>
                </div>
              </details>
            </div>
          )}

          {/* 3 — Plan */}
          {section(
            3,
            <CalendarDays className="h-5 w-5" aria-hidden="true" />,
            'Installment plan',
            'Tap the advance and the months. The monthly amount works itself out.',
            <div className="space-y-5">
              <div>
                <label htmlFor="sale-downPayment" className="field-label">Advance (Rs)</label>
                <div className="flex flex-wrap items-center gap-2">
                  {ADVANCE_CHOICES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={!formData.purchasePrice}
                      aria-pressed={formData.purchasePrice > 0 && formData.downPayment === advanceFor(formData.purchasePrice, p)}
                      onClick={() => setField('downPayment', advanceFor(formData.purchasePrice, p))}
                      className={`${chip(formData.purchasePrice > 0 && formData.downPayment === advanceFor(formData.purchasePrice, p))} disabled:opacity-40`}
                    >
                      {p}%
                    </button>
                  ))}
                  <input
                    id="sale-downPayment"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={formData.downPayment || ''}
                    placeholder="0"
                    onChange={(e) => setField('downPayment', Number(e.target.value))}
                    aria-invalid={!!errors.downPayment}
                    className={inputClass('downPayment', 'w-40 font-black')}
                  />
                </div>
                {fieldError('downPayment')}
              </div>

              <div>
                <p className="field-label" id="sale-months-label">Months</p>
                <div id="sale-totalInstallments" role="group" aria-labelledby="sale-months-label" className="flex flex-wrap gap-2" tabIndex={-1}>
                  {MONTH_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={formData.totalInstallments === m}
                      onClick={() => setField('totalInstallments', m)}
                      className={`${chip(formData.totalInstallments === m)} min-w-[4.5rem]`}
                    >
                      <span>{m}</span> <span>months</span>
                    </button>
                  ))}
                </div>
                {fieldError('totalInstallments')}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sale-firstDueDate" className="field-label">First installment due</label>
                  <input
                    id="sale-firstDueDate"
                    type="date"
                    value={formData.firstDueDate}
                    onChange={(e) => setField('firstDueDate', e.target.value)}
                    aria-invalid={!!errors.firstDueDate}
                    className={inputClass('firstDueDate')}
                  />
                  {fieldError('firstDueDate')}
                </div>
                <div>
                  <label htmlFor="sale-gracePeriodDays" className="field-label">Grace period (days)</label>
                  <input
                    id="sale-gracePeriodDays"
                    type="number"
                    min={0}
                    max={30}
                    value={formData.gracePeriodDays}
                    onChange={(e) => setField('gracePeriodDays', Number(e.target.value))}
                    aria-invalid={!!errors.gracePeriodDays}
                    className={inputClass('gracePeriodDays')}
                  />
                  <p className="mt-1 text-micro text-ink-400">From your shop settings. Days after the due date before any restriction.</p>
                  {fieldError('gracePeriodDays')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary — what the customer is agreeing to, always in view */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="surface overflow-hidden">
            <div className="border-b-2 border-ink-900 bg-accent-800 px-5 py-4 text-white">
              <p className="text-micro font-extrabold uppercase tracking-[0.12em] text-sun-200">Monthly installment</p>
              <p className="mt-1 font-display text-figure font-black tabular-nums" aria-live="polite">
                {rupees(monthlyAmount)}
              </p>
              <p className="text-caption text-accent-100">
                <span>×</span> <span>{formData.totalInstallments}</span> <span>months</span>
              </p>
            </div>
            <dl className="space-y-2.5 px-5 py-4 text-body">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">The phone</dt>
                <dd className="truncate text-end font-bold text-ink-900" data-i18n-skip>
                  {formData.model ? `${formData.brand} ${formData.model}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Price</dt>
                <dd className="font-bold text-ink-900">{rupees(formData.purchasePrice)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Advance</dt>
                <dd className="font-bold text-ink-900">
                  {rupees(formData.downPayment)}
                  {advancePercent > 0 && <span className="ms-1 text-caption font-semibold text-ink-400">({advancePercent}%)</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t-2 border-dashed border-paper-300 pt-2.5">
                <dt className="text-ink-500">To pay in installments</dt>
                <dd className="font-black text-ink-900">{rupees(financedAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">First due</dt>
                <dd className="font-bold text-ink-900">{formData.firstDueDate || '—'}</dd>
              </div>
            </dl>

            <div className="px-5 pb-5">
              <p
                className={`mb-3 flex items-center gap-2 rounded-md border-2 px-3 py-2 text-caption font-bold ${
                  noLock ? 'border-paper-300 bg-paper-200 text-ink-700' : 'border-positive-200 bg-positive-50 text-positive-700'
                }`}
              >
                {noLock ? <ShieldCheck className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                <span>{noLock ? 'Sold without a lock' : 'Phone lock: on, with a signed agreement'}</span>
              </p>
              <button type="submit" disabled={submitting} className="btn-primary hidden w-full py-3 text-lede lg:inline-flex">
                {submitLabel}
              </button>
              <p className="mt-3 text-micro leading-relaxed text-ink-400">
                {noLock
                  ? 'The plan, reminders and the signed agreement apply as usual.'
                  : 'The phone can be restricted only after the grace period, and only once the customer has signed. Emergency calls always work.'}
              </p>
            </div>
          </div>
        </aside>

        {/* Phones and tablets: the total and the button stay at the bottom of the screen */}
        <div className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-ink-900 bg-paper-50 px-4 py-3 lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Monthly</p>
              <p className="font-display text-title font-black text-ink-900">{rupees(monthlyAmount)}</p>
            </div>
            <button type="submit" disabled={submitting} className="btn-primary py-2.5">
              {submitLabel}
            </button>
          </div>
        </div>
      </form>

      <GoogleIdGuideModal
        isOpen={showGoogleIdGuide}
        onClose={() => setShowGoogleIdGuide(false)}
        onGoToSettings={
          isDealerAdmin
            ? () => {
                onClose();
                navigate('/settings');
              }
            : undefined
        }
      />
    </div>,
    document.body
  );
};
