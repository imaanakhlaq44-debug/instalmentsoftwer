import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Lock, AlertTriangle, Check, ShoppingCart } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { Card, CardHeader, Rows, EmptyState, Skeleton } from '../components/ui/Card.js';
import { money, shortDate } from '../utils/format.js';
import { MAX_PACK_SIZE, priceForPack } from '../utils/packPricing.js';

/**
 * Device locks.
 *
 * The page this replaces sold a subscription tier: a plan name, a monthly
 * price, and a quota bar that emptied again every time a customer finished
 * paying. That is not what the product sells. A lock is bought once, spent on
 * one handset at enrolment, and never comes back — so the only numbers that
 * matter here are how many are left, how many are gone, and which phone each
 * one went onto.
 */

interface DealerSummary {
  dealerId: string;
  dealerName: string;
  dealerCity: string;
  available: number;
  consumed: number;
  total: number;
  packsBought: number;
  spent: number;
  utilizationPercentage: number;
  outOfLocks: boolean;
  runningLow: boolean;
}

interface PackRow {
  id: string;
  dealerId: string;
  dealerName: string;
  size: number;
  unitPrice: number;
  totalPrice: number;
  reference?: string | null;
  issuedByName: string;
  consumed: number;
  createdAt: string;
}

interface PackOption {
  size: number;
  unitPrice: number;
  totalPrice: number;
}

