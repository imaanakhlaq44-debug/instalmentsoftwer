import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, X } from 'lucide-react';
import { ApiService } from '../../services/api.js';
import { makeTempPassword } from '../../utils/tempPassword.js';

/**
 * The platform owner gives a shop owner a new password.
 *
 * A shop owner who forgets their password and cannot get the SMS code (no
 * gateway, or the number on the account is gone) has no one else to ask: the
 * shop's own Staff page cannot reset the owner. Here the platform owner picks
 * the shop's owner account, a temporary password is made and shown once, and
 * the owner must choose their own on the next sign-in. The server signs the
 * account out everywhere and writes it to the audit log.
 */

interface OwnerAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

export function ResetOwnerPasswordDialog({ shop, onClose }: { shop: { dealerId: string; name: string }; onClose: () => void }) {
  const [owners, setOwners] = useState<OwnerAccount[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [handover, setHandover] = useState<{ name: string; email: string; password: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    ApiService.getUsers(shop.dealerId)
      .then((users) => {
        if (cancelled) return;
        setOwners((users as OwnerAccount[]).filter((u) => u.role === 'DEALER_ADMIN' && u.active));
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load this shop\'s owner account.');
      });
    return () => {
      cancelled = true;
    };
  }, [shop.dealerId]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [busy, onClose]);

  const reset = async (owner: OwnerAccount) => {
    const password = makeTempPassword();
    setBusy(owner.id);
    setError('');
    try {
      await ApiService.resetUserPassword(owner.id, password);
      setHandover({ name: owner.name, email: owner.email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-ink-900/60 p-5" role="dialog" aria-modal="true" aria-label="Reset owner password">
      <div ref={panel} className="surface w-full max-w-lg space-y-5 p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-title font-black">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
            Reset owner password
          </h2>
          <button type="button" className="btn-ghost p-2" aria-label="Close reset owner password" disabled={!!busy} onClick={onClose}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <p className="font-bold" data-i18n-skip>{shop.name}</p>

        {handover ? (
          <>
            <dl className="grid gap-2 text-body sm:grid-cols-[max-content_1fr] sm:gap-x-4">
              <dt className="text-ink-500">Name</dt>
              <dd className="font-semibold text-ink-900" data-i18n-skip dir="auto">{handover.name}</dd>
              <dt className="text-ink-500">Email</dt>
              <dd className="font-semibold text-ink-900" data-i18n-skip>{handover.email}</dd>
              <dt className="text-ink-500">Temporary password</dt>
              <dd className="tabular text-lg font-bold tracking-wider text-ink-900" data-i18n-skip data-testid="owner-temp-password">
                {handover.password}
              </dd>
            </dl>
            <p className="well p-3 text-caption text-ink-700">
              This password is shown only once. Give it to the shop owner; they will be asked to choose their own password the
              first time they sign in. They have been signed out on every phone and computer.
            </p>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : loadError ? (
          <p role="alert" className="text-body text-critical-700">{loadError}</p>
        ) : !owners ? (
          <p className="text-body text-ink-500">Loading…</p>
        ) : owners.length === 0 ? (
          <p className="text-body text-ink-700">This shop has no active owner account.</p>
        ) : (
          <>
            <p className="text-body">
              A new temporary password is made for the account you pick. The old password stops working at once.
            </p>
            <ul className="divide-y divide-paper-300">
              {owners.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink-900" data-i18n-skip dir="auto">{o.name}</p>
                    <p className="text-caption text-ink-500" data-i18n-skip>{o.email}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary py-1 text-caption"
                    disabled={!!busy}
                    aria-label={`Make a new password for ${o.name}`}
                    onClick={() => void reset(o)}
                  >
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {busy === o.id ? 'Resetting…' : 'New password'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && <p role="alert" className="text-body text-critical-700">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
