import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText } from 'lucide-react';
import { ApiService } from '../../services/api.js';
import { ContractSignForm } from './ContractSignForm.js';

export type SaleSignState = 'loading' | 'pending' | 'signed' | 'later';

const money = (value: number) => 'Rs. ' + Math.round(value).toLocaleString('en-PK');

/**
 * The agreement, signed on the sale screen itself.
 *
 * A phone cannot be locked until its customer has signed, and the customer is
 * standing at the counter right now — so the signature is asked for here,
 * before the QR, instead of on a page the shop has to go and find later.
 * Skipping stays possible; the note says plainly what that costs.
 */
export const SaleSignStep: React.FC<{
  contractId: string;
  onStateChange: (state: SaleSignState) => void;
}> = ({ contractId, onStateChange }) => {
  const [doc, setDoc] = useState<any | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setStateRaw] = useState<SaleSignState>('loading');

  const setState = (next: SaleSignState) => {
    setStateRaw(next);
    onStateChange(next);
  };

  useEffect(() => {
    let live = true;
    ApiService.getContract(contractId)
      .then((res) => {
        if (!live) return;
        setDoc(res);
        setState(res.contract?.status === 'SIGNED' ? 'signed' : 'pending');
      })
      .catch(() => {
        if (!live) return;
        // Without the agreement there is nothing to sign here; the QR must not be held back by it.
        setFailed(true);
        setState('later');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const readLink = (
    <Link
      to={`/contracts/${contractId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-caption font-extrabold text-ink-900 underline decoration-2 underline-offset-2 hover:bg-sun-200"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Read the full agreement</span>
    </Link>
  );

  if (state === 'loading') {
    return <div className="well p-4 text-center text-caption text-ink-500">Loading agreement…</div>;
  }

  if (state === 'signed') {
    return (
      <div className="flex flex-col items-center justify-between gap-2 rounded-md border-2 border-ink-900 bg-mint-100 p-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-positive-700" aria-hidden="true" />
          <span className="font-display text-title font-black text-ink-900">Signed ✓</span>
          <span className="text-caption text-ink-500">The customer has signed the agreement.</span>
        </div>
        {readLink}
      </div>
    );
  }

  if (state === 'later') {
    return (
      <div className="flex flex-col justify-between gap-3 rounded-md border-2 border-caution-200 bg-caution-50 p-3 text-caption text-caution-700 sm:flex-row sm:items-center">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="block">Agreement not signed yet</strong>
            <span className="block">
              This phone cannot be locked until the customer signs. You can sign later from the customer&apos;s page.
            </span>
          </span>
        </div>
        {!failed && (
          <button type="button" onClick={() => setState('pending')} className="btn-secondary shrink-0 self-start px-2.5 py-1 text-caption sm:self-auto">
            Sign now
          </button>
        )}
      </div>
    );
  }

  const { snapshot, declaration } = doc;
  const figures: [string, string][] = [
    ['Total price', money(snapshot.plan.totalAmount)],
    ['Down payment', money(snapshot.plan.downPayment)],
    ['Financed', money(snapshot.plan.financedAmount)],
    ['Installments', `${snapshot.plan.totalInstallments} × ${money(snapshot.plan.monthlyInstallment)}`],
  ];

  return (
    <section className="rounded-md border-2 border-ink-900 bg-sun-100 p-4 sm:p-5" aria-labelledby="sale-sign-heading">
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-ink-900 bg-sun-400 text-ink-900">
          <FileText className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id="sale-sign-heading" className="font-display text-title font-black text-ink-900">
            Sign agreement
          </h3>
          <p className="mt-0.5 text-caption text-ink-500">
            Go through the figures and the declaration with the customer, then hand them the screen.
          </p>
        </div>
      </header>

      <dl className="mb-3 grid grid-cols-2 gap-3 rounded-md border-2 border-ink-900 bg-white p-3 sm:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt className="text-micro font-bold uppercase tracking-wider text-ink-500">{label}</dt>
            <dd className="mt-0.5 font-bold text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-4">{readLink}</div>

      <ContractSignForm
        appearance="sale"
        contractId={contractId}
        declaration={declaration}
        defaultSignerName={snapshot.customer?.name ?? ''}
        onSigned={() => setState('signed')}
        onCancel={() => setState('later')}
        cancelLabel="Sign later"
      />
    </section>
  );
};
