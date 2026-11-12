import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock, KeyRound, MessageCircle, Phone, Store, WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { Card, CardHeader, EmptyState, Skeleton } from '../components/ui/Card.js';
import { money, shortDate } from '../utils/format.js';
import { LockOrderQueue } from '../components/platform/LockOrderQueue.js';

/**
 * The platform owner's pages: Home, Lock orders and Shops.
 *
 * A shop owner's dashboard is about their customers. The platform owner's day
 * is different: confirm who has paid and give them their locks, see which shops
 * are about to run out, know what was earned, and notice handsets that have
 * gone quiet. Opening a shop (from Shops, or the top bar) shows that shop's
 * own dashboard, exactly as the shop sees it.
 */

interface PackPrice {
  size: number;
  unitPrice: number;
  totalPrice: number;
}

interface WaitingShop {
  dealerId: string;
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  createdAt: string;
  requestedPack: PackPrice;
}

interface Shop {
  dealerId: string;
  name: string;
  ownerName: string;
  phone: string;
  city: string;
  createdAt: string;
  available: number;
  consumed: number;
  packsBought: number;
  billed: number;
  lastPackAt: string | null;
  devices: { total: number; locked: number; overdue: number };
  outOfLocks: boolean;
  runningLow: boolean;
  requestedPack: PackPrice | null;
}

export interface PlatformOverview {
  totals: {
    shops: number;
    shopsAwaitingPayment: number;
    /** Orders where the shop has reported a payment and nobody has decided yet. */
    ordersToCheck?: number;
    locksSold: number;
    locksSoldThisMonth: number;
    revenue: number;
    revenueThisMonth: number;
    locksAvailable: number;
    locksConsumed: number;
  };
  awaitingPayment: WaitingShop[];
  shops: Shop[];
  fleet: { byStatus: Record<string, number>; stale: number; staleAfterDays: number };
}

/** Pakistani mobile number to the international form WhatsApp links need. */
export function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  return digits;
}

const FLEET_ROWS: { key: string; label: string; dot: string }[] = [
  { key: 'ACTIVE', label: 'Active', dot: 'bg-positive-600' },
  { key: 'OVERDUE', label: 'Overdue', dot: 'bg-caution-600' },
  { key: 'LOCKED', label: 'Locked', dot: 'bg-critical-600' },
  { key: 'PENDING', label: 'Awaiting QR', dot: 'bg-accent-600' },
  { key: 'INACTIVE', label: 'Released', dot: 'bg-ink-400' },
];

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function usePlatformOverview() {
  const { showToast } = useAuth();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await ApiService.getPlatformOverview());
      setFailed(false);
    } catch (err: any) {
      setFailed(true);
      showToast(err?.message || 'Could not load the platform overview', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, failed, load };
}

/** Opens one shop's own dashboard. */
function useOpenShop() {
  const { setSelectedDealerId } = useAuth();
  const navigate = useNavigate();
  return (dealerId: string) => {
    setSelectedDealerId(dealerId);
    navigate('/');
    window.scrollTo(0, 0);
  };
}

const ContactButtons: React.FC<{ phone: string }> = ({ phone }) => (
  <>
    <a className="btn-secondary py-1.5 text-caption" href={`https://wa.me/${whatsappNumber(phone)}`} target="_blank" rel="noopener">
      <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
    </a>
    <a className="btn-secondary py-1.5 text-caption" href={`tel:${phone}`}>
      <Phone className="h-4 w-4" aria-hidden="true" /> Call
    </a>
  </>
);

const PageHeader: React.FC<{ eyebrow: string; title: string; children?: React.ReactNode }> = ({ eyebrow, title, children }) => (
  <header>
    <p className="eyebrow">{eyebrow}</p>
    <h1 className="mt-1 text-display text-ink-900">{title}</h1>
    {children && <p className="mt-1 max-w-2xl text-body text-ink-500">{children}</p>}
  </header>
);

const RetryLine: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <p className="text-center text-caption text-ink-500">
    <button type="button" className="underline" onClick={onRetry}>
      Try again
    </button>
  </p>
);