export const LicensesPage: React.FC = () => {
  const { selectedDealerId, showToast, isSuperAdmin, role } = useAuth();

  const [dealers, setDealers] = useState<DealerSummary[] | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [catalogue, setCatalogue] = useState<PackOption[]>([]);
  const [issuing, setIssuing] = useState<number | null>(null);
  const [customSize, setCustomSize] = useState('');
  const customPrice = priceForPack(Number(customSize));

  // A super admin issues packs from this page, so it keeps its own list of
  // every shop and its own choice of whom a pack is for. That choice starts
  // from the shop picked in the top bar but does not depend on it: the top-bar
  // switcher is easy to miss, and "Issue" must never fail for want of it.
  const [allDealers, setAllDealers] = useState<DealerSummary[]>([]);
  const [targetId, setTargetId] = useState<string>(selectedDealerId ?? '');
  const packsRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const [data, everyone] = await Promise.all([
        ApiService.getLicenses(selectedDealerId),
        isSuperAdmin && selectedDealerId ? ApiService.getLicenses() : Promise.resolve(null),
      ]);
      setDealers(data.dealers ?? []);
      setPacks(data.packs ?? []);
      setCatalogue(data.catalogue ?? []);
      if (isSuperAdmin) setAllDealers((everyone ?? data).dealers ?? []);
    } catch (err: any) {
      showToast(err?.message || 'Could not load licence data', 'error');
      setDealers([]);
    }
  };

  useEffect(() => {
    load();
    if (selectedDealerId) setTargetId(selectedDealerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId]);

  // With only one shop on the platform there is nobody else to choose.
  useEffect(() => {
    if (!targetId && allDealers.length === 1) setTargetId(allDealers[0].dealerId);
  }, [allDealers, targetId]);

  const target = allDealers.find((d) => d.dealerId === targetId) ?? null;

  const chooseTarget = (id: string) => {
    setTargetId(id);
    packsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** Only a super admin can mint locks, and always for one named shop. */
  const issue = async (size: number) => {
    if (!target) {
      showToast('Pick the shop in "Issue locks to" first.', 'error');
      return;
    }
    try {
      setIssuing(size);
      const res = await ApiService.issueLicensePack({ dealerId: target.dealerId, size });
      showToast(res.message || `${size} locks issued to ${target.dealerName}`, 'success');
      await load();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIssuing(null);
    }
  };

  // A dealer admin sees exactly one row; a super admin may be looking at many.
  const mine = dealers?.length === 1 ? dealers[0] : null;
  const totals = (dealers ?? []).reduce(
    (acc, d) => ({
      available: acc.available + d.available,
      consumed: acc.consumed + d.consumed,
      spent: acc.spent + d.spent,
    }),
    { available: 0, consumed: 0, spent: 0 }
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Licensing</p>
        <h1 className="mt-1 font-serif text-display text-ink-900">Device locks</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-500">
          One lock holds one handset. It is spent when that phone enrols, and it stays spent —
          a paid-off or removed device does not return its lock.
        </p>
      </header>

      {dealers === null ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <Card flush>
          <div className="grid divide-y divide-paper-300 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-5">
              <p className="eyebrow">Locks left</p>
              <p className="figure mt-1.5">{totals.available}</p>
              <p className="mt-1.5 text-caption">
                {totals.available === 0 ? (
                  <span className="text-critical-700">No handset can be enrolled</span>
                ) : totals.available <= 5 ? (
                  <span className="text-caution-700">Running low</span>
                ) : (
                  <span className="text-ink-400">Ready to enrol</span>
                )}
              </p>
            </div>
            <div className="p-5">
              <p className="eyebrow">Locks spent</p>
              <p className="figure mt-1.5">{totals.consumed}</p>
              <p className="mt-1.5 text-caption text-ink-400">Handsets held, past and present</p>
            </div>
            <div className="p-5">
              <p className="eyebrow">{isSuperAdmin ? 'Billed to dealers' : 'Paid to date'}</p>
              <p className="figure mt-1.5">{money(totals.spent)}</p>
              <p className="mt-1.5 text-caption text-ink-400">
                Across {packs.length} {packs.length === 1 ? 'pack' : 'packs'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {!isSuperAdmin && mine?.outOfLocks && (
        <div className="flex items-start gap-3 rounded-lg border border-critical-200 bg-critical-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical-600" aria-hidden="true" />
          <p className="text-body text-critical-700">
            You have no locks left. New financed sales cannot be registered and no handset can be
            enrolled until you buy a pack.
          </p>
        </div>
      )}

      {/* What a pack costs. Shown to everyone — a shop owner should be able to
          see the price without asking — but only a super admin can issue one,
          because nothing here takes payment. */}
      <div ref={packsRef} className="scroll-mt-24">
      <Card>
        <CardHeader
          title={isSuperAdmin ? 'Issue locks' : 'Packs'}
          hint={
            isSuperAdmin
              ? 'Pick the shop, then the pack. Issue after payment has cleared.'
              : 'One lock per phone. Bigger packs cost less per phone.'
          }
          action={
            role === 'DEALER_ADMIN' ? (
              <Link to="/buy-locks" className="btn-primary py-1.5 text-caption">
                <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Buy locks
              </Link>
            ) : undefined
          }
        />
        {isSuperAdmin && (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="field-label">Issue locks to</span>
              <select
                className="input w-full sm:w-80"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                aria-label="Shop to issue locks to"
              >
                <option value="">Choose a shop…</option>
                {allDealers.map((d) => (
                  <option key={d.dealerId} value={d.dealerId}>
                    {d.dealerName} · {d.dealerCity} · {d.available} left
                  </option>
                ))}
              </select>
            </label>
            {target && (
              <p className="pb-2 text-body text-ink-700">
                {target.outOfLocks ? (
                  <span className="text-critical-700">
                    {target.dealerName} has no locks left and cannot enrol a handset.
                  </span>
                ) : (
                  <>
                    {target.dealerName} has <span className="tabular">{target.available}</span>{' '}
                    {target.available === 1 ? 'lock' : 'locks'} left.
                  </>
                )}
              </p>
            )}
          </div>
        )}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {catalogue.map((option) => (
            <div key={option.size} className="well p-4">
              <p className="text-title font-semibold text-ink-900 tabular">{option.size} locks</p>
              <p className="mt-1 text-body text-ink-700 tabular">{money(option.totalPrice)}</p>
              <p className="mt-0.5 text-caption text-ink-400 tabular">
                {money(option.unitPrice)} per handset
              </p>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => issue(option.size)}
                  disabled={issuing !== null || !target}
                  className="btn-secondary mt-3 w-full py-1.5 text-caption"
                >
                  {issuing === option.size
                    ? 'Issuing…'
                    : target
                      ? `Issue to ${target.dealerName}`
                      : 'Pick a shop first'}
                </button>
              )}
            </div>
          ))}
        </div>
        {isSuperAdmin && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t-2 border-dashed border-paper-400 pt-4">
            <label className="block">
              <span className="field-label">Any other number</span>
              <input
                type="number"
                min={1}
                max={MAX_PACK_SIZE}
                inputMode="numeric"
                className="input w-28"
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value)}
                placeholder="e.g. 5"
                aria-label="Custom number of locks"
              />
            </label>
            <p className="pb-2 text-body text-ink-700 tabular">
              {customPrice
                ? `${money(customPrice.unitPrice)} per handset · ${money(customPrice.totalPrice)} total`
                : `1 to ${MAX_PACK_SIZE} locks`}
            </p>
            <button
              type="button"
              onClick={() => customPrice && issue(customPrice.size)}
              disabled={!customPrice || !target || issuing !== null}
              className="btn-primary py-2 text-caption"
            >
              {customPrice && issuing === customPrice.size
                ? 'Issuing…'
                : `Issue ${customPrice ? customPrice.size : ''} locks${target ? ` to ${target.dealerName}` : ''}`}
            </button>
          </div>
        )}
      </Card>
      </div>

      {/* A super admin's view of the platform: who is about to run out. */}
      {isSuperAdmin && !selectedDealerId && allDealers.length > 0 && (
        <Card>
          <CardHeader title="Dealerships" hint="Locks left, and what each has spent" />
          <div className="mt-4">
            <Rows>
              {allDealers.map((d) => (
                <li key={d.dealerId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink-900">{d.dealerName}</p>
                    <p className="truncate text-caption text-ink-400">
                      {d.dealerCity} · {d.consumed} of {d.total} spent
                    </p>
                  </div>
                  {d.outOfLocks ? (
                    <span className="status-pill status-locked">Out of locks</span>
                  ) : d.runningLow ? (
                    <span className="status-pill status-pending">{d.available} left</span>
                  ) : (
                    <span className="text-body text-ink-700 tabular">{d.available} left</span>
                  )}
                  <button
                    type="button"
                    onClick={() => chooseTarget(d.dealerId)}
                    className="btn-secondary shrink-0 px-3 py-1 text-caption"
                  >
                    Issue locks
                  </button>
                </li>
              ))}
            </Rows>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Purchase history" hint="What was bought, and how much of it is gone" />
        <div className="mt-4">
          {packs.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="h-6 w-6" aria-hidden="true" />}
              title="No packs bought yet"
              body="A pack of locks is what lets handsets be enrolled and held."
            />
          ) : (
            <Rows>
              {packs.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-paper-200 text-ink-500">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink-900 tabular">
                      {p.size} locks
                      {isSuperAdmin && <span className="text-ink-400"> · {p.dealerName}</span>}
                    </p>
                    <p className="truncate text-caption text-ink-400">
                      {shortDate(p.createdAt)} · {money(p.unitPrice)} each
                      {p.reference && ` · ref ${p.reference}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-body font-medium text-ink-900 tabular">
                      {money(p.totalPrice)}
                    </p>
                    <p className="text-micro normal-case tracking-normal text-ink-400 tabular">
                      {p.consumed === p.size ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="h-3 w-3" aria-hidden="true" /> fully used
                        </span>
                      ) : (
                        `${p.size - p.consumed} unused`
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </Rows>
          )}
        </div>
      </Card>
    </div>
  );
};
