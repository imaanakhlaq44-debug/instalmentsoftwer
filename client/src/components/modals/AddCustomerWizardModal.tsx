import React, { useState } from 'react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  X,
  User,
  Smartphone,
  Calendar,
  CheckCircle2,
  QrCode,
  ArrowRight,
  ArrowLeft,
  Copy,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PHONE_BRANDS } from '../../utils/brands.js';
import { checkPhoneSupport, AndroidVersion } from '../../utils/phoneSupport.js';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export const AddCustomerWizardModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const { selectedDealerId, showToast } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState({
    // Step 1: Customer
    customerName: '',
    customerPhone: '',
    customerCnic: '',
    customerAddress: '',
    emergencyName: '',
    emergencyPhone: '',
    // Step 2: Device
    brand: 'Samsung',
    model: 'Galaxy A15',
    // Typed from the phone (*#06#). A made-up default never passes the
    // checksum the server applies, and would invite a wrong IMEI on record.
    imei: '',
    serialNumber: '',
    purchasePrice: 54000,
    color: 'Blue Black',
    ramStorage: '6GB / 128GB',
    android: '11+' as AndroidVersion,
    playStore: true,
    // Step 3: Financing
    downPayment: 13500,
    totalInstallments: 6,
    firstDueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    gracePeriodDays: 3,
    qrType: 'STANDARD',
  });

  const financedAmount = formData.purchasePrice - formData.downPayment;
  const monthlyAmount = Math.round(financedAmount / (formData.totalInstallments || 1));

  // Checked at the counter, before the customer leaves with the phone: a
  // handset that cannot run the lock app is still a sale, just without a lock.
  const support = checkPhoneSupport({ brand: formData.brand, android: formData.android, playStore: formData.playStore });
  const noLock = support.level === 'none';

  const handleCreate = async () => {
    try {
      setSubmitting(true);
      const payload = {
        // A super admin works inside the shop picked at the top; without this the
        // server cannot tell which shop the sale belongs to and refuses it.
        dealerId: selectedDealerId || undefined,
        customer: {
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
          imei: formData.imei,
          serialNumber: formData.serialNumber,
          purchasePrice: formData.purchasePrice,
          color: formData.color,
          ramStorage: formData.ramStorage,
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
      setStep(5);
      showToast(noLock ? 'Sale registered without a lock.' : 'Customer & financed device registered successfully!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create record', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyTokenToClipboard = () => {
    if (createdResult?.enrollmentToken?.token) {
      navigator.clipboard.writeText(createdResult.enrollmentToken.token);
      showToast('Enrollment code copied to clipboard!', 'info');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-navy-950 text-white flex items-center justify-between">
          <div>
            <span className="text-xs uppercase font-bold text-blue-400 tracking-wider">
              Financing & Device Wizard
            </span>
            <h2 className="text-lg font-bold text-white">Register Financed Device</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold">
          {[
            { num: 1, label: 'Customer' },
            { num: 2, label: 'Device' },
            { num: 3, label: 'Financing' },
            { num: 4, label: 'Contract Review' },
            { num: 5, label: noLock ? 'Done' : 'Enroll QR' },
          ].map((s) => (
            <div
              key={s.num}
              className={`flex items-center gap-1.5 ${
                step === s.num
                  ? 'text-blue-600 font-bold'
                  : step > s.num
                  ? 'text-emerald-600 font-semibold'
                  : 'text-slate-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  step === s.num
                    ? 'bg-blue-600 text-white'
                    : step > s.num
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step > s.num ? '✓' : s.num}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Wizard Body */}
        <div className="p-6">
          {/* STEP 1: Customer Information */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" /> Customer Details
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Muhammad Aslam"
                    value={formData.customerName}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile Phone (03XX) *</label>
                  <input
                    type="text"
                    required
                    placeholder="0300-1234567"
                    value={formData.customerPhone}
                    onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">CNIC Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="35202-1234567-1"
                    value={formData.customerCnic}
                    onChange={(e) => setFormData({ ...formData, customerCnic: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Residential Address *</label>
                  <input
                    type="text"
                    placeholder="House / Street / City"
                    value={formData.customerAddress}
                    onChange={(e) => setFormData({ ...formData, customerAddress: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact Person</label>
                  <input
                    type="text"
                    placeholder="e.g. Asif Aslam (Brother)"
                    value={formData.emergencyName}
                    onChange={(e) => setFormData({ ...formData, emergencyName: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Phone</label>
                  <input
                    type="text"
                    placeholder="0321-7654321"
                    value={formData.emergencyPhone}
                    onChange={(e) => setFormData({ ...formData, emergencyPhone: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Device Information */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-600" /> Financed Smartphone Specs
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Brand *</label>
                  <select
                    value={formData.brand}
                    onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  >
                    {PHONE_BRANDS.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Model Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Galaxy A15 / Note 30 Pro"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Primary IMEI Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="15-digit IMEI"
                    value={formData.imei}
                    onChange={(e) => setFormData({ ...formData, imei: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Serial Number</label>
                  <input
                    type="text"
                    value={formData.serialNumber}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Retail Price (PKR) *</label>
                  <input
                    type="number"
                    value={formData.purchasePrice}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        purchasePrice: Number(e.target.value),
                        downPayment: Math.round(Number(e.target.value) * 0.25),
                      })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">RAM / Storage & Color</label>
                  <input
                    type="text"
                    value={formData.ramStorage}
                    onChange={(e) => setFormData({ ...formData, ramStorage: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Phone check: can this handset take the lock? */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                <p className="text-xs font-bold text-slate-800">Phone check</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Android version</label>
                    <select
                      value={formData.android}
                      onChange={(e) => setFormData({ ...formData, android: e.target.value as AndroidVersion })}
                      disabled={formData.brand === 'Apple'}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm disabled:opacity-50"
                    >
                      <option value="11+">Android 11 or newer</option>
                      <option value="8-10">Android 8, 9 or 10</option>
                      <option value="7-">Android 7 or older</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Google Play Store on this phone?</label>
                    <select
                      value={formData.playStore ? 'yes' : 'no'}
                      onChange={(e) => setFormData({ ...formData, playStore: e.target.value === 'yes' })}
                      disabled={formData.brand === 'Apple'}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm disabled:opacity-50"
                    >
                      <option value="yes">Yes, Play Store works</option>
                      <option value="no">No (AppGallery or none)</option>
                    </select>
                  </div>
                </div>
                <div
                  role="status"
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    support.level === 'full'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : support.level === 'partial'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <p className="font-bold">
                    {support.level === 'full' ? '✓ ' : support.level === 'partial' ? '! ' : '✕ '}
                    {support.title}
                  </p>
                  <p className="mt-0.5">{support.detail}</p>
                  {noLock && (
                    <p className="mt-1.5 font-semibold">
                      No lock will be used and no QR is needed. Take a larger advance or a guarantor for this sale.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Financing & Installment Plan */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" /> Installment Structure
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Down Payment (PKR) *</label>
                  <input
                    type="number"
                    value={formData.downPayment}
                    onChange={(e) => setFormData({ ...formData, downPayment: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Number of Months *</label>
                  <select
                    value={formData.totalInstallments}
                    onChange={(e) => setFormData({ ...formData, totalInstallments: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  >
                    <option value={3}>3 Months</option>
                    <option value={6}>6 Months</option>
                    <option value={9}>9 Months</option>
                    <option value={12}>12 Months</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">First Due Date *</label>
                  <input
                    type="date"
                    value={formData.firstDueDate}
                    onChange={(e) => setFormData({ ...formData, firstDueDate: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Grace Period (Days)</label>
                  <input
                    type="number"
                    value={formData.gracePeriodDays}
                    onChange={(e) => setFormData({ ...formData, gracePeriodDays: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Calculation Summary Box */}
              <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <span className="text-slate-500 block">Financed Amount</span>
                    <span className="font-bold text-slate-900 text-sm">Rs. {financedAmount.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Monthly Payment</span>
                    <span className="font-extrabold text-blue-700 text-sm">Rs. {monthlyAmount.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Duration</span>
                    <span className="font-bold text-slate-900 text-sm">{formData.totalInstallments} Months</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review Contract Summary */}
          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Installment Financing Agreement
              </h3>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 text-xs">
                <div className="flex justify-between border-b border-slate-200/60 pb-2">
                  <span className="text-slate-500">Customer Name:</span>
                  <span className="font-bold text-slate-900">{formData.customerName || 'N/A'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200/60 pb-2">
                  <span className="text-slate-500">Phone & CNIC:</span>
                  <span className="font-bold text-slate-900">
                    {formData.customerPhone} | {formData.customerCnic}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-200/60 pb-2">
                  <span className="text-slate-500">Financed Device:</span>
                  <span className="font-bold text-slate-900">
                    {formData.brand} {formData.model} ({formData.ramStorage})
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-200/60 pb-2">
                  <span className="text-slate-500">IMEI:</span>
                  <span className="font-mono font-bold text-slate-800">{formData.imei}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200/60 pb-2">
                  <span className="text-slate-500">Total / Down Payment:</span>
                  <span className="font-bold text-slate-900">
                    Rs. {formData.purchasePrice.toLocaleString()} / Rs. {formData.downPayment.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-slate-500">Monthly Installment:</span>
                  <span className="font-extrabold text-blue-700 text-sm">
                    Rs. {monthlyAmount.toLocaleString()} / month × {formData.totalInstallments} months
                  </span>
                </div>
              </div>

              {noLock ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-700 leading-relaxed">
                <strong>Sold without a lock:</strong> this phone cannot run the lock app, so it will not be locked or restricted. The installment plan, reminders and the signed agreement apply as usual.
              </div>
              ) : (
              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-[11px] text-amber-800 leading-relaxed">
                <strong>Consent & Enforcement Notice:</strong> Customer consents to DPC-based remote restricted locking in case installments become overdue past the {formData.gracePeriodDays}-day grace threshold. Emergency calls remain accessible.
              </div>
              )}
            </div>
          )}

          {/* STEP 5: Enroll Device QR Display */}
          {step === 5 && createdResult && !createdResult.enrollmentToken && (
            <div className="space-y-4 text-center py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Sale registered without a lock</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  No QR is needed for this phone. Get the agreement signed from the customer's page; installments and
                  reminders run as usual.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    onSuccess();
                    navigate(`/customers/${createdResult.customer?.id}`);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl"
                >
                  Open customer
                </button>
                <button
                  onClick={() => {
                    onSuccess();
                    onClose();
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === 5 && createdResult?.enrollmentToken && (
            <div className="space-y-5 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-900">Device Ready for Enrollment</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Scan this QR code during initial Android device setup or test immediately in the simulator.
                </p>
              </div>

              {/* QR Code Container */}
              <div className="p-6 bg-slate-900 text-white rounded-3xl max-w-xs mx-auto shadow-xl space-y-4">
                <div className="bg-white p-4 rounded-2xl mx-auto inline-block">
                  <QrCode className="w-40 h-40 text-slate-900" />
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Enrollment Token Code
                  </span>
                  <div className="font-mono text-xs font-bold text-emerald-400 bg-slate-800/90 py-1.5 px-3 rounded-lg mt-1 break-all flex items-center justify-center gap-2">
                    <span>{createdResult.enrollmentToken?.token}</span>
                    <button onClick={copyTokenToClipboard} title="Copy Token">
                      <Copy className="w-3.5 h-3.5 text-slate-300 hover:text-white" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    onSuccess();
                    navigate(`/simulator?deviceId=${createdResult.device?.id}`);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-600/30"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Test in Phone Simulator
                </button>
                <button
                  onClick={() => {
                    onSuccess();
                    onClose();
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
                >
                  Done & View Dashboard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        {step < 5 && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            ) : (
              <div></div>
            )}

            {step < 4 ? (
              <button
                onClick={() => {
                  if (step === 1 && (!formData.customerName || !formData.customerPhone)) {
                    showToast('Please enter customer name and phone', 'error');
                    return;
                  }
                  if (step === 2 && (!formData.model || !formData.imei)) {
                    showToast('Please enter device model and IMEI', 'error');
                    return;
                  }
                  setStep(step + 1);
                }}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/30 transition-all"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 transition-all"
              >
                {submitting ? 'Registering...' : noLock ? 'Approve & Register Sale' : 'Approve & Generate QR'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