/** The orders list: shops that asked for a pack and have not been given it yet. */
const OrdersList: React.FC<{ data: PlatformOverview | null; reload: () => Promise<void> }> = ({ data, reload }) => {
  const { showToast } = useAuth();
  const [issuing, setIssuing] = useState<string | null>(null);

  const issue = async (shop: WaitingShop) => {
    const ok = window.confirm(
      `Has ${shop.name} paid ${money(shop.requestedPack.totalPrice)}?\n\n` +
        `This gives them ${shop.requestedPack.size} locks now and cannot be undone.`
    );
    if (!ok) return;
    try {
      setIssuing(shop.dealerId);
      const res = await ApiService.issueLicensePack({ dealerId: shop.dealerId, size: shop.requestedPack.size });
      showToast(res.message || `${shop.requestedPack.size} locks given to ${shop.name}`, 'success');
      await reload();
    } catch (err: any) {
      showToast(err?.message || 'Could not give the locks', 'error');
    } finally {
      setIssuing(null);
    }
  };

  if (!data) return <Skeleton className="h-20" />;
  if (data.awaitingPayment.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
        title="No orders waiting"
        body="A new shop that has not sent its payment yet appears here."
      />
    );
  }
  return (
    <ul className="space-y-3">
      {data.awaitingPayment.map((s) => (
        <li
          key={s.dealerId}
          className="flex flex-col gap-3 rounded-md border-2 border-ink-900 bg-sun-100 p-4 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="min-w-0">
            <p className="text-lede font-extrabold text-ink-900">{s.name}</p>
            <p className="text-caption text-ink-700">
              {s.ownerName} · {s.city} · signed up {shortDate(s.createdAt)}
            </p>
            <p className="mt-1 text-body text-ink-900">
              Ordered <b>{s.requestedPack.size} locks</b> · {money(s.requestedPack.unitPrice)} each · to pay{' '}
              <b>{money(s.requestedPack.totalPrice)}</b>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ContactButtons phone={s.phone} />
            <button type="button" className="btn-primary py-1.5 text-caption" disabled={issuing !== null} onClick={() => issue(s)}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {issuing === s.dealerId ? 'Giving locks…' : `Paid: give ${s.requestedPack.size} locks`}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

const TodoTile: React.FC<{
  count: number | undefined;
  title: string;
  done: string;
  action: string;
  to: string;
  tone: 'caution' | 'critical' | 'accent';
  icon: React.ReactNode;
}> = ({ count, title, done, action, to, tone, icon }) => {
  const busy = (count ?? 0) > 0;
  const tones = {
    caution: 'bg-sun-100',
    critical: 'bg-critical-50',
    accent: 'bg-accent-50',
  };
  return (
    <Link to={to} className={`surface-interactive flex flex-col gap-2 p-5 ${busy ? tones[tone] : 'bg-paper-50'}`}>
      <span className="flex items-center gap-2 text-ink-700">{icon}</span>
      <span className="figure text-3xl">{count ?? '—'}</span>
      <span className="text-body font-bold text-ink-900">{busy ? title : done}</span>
      <span className="mt-auto inline-flex items-center gap-1 text-caption font-extrabold text-accent-700">
        {action} <ArrowRight className="rtl:rotate-180 h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
};

export const PlatformDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { data, failed, load } = usePlatformOverview();
  const openShop = useOpenShop();

  const firstName = (user?.name || 'there').split(' ')[0];
  const t = data?.totals;
  const lowShops = (data?.shops ?? []).filter((s) => s.outOfLocks || s.runningLow);
  const fleetTotal = Object.values(data?.fleet.byStatus ?? {}).reduce((a, b) => a + b, 0);
  const topShops = [...(data?.shops ?? [])].sort((a, b) => b.devices.total - a.devices.total).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title={`Salam, ${firstName}`}>
        {t ? `${t.shops} shops · ${t.locksConsumed} phones under lock` : 'Loading the platform…'}
      </PageHeader>

      {/* What needs doing today, each with the one place to go and do it. */}
      <section aria-labelledby="todo-heading" className="space-y-3">
        <h2 id="todo-heading" className="text-title font-extrabold text-ink-900">To do today</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <TodoTile
            count={data ? data.awaitingPayment.length + (data.totals.ordersToCheck ?? 0) : undefined}
            title="Lock orders waiting for payment"
            done="No orders waiting"
            action="Open lock orders"
            to="/orders"
            tone="caution"
            icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
          />
          <TodoTile
            count={data ? lowShops.length : undefined}
            title="Shops running out of locks"
            done="Every shop has locks"
            action="Open shops"
            to="/shops"
            tone="critical"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          />
          <TodoTile
            count={data?.fleet.stale}
            title={`Phones silent for ${data?.fleet.staleAfterDays ?? 7}+ days`}
            done="Every phone is checking in"
            action="Open shops"
            to="/shops"
            tone="accent"
            icon={<WifiOff className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </section>

      {/* Money: what the platform has earned. */}
      <div className="surface grid divide-y-2 divide-paper-300 sm:grid-cols-3 sm:divide-x-2 rtl:divide-x-reverse sm:divide-y-0">
        <div className="p-5">
          <p className="eyebrow">Earned this month</p>
          <p className="figure mt-2 text-2xl">{t ? money(t.revenueThisMonth) : '—'}</p>
          <p className="mt-1 text-caption text-ink-500">{t ? `${t.locksSoldThisMonth} locks sold` : ' '}</p>
        </div>
        <div className="p-5">
          <p className="eyebrow">Earned in total</p>
          <p className="figure mt-2 text-2xl">{t ? money(t.revenue) : '—'}</p>
          <p className="mt-1 text-caption text-ink-500">{t ? `${t.locksSold} locks sold` : ' '}</p>
        </div>
        <div className="p-5">
          <p className="eyebrow">Locks with shops</p>
          <p className="figure mt-2 text-2xl">{t ? t.locksAvailable : '—'}</p>
          <p className="mt-1 text-caption text-ink-500">{t ? `unused · ${t.locksConsumed} already on phones` : ' '}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Biggest shops"
            hint="By phones under management"
            action={
              <Link to="/shops" className="btn-ghost px-2 py-1 text-caption">
                All shops <ArrowRight className="rtl:rotate-180 h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          />
          <div className="mt-3">
            {!data ? (
              <Skeleton className="h-32" />
            ) : topShops.length === 0 ? (
              <EmptyState icon={<Store className="h-6 w-6" aria-hidden="true" />} title="No shops yet" body="Shops appear here as soon as they register." />
            ) : (
              <ul className="divide-y divide-paper-300">
                {topShops.map((s) => (
                  <li key={s.dealerId} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-ink-900">{s.name}</span>
                      <span className="block text-caption text-ink-500">
                        {s.city} · {s.devices.total} phones · {s.available} locks left
                      </span>
                    </span>
                    <button type="button" className="btn-secondary shrink-0 py-1 text-caption" onClick={() => openShop(s.dealerId)}>
                      Open shop
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Every phone on the platform. */}
        <Card>
          <CardHeader title="All phones" hint="Every handset across all shops" />
          <div className="mt-3 space-y-2">
            {FLEET_ROWS.map((r) => (
              <div key={r.key} className="flex items-center justify-between text-body">
                <span className="flex items-center gap-2 text-ink-700">
                  <span className={`h-2.5 w-2.5 rounded-full ${r.dot}`} aria-hidden="true" />
                  {r.label}
                </span>
                <span className="tabular font-bold text-ink-900">{data?.fleet.byStatus[r.key] ?? 0}</span>
              </div>
            ))}
            <p className="border-t-2 border-dashed border-paper-400 pt-2 text-caption text-ink-500">{fleetTotal} phones in total</p>
          </div>
        </Card>
      </div>

      {failed && <RetryLine onRetry={load} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Lock orders
// ---------------------------------------------------------------------------

export const PlatformOrdersPage: React.FC = () => {
  const { data, failed, load } = usePlatformOverview();
  const lowShops = (data?.shops ?? []).filter((s) => (s.outOfLocks || s.runningLow) && s.packsBought > 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Lock orders">
        A shop orders locks from its own dashboard and sends you the transaction ID. Check that the money arrived, then
        give it the locks here.
      </PageHeader>

      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          ['1', 'The shop orders', 'It picks a pack of locks on its Buy locks page.'],
          ['2', 'The shop pays you', 'By JazzCash, Easypaisa or bank, and sends the transaction ID.'],
          ['3', 'You give the locks', 'Find the transfer in your account, then press "Payment received". The shop can sell at once.'],
        ].map(([n, title, body]) => (
          <li key={n} className="surface flex gap-3 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink-900 bg-sun-400 font-black text-ink-900">
              {n}
            </span>
            <span>
              <span className="block font-extrabold text-ink-900">{title}</span>
              <span className="block text-caption text-ink-500">{body}</span>
            </span>
          </li>
        ))}
      </ol>

      <LockOrderQueue onChanged={load} />

      <Card>
        <CardHeader title="Signed up, not paid yet" hint="New shops that picked a pack but have not sent a payment" />
        <div className="mt-4">
          <OrdersList data={data} reload={load} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Likely to order soon"
          hint="Paying shops with five locks or fewer left"
          action={
            <Link to="/licenses" className="btn-ghost px-2 py-1 text-caption">
              Give a pack <ArrowRight className="rtl:rotate-180 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        />
        <div className="mt-3">
          {!data ? (
            <Skeleton className="h-16" />
          ) : lowShops.length === 0 ? (
            <p className="text-body text-ink-500">Every paying shop has locks to spare.</p>
          ) : (
            <ul className="divide-y divide-paper-300">
              {lowShops.map((s) => (
                <li key={s.dealerId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <AlertTriangle
                      className={`h-4 w-4 shrink-0 ${s.outOfLocks ? 'text-critical-600' : 'text-caution-600'}`}
                      aria-hidden="true"
                    />
                    <span className="truncate font-bold text-ink-900">{s.name}</span>
                    <span className="tabular text-caption font-bold text-ink-700">{s.available} locks left</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <ContactButtons phone={s.phone} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {failed && <RetryLine onRetry={load} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

export const PlatformShopsPage: React.FC = () => {
  const { data, failed, load } = usePlatformOverview();
  const openShop = useOpenShop();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Shops">
        Every shop on the platform: locks left, phones under management and what it has paid. Open a shop to see its
        dashboard exactly as the shop sees it.
      </PageHeader>

      <Card flush>
        {!data ? (
          <div className="p-5">
            <Skeleton className="h-40" />
          </div>
        ) : data.shops.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<Store className="h-6 w-6" aria-hidden="true" />} title="No shops yet" body="Shops appear here as soon as they register." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-body">
              <thead>
                <tr className="border-b-2 border-ink-900 bg-paper-200/60 text-micro font-extrabold uppercase tracking-[0.1em] text-ink-700">
                  <th className="px-5 py-3">Shop</th>
                  <th className="px-3 py-3 text-end">Locks left</th>
                  <th className="px-3 py-3 text-end">Phones</th>
                  <th className="px-3 py-3 text-end">Paid</th>
                  <th className="px-5 py-3 text-end">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-300">
                {data.shops.map((s) => (
                  <tr key={s.dealerId} className="hover:bg-sun-100/60">
                    <td className="px-5 py-3">
                      <p className="font-bold text-ink-900">{s.name}</p>
                      <p className="text-caption text-ink-500">
                        {s.city} · {s.ownerName} · {s.phone}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-end tabular">
                      <span className={s.outOfLocks ? 'font-bold text-critical-700' : s.runningLow ? 'font-bold text-caution-700' : 'text-ink-900'}>
                        {s.available}
                      </span>
                      {s.requestedPack && s.packsBought === 0 && <span className="ms-2 status-pill status-pending">unpaid</span>}
                    </td>
                    <td className="px-3 py-3 text-end tabular text-ink-900">
                      {s.devices.total}
                      {s.devices.locked > 0 && <span className="ms-1 text-caption text-critical-700">({s.devices.locked} locked)</span>}
                    </td>
                    <td className="px-3 py-3 text-end tabular text-ink-900">{money(s.billed)}</td>
                    <td className="px-5 py-3">
                      <span className="flex justify-end gap-2">
                        <a
                          className="btn-ghost px-2 py-1 text-caption"
                          href={`https://wa.me/${whatsappNumber(s.phone)}`}
                          target="_blank"
                          rel="noopener"
                          aria-label={`WhatsApp ${s.name}`}
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        </a>
                        <button type="button" className="btn-secondary py-1 text-caption" onClick={() => openShop(s.dealerId)}>
                          Open shop <ArrowRight className="rtl:rotate-180 h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.fleet.stale > 0 && (
        <p className="flex items-center gap-2 rounded-md border-2 border-ink-900 bg-critical-50 px-3 py-2 text-caption font-semibold text-critical-700">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {data.fleet.stale} managed phones have not checked in for {data.fleet.staleAfterDays}+ days. Open their shop to
          see which.
        </p>
      )}

      {failed && <RetryLine onRetry={load} />}
    </div>
  );
};

export default PlatformDashboardPage;
