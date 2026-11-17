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
import { SignaturePad } from '../contract/SignaturePad.js';
import { ImeiScanButton } from './ImeiScanButton.js';
import { CnicScanButton } from './CnicScanButton.js';
import { PhoneIntakeScan } from './PhoneIntakeScan.js';
import {
  X,
  User,
  Smartphone,
  CalendarDays,
  CheckCircle2,
  Maximize2,
  AlertTriangle,
  HelpCircle,
  UserCheck,
  Lock,
  FileText,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PHONE_BRANDS } from '../../utils/brands.js';
import { checkPhoneSupport, AndroidVersion } from '../../utils/phoneSupport.js';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  startWithPhoneScan?: boolean;
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
export const AddCustomerWizardModal: React.FC<Props> = ({ onClose, onSuccess, startWithPhoneScan = false }) => {
  const { selectedDealerId, showToast, isDealerAdmin, user } = useAuth();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  // Two taps on "Register" must not register two sales; state alone updates too late.
  const inFlight = useRef(false);
  const [createdResult, setCreatedResult] = useState<any>(null);
  // An older phone cannot read a small QR off a laptop screen.
  const [qrFull, setQrFull] = useState(false);
  const [agreement, setAgreement] = useState<any>(null);
  const [agreementError, setAgreementError] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [readAgreement, setReadAgreement] = useState(false);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [frpConfigured, setFrpConfigured] = useState<boolean | null>(null);
  const [showGoogleIdGuide, setShowGoogleIdGuide] = useState(false);
  const [recentModels, setRecentModels] = useState<RecentModel[]>([]);
  const [returning, setReturning] = useState<Returning | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [phoneIntakeId, setPhoneIntakeId] = useState<string>();
  const [phoneScanPending, setPhoneScanPending] = useState(false);
  const [scannedOsVersion, setScannedOsVersion] = useState<string>();

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

  useEffect(() => { setPhoneIntakeId(undefined); setScannedOsVersion(undefined); setPhoneScanPending(false); }, [dealerParam]);

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
  const monthlyAmount = createdResult?.plan?.monthlyInstallment ?? agreement?.snapshot?.plan?.monthlyInstallment ?? Math.round(financedAmount / (formData.totalInstallments || 1));
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


  const salePayload = () => ({
        phoneIntakeId,
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
          ...(scannedOsVersion ? { osVersion: scannedOsVersion } : {}),
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
  });
  const previewInput = JSON.stringify(salePayload());
  const previewReady = !noDealer && !phoneScanPending && Object.keys(validateSale(formData, { returningCustomer: !!returning })).length === 0;
  useEffect(() => {
    if (createdResult) return;
    let cancelled = false;
    setAgreement(null); setSignature(null); setAccepted(false); setAgreementError('');
    if (!previewReady) return;
    const timer = setTimeout(() => {
      ApiService.previewSaleAgreement(JSON.parse(previewInput)).then(doc => {
        if (!cancelled) setAgreement({ ...doc, input: previewInput });
      }).catch(error => { if (!cancelled) setAgreementError(error.message || 'Could not load the agreement.'); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [previewInput, previewReady, previewRefresh, createdResult]);

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current || createdResult) return;
    if (phoneScanPending) { showToast('Wait for the phone details or cancel the phone scan before registering.', 'error'); return; }
    const problems = validateSale(formData, { returningCustomer: !!returning });
    if (Object.keys(problems).length > 0) {
      showProblems(problems);
      return;
    }
    if (!agreement || agreement.input !== previewInput || !signature || !accepted) {
      showToast('Ask the customer to sign and accept the agreement in this card.', 'error');
      document.getElementById('sale-agreement')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      inFlight.current = true;
      setSubmitting(true);


      const res = await ApiService.createCustomerWithDevice({ ...salePayload(), agreement: {
        signerName: formData.customerName.trim(), signatureImage: signature, declarationAccepted: true,
        termsVersion: agreement.termsVersion, fingerprint: agreement.fingerprint,
      } });
      setCreatedResult(res);
      showToast('Sale and signed agreement saved.', 'success');
    } catch (err: any) {
      if (err.message?.includes('agreement details changed')) setPreviewRefresh(value => value + 1);
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

  // --------------------------------------------------------------- the form

  const submitLabel = submitting ? 'Saving sale…' : phoneIntakeId || noLock ? 'Save signed sale' : 'Save signed sale & show QR';

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
        className="mx-auto grid max-w-6xl gap-6 px-4 pb-10 pt-6 lg:grid-cols-[minmax(0,1fr)_380px]"
      >
        <fieldset disabled={submitting || !!createdResult} className="min-w-0 space-y-6">
          {/* 1 — Customer */}
          {section(
            1,
            <User className="h-5 w-5" aria-hidden="true" />,
            'Customer',
            'Start with the CNIC. A customer who bought from you before fills in by itself.',
            <div className="space-y-4">
              <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="sale-customerCnic" className="field-label">CNIC number</label>
                    <CnicScanButton onApply={fields => {
                      setFormData(prev => ({ ...prev, customerCnic: fields.cnic,
                        ...(fields.name ? { customerName: fields.name } : {}),
                        ...(fields.address ? { customerAddress: fields.address } : {}),
                      }));
                      setErrors(prev => { const next = { ...prev }; delete next.customerCnic; if (fields.name) delete next.customerName; if (fields.address) delete next.customerAddress; return next; });
                    }} />
                  </div>
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
              <PhoneIntakeScan key={dealerParam || 'current'} dealerId={dealerParam} disabled={noDealer || submitting} autoStart={startWithPhoneScan}
                onPending={setPhoneScanPending}
                onClear={() => { setPhoneIntakeId(undefined); setScannedOsVersion(undefined); }}
                onPhone={(id, phone) => {
                  const brand = PHONE_BRANDS.find(b => b.value.toLowerCase() === phone.brand.toLowerCase())?.value || phone.brand;
                  const version = Number.parseInt(phone.osVersion || '', 10);
                  setPhoneIntakeId(id); setScannedOsVersion(phone.osVersion);
                  setFormData(prev => ({ ...prev, brand, model: phone.model,
                    imei: phone.imeis?.[0] || '', serialNumber: phone.serialNumber || '',
                    android: Number.isFinite(version) ? version >= 11 ? '11+' : version >= 8 ? '8-10' : '7-' : prev.android,
                  }));
                  setErrors(prev => { const next = { ...prev }; delete next.model; delete next.imei; return next; });
                  showToast('Phone details received. Review the IMEI and serial before registering.', 'success');
                }} />
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
                    {!PHONE_BRANDS.some(b => b.value === formData.brand) && <option value={formData.brand}>{formData.brand}</option>}
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
                  <div className="flex flex-wrap items-stretch gap-2">
                    <input
                      id="sale-imei"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="15-digit IMEI"
                      value={formData.imei}
                      onChange={(e) => setField('imei', e.target.value)}
                      aria-invalid={!!errors.imei}
                      className={inputClass('imei', 'font-mono tracking-wide min-w-0 flex-1')}
                    />
                    <ImeiScanButton onScan={(imei) => setField('imei', imei)} />
                  </div>
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
        </fieldset>

        {/* Summary, signature and completion stay together in this card. */}
        <aside className="min-w-0 lg:self-start">
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
              {createdResult ? (
                <div className="space-y-4" role="status">
                  <p className="flex items-center gap-2 font-bold text-positive-700"><CheckCircle2 className="h-5 w-5 shrink-0" /> Sale and signed agreement saved.</p>
                  {phoneIntakeId && <p className="text-caption">Your scanned phone is linked. Keep it online; no second QR is needed.</p>}
                  {!phoneIntakeId && !noLock && <div className="space-y-3">
                    <p className="font-bold">Scan this QR on the customer's phone</p>
                    {createdResult.qrImageDataUrl && <button type="button" className="mx-auto block rounded-lg bg-white p-2" onClick={() => setQrFull(true)} aria-label="Show QR full screen"><img className="mx-auto aspect-square w-56 max-w-full" src={createdResult.qrImageDataUrl} alt="QR code to scan on the new phone" /><span className="mt-2 flex items-center justify-center gap-1 text-caption"><Maximize2 className="h-3 w-3" /> Full screen</span></button>}
                    {createdResult.qrProvisioningReady === false && <p role="alert" className="text-caption text-critical-700">The app download is not set up on this server, so this QR cannot install the app yet.</p>}
                    <p className="text-caption">On the new or already-reset phone, scan from the Welcome screen and complete Android setup.</p>
                  </div>}
                  <button type="button" className="btn-primary w-full" onClick={() => { onSuccess(); onClose(); }}>Done</button>
                </div>
              ) : <div id="sale-agreement" className="space-y-3 border-t-2 border-paper-300 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-ink-900">Customer signature</h3>
                  <button type="button" disabled={!agreement || submitting} className="inline-flex items-center gap-1 text-caption font-bold underline disabled:opacity-40" onClick={() => setReadAgreement(value => !value)} aria-expanded={readAgreement}><FileText className="h-4 w-4" /> Read agreement</button>
                </div>
                {!agreement && <p className="text-caption text-ink-500">{agreementError || (previewReady ? 'Loading agreement…' : 'Fill customer, phone and installment details to prepare the agreement.')}</p>}
                {agreementError && <button type="button" className="btn-secondary" onClick={() => setPreviewRefresh(value => value + 1)}>Retry agreement</button>}
                {agreement && <>
                  {readAgreement && <div className="max-h-96 space-y-4 overflow-y-auto rounded-md border border-paper-300 bg-white p-3 text-caption" data-i18n-skip>
                    <h4 className="font-bold">Installment Financing Agreement · v{agreement.termsVersion}</h4>
                    <p>{agreement.snapshot?.customer?.name} · {agreement.snapshot?.device?.brand} {agreement.snapshot?.device?.model}</p>
                    {agreement.clauses.map((clause: any) => <div key={clause.heading}><h5 className="font-bold">{clause.heading}</h5><p className="whitespace-pre-line leading-relaxed">{clause.body}</p><h5 dir="rtl" lang="ur" className="mt-2 font-bold">{clause.headingUr}</h5><p dir="rtl" lang="ur" className="whitespace-pre-line leading-relaxed">{clause.bodyUr}</p></div>)}
                    <h5 className="font-bold">Repayment schedule</h5>
                    {agreement.snapshot.schedule.map((row: any) => <p key={row.installmentNumber}>{row.installmentNumber}. {row.dueDate} — {rupees(row.amountDue)}</p>)}
                  </div>}
                  <div data-i18n-skip className="space-y-2 text-caption leading-relaxed"><p>{agreement.declaration.en}</p><p dir="rtl" lang="ur">{agreement.declaration.ur}</p></div>
                  <SignaturePad key={agreement.fingerprint} onChange={setSignature} disabled={submitting} />
                  <label className="flex items-start gap-2 text-caption"><input type="checkbox" className="mt-1" checked={accepted} disabled={submitting} onChange={event => setAccepted(event.target.checked)} /><span>The customer has read the agreement and accepts it.</span></label>
                </>}
                <button type="submit" disabled={submitting || phoneScanPending} className="btn-primary w-full py-3">{submitLabel}</button>
              </div>}
              <p className="mt-3 text-micro leading-relaxed text-ink-400">
                {noLock
                  ? 'The plan, reminders and the signed agreement apply as usual.'
                  : 'The phone can be restricted only after the grace period, and only once the customer has signed. Emergency calls always work.'}
              </p>
            </div>
          </div>
        </aside>

      </form>

      {qrFull && !phoneIntakeId && createdResult?.qrImageDataUrl && <div role="dialog" aria-label="QR code, full screen" aria-modal="true" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white p-4"><img src={createdResult.qrImageDataUrl} alt="QR code to scan on the new phone, full screen" className="aspect-square w-[min(90vw,80vh)]" /><button type="button" className="btn-secondary" onClick={() => setQrFull(false)}>Close QR</button></div>}
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
