import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { SignaturePad } from '../components/contract/SignaturePad.js';
import { AlertTriangle, ArrowLeft, FileText, Printer, ShieldCheck } from 'lucide-react';

const money = (value: number) => 'Rs. ' + Math.round(value).toLocaleString('en-PK');

/**
 * The financing agreement: read it, sign it, print it.
 *
 * The printed page is the deliverable — a customer restricting their own phone
 * on someone's say-so deserves a copy of what they agreed to. It prints to A4
 * through the browser, which is also what makes the Urdu render correctly:
 * a server-side PDF library would need Arabic text shaping that none of the
 * Node ones do properly, and half-shaped Urdu on a legal document is worse than
 * no Urdu at all.
 */
export const ContractPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, showToast } = useAuth();

  const [document, setDocument] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await ApiService.getContract(id);
      setDocument(res);
      setSignerName(res.snapshot?.customer?.name ?? '');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const sign = async () => {
    if (!id || !signature || !declarationAccepted) return;
    try {
      setSigning(true);
      await ApiService.signContract(id, {
        signerName: signerName.trim(),
        signatureImage: signature,
        declarationAccepted: true,
      });
      showToast('Agreement signed. This device may now be managed under its terms.', 'success');
      setShowSignModal(false);
      setSignature(null);
      setDeclarationAccepted(false);
      load();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading agreement…</div>;
  if (!document) return <div className="p-8 text-sm text-slate-500">This agreement could not be loaded.</div>;

  const { contract, snapshot, clauses, declaration, hashMatches } = document;
  const canSign = contract.status === 'DRAFT' && user?.role !== 'CUSTOMER';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/*
        The A4 page rules live here rather than in index.css, which sizes the
        page for 80mm thermal receipt rolls. Two documents, two page sizes, and
        `@page` cannot be scoped by class — so the one that is on screen brings
        its own, and being later in the cascade it wins.
      */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden; }
          #printable-contract, #printable-contract * { visibility: visible; }
          #printable-contract {
            position: absolute; top: 0; left: 0; width: 100%;
            color: #000 !important; font-size: 11px;
          }
          #printable-contract .page-break { page-break-before: always; }
        }
      `}</style>

      {/* Toolbar — never printed */}
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-2">
          {canSign && (
            <button
              onClick={() => setShowSignModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2"
            >
              <FileText className="w-4 h-4" /> Sign with the customer
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2"
          >
            <Printer className="w-4 h-4" /> Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Status banners — never printed */}
      <div className="print:hidden space-y-3">
        {contract.status === 'DRAFT' && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-amber-900">Not signed yet</p>
              <p className="text-xs text-amber-800 mt-0.5">
                This device cannot be restricted until the customer has signed. Read the agreement with them —
                clause 4 in particular — before taking the signature.
              </p>
            </div>
          </div>
        )}

        {contract.status === 'SIGNED' && hashMatches === false && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-rose-900">The plan has changed since this was signed</p>
              <p className="text-xs text-rose-800 mt-0.5">
                The figures below are no longer the ones in force, so the customer has not agreed to the current
                terms. The device cannot be restricted until a fresh agreement is signed.
              </p>
            </div>
          </div>
        )}

        {contract.status === 'SIGNED' && hashMatches && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-emerald-900">
                Signed by {contract.signerName} on {new Date(contract.signedAt).toLocaleString()}
              </p>
              <p className="text-xs text-emerald-800 mt-0.5">
                The figures still match the plan in force. Document hash {contract.documentHash?.slice(0, 16)}…
              </p>
            </div>
          </div>
        )}

        {contract.status === 'VOID' && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-100 border border-slate-300">
            <AlertTriangle className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-slate-900">This agreement was voided</p>
              <p className="text-xs text-slate-700 mt-0.5">{contract.voidReason}</p>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The document itself                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div id="printable-contract" className="bg-white rounded-3xl border border-slate-200/80 p-8 space-y-6">
        <header className="text-center border-b border-slate-200 pb-4">
          <h1 className="text-lg font-extrabold text-slate-900">Installment Financing Agreement</h1>
          <p className="text-sm text-slate-700" dir="rtl">اقساط پر خریداری کا معاہدہ</p>
          <p className="text-[11px] text-slate-500 mt-2">
            {snapshot.dealer.name} · {snapshot.dealer.city} · {snapshot.dealer.phone}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            Agreement {contract.id} · terms v{contract.termsVersion}
          </p>
        </header>

        {/* Parties and device */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <h2 className="font-bold text-slate-900 mb-1">Customer / گاہک</h2>
            <p className="text-slate-700">{snapshot.customer.name}</p>
            <p className="text-slate-600">CNIC {snapshot.customer.cnic}</p>
            <p className="text-slate-600">{snapshot.customer.phone}</p>
            <p className="text-slate-600">{snapshot.customer.address}</p>
          </div>
          <div>
            <h2 className="font-bold text-slate-900 mb-1">Handset / موبائل</h2>
            <p className="text-slate-700">
              {snapshot.device.brand} {snapshot.device.model}
            </p>
            <p className="text-slate-600">IMEI {snapshot.device.imei}</p>
            {snapshot.device.color && <p className="text-slate-600">{snapshot.device.color}</p>}
            {snapshot.device.ramStorage && <p className="text-slate-600">{snapshot.device.ramStorage}</p>}
          </div>
        </section>

        {/* Headline figures */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-y border-slate-200 py-4">
          {[
            ['Total price', money(snapshot.plan.totalAmount)],
            ['Down payment', money(snapshot.plan.downPayment)],
            ['Financed', money(snapshot.plan.financedAmount)],
            ['Installments', `${snapshot.plan.totalInstallments} × ${money(snapshot.plan.monthlyInstallment)}`],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{label}</p>
              <p className="font-bold text-slate-900 mt-0.5">{value}</p>
            </div>
          ))}
        </section>

        {/* Clauses, both languages */}
        <section className="space-y-4">
          {clauses.map((clause: any) => (
            <div key={clause.heading} className="text-xs">
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <h3 className="font-bold text-slate-900">{clause.heading}</h3>
                <h3 className="font-bold text-slate-900" dir="rtl">
                  {clause.headingUr}
                </h3>
              </div>
              <p className="text-slate-700 whitespace-pre-line leading-relaxed">{clause.body}</p>
              <p className="text-slate-700 whitespace-pre-line leading-relaxed mt-2" dir="rtl">
                {clause.bodyUr}
              </p>
            </div>
          ))}
        </section>

        {/* Schedule */}
        <section className="page-break">
          <h3 className="text-xs font-bold text-slate-900 mb-2">
            Repayment schedule <span dir="rtl">/ اقساط کا شیڈول</span>
          </h3>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-1 font-bold">#</th>
                <th className="py-1 font-bold">Due date</th>
                <th className="py-1 font-bold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.schedule.map((row: any) => (
                <tr key={row.installmentNumber} className="border-b border-slate-100">
                  <td className="py-1">{row.installmentNumber}</td>
                  <td className="py-1">{row.dueDate}</td>
                  <td className="py-1 text-right">{money(row.amountDue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Declaration and signature */}
        <section className="border-t border-slate-200 pt-4 space-y-3">
          <p className="text-xs text-slate-800 leading-relaxed">{declaration.en}</p>
          <p className="text-xs text-slate-800 leading-relaxed" dir="rtl">
            {declaration.ur}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4">
            <div>
              <div className="h-20 border-b border-slate-400 flex items-end">
                {contract.signatureImage && (
                  <img src={contract.signatureImage} alt="Customer signature" className="max-h-20" />
                )}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">
                Customer / گاہک {contract.signerName ? `— ${contract.signerName}` : ''}
              </p>
              {contract.signedAt && (
                <p className="text-[10px] text-slate-500">{new Date(contract.signedAt).toLocaleString()}</p>
              )}
            </div>
            <div>
              <div className="h-20 border-b border-slate-400" />
              <p className="text-[10px] text-slate-600 mt-1">
                For {snapshot.dealer.name} / دکان کی جانب سے
              </p>
            </div>
          </div>

          {contract.documentHash && (
            <p className="text-[9px] text-slate-400 pt-2 break-all">
              Document hash (SHA-256): {contract.documentHash}
            </p>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Signing                                                             */}
      {/* ------------------------------------------------------------------ */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Customer signature</h2>
              <p className="text-xs text-slate-500 mt-1">
                Read the declaration to the customer, then hand them the screen. Their signature is what permits
                this handset to be restricted if payments fall overdue.
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] text-slate-800 leading-relaxed">{declaration.en}</p>
              <p className="text-[11px] text-slate-800 leading-relaxed" dir="rtl">
                {declaration.ur}
              </p>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                Name of the person signing
              </label>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <SignaturePad onChange={setSignature} disabled={signing} />

            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={declarationAccepted}
                onChange={(e) => setDeclarationAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span>The customer has read the declaration above and accepts it.</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSignModal(false)}
                disabled={signing}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                onClick={sign}
                disabled={signing || !signature || !declarationAccepted || signerName.trim().length < 3}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold"
              >
                {signing ? 'Recording…' : 'Record the signature'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
