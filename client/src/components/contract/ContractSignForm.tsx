import React, { useState } from 'react';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { SignaturePad } from './SignaturePad.js';

/**
 * Taking the customer's signature: the declaration, the signer's name, the pad
 * and the "has read it" box. Shared by the agreement page and the sale screen,
 * so the consent a shop records is the same wherever it is taken.
 *
 * The declaration is the agreement's own bilingual text, so it is never run
 * through the dashboard translator.
 */
export const ContractSignForm: React.FC<{
  contractId: string;
  declaration: { en: string; ur: string };
  defaultSignerName?: string;
  onSigned: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  /** 'page' matches the agreement page; 'sale' matches the sale form. */
  appearance?: 'page' | 'sale';
}> = ({ contractId, declaration, defaultSignerName = '', onSigned, onCancel, cancelLabel = 'Cancel', appearance = 'page' }) => {
  const { showToast } = useAuth();
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [signature, setSignature] = useState<string | null>(null);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [signing, setSigning] = useState(false);

  const sale = appearance === 'sale';
  const ready = !!signature && declarationAccepted && signerName.trim().length >= 3;

  const sign = async () => {
    if (!ready) return;
    try {
      setSigning(true);
      await ApiService.signContract(contractId, {
        signerName: signerName.trim(),
        signatureImage: signature,
        declarationAccepted: true,
      });
      showToast('Agreement signed. This device may now be managed under its terms.', 'success');
      onSigned();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        data-i18n-skip
        lang="en"
        className={sale ? 'well space-y-2 p-3' : 'p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2'}
      >
        <p dir="ltr" className="text-xs text-slate-800 leading-relaxed">{declaration.en}</p>
        <p className="text-xs text-slate-800 leading-relaxed" dir="rtl" lang="ur">
          {declaration.ur}
        </p>
      </div>

      <div>
        <label
          htmlFor={`signer-${contractId}`}
          className={sale ? 'field-label' : 'text-micro uppercase font-bold text-slate-500 tracking-wider block mb-1'}
        >
          Name of the person signing
        </label>
        <input
          id={`signer-${contractId}`}
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          className={
            sale
              ? 'input w-full'
              : 'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500'
          }
        />
      </div>

      <SignaturePad onChange={setSignature} disabled={signing} />

      <label className={`flex items-start gap-2 ${sale ? 'text-body text-ink-900' : 'text-xs text-slate-700'}`}>
        <input
          type="checkbox"
          checked={declarationAccepted}
          onChange={(e) => setDeclarationAccepted(e.target.checked)}
          className="mt-0.5"
        />
        <span>The customer has read the declaration above and accepts it.</span>
      </label>

      <div className={`flex flex-wrap items-center gap-2 pt-2 ${sale ? 'justify-center' : 'justify-end'}`}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={signing}
            className={sale ? 'btn-ghost' : 'px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900'}
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          onClick={sign}
          disabled={signing || !ready}
          className={
            sale
              ? 'btn-primary disabled:opacity-40'
              : 'px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold'
          }
        >
          {signing ? 'Recording…' : 'Record the signature'}
        </button>
      </div>
    </div>
  );
};
