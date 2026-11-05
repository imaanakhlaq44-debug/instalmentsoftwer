import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Clock, KeyRound, MessageCircle, Phone, Store, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { Card, CardHeader, EmptyState, Skeleton } from '../components/ui/Card.js';
import { money, shortDate } from '../utils/format.js';

/**
 * The super admin's home: the platform, not a shop.
 *
 * A shop owner's dashboard is about their customers. The platform owner's day
 * is different — confirm who has paid and give them their locks, see which shops
 * are about to run out, know what was earned, and notice handsets that have gone
 * quiet. Picking a shop (here or in the top bar) still opens that shop's own
 * dashboard, exactly as the shop sees it.
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
  { key: 'INACTIVE', label: 'Inactive', dot: 'bg-ink-400' },
];

export const PlatformDashboardPage: React.FC = () => {
  const { user, showToast, setSelectedDealerId } = useAuth();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);

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

  const issue = async (shop: WaitingShop) => {
    const ok = window.confirm(
      `Has ${shop.name} paid ${money(shop.requestedPack.totalPrice)}?\n\n` +
        `This issues ${shop.requestedPack.size} locks to them now and cannot be undone.`
    );
    if (!ok) return;
    try {
      setIssuing(shop.dealerId);
      const res = await ApiService.issueLicensePack({ dealerId: shop.dealerId, size: shop.requestedPack.size });
      showToast(res.message || `${shop.requestedPack.size} locks issued to ${shop.name}`, 'success');
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Could not issue the locks', 'error');
    } finally {
      setIssuing(null);
    }
  };

  const firstName = (user?.name || 'there').split(' ')[0];
  const t = data?.totals;
  const watchList = (data?.shops ?? []).filter((s) => s.outOfLocks || s.runningLow);
  const fleetTotal = Object.values(data?.fleet.byStatus ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Platform</p>
        <h1 className="mt-1 text-display text-ink-900">Salam, {firstName}</h1>
        <p className="mt-1 text-body text-ink-500">
          {t ? `${t.shops} shops · ${t.locksConsumed} phones under lock · ${t.shopsAwaitingPayment} waiting to pay` : 'Loading the platform…'}
        </p>
      </header>

      {/* Money first: what the platform has earned. */}
      <div className="surface grid divide-y-2 divide-paper-300 sm:grid-cols-3 sm:divide-x-2 sm:divide-y-0">
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

      {/* The one thing that needs the platform owner every day. */}
      <Card>
        <CardHeader
          title="Waiting to pay"
          hint="New shops that signed up. Issue their locks once the money has arrived."
        />
        <div className="mt-4">
          {!data ? (
            <Skeleton className="h-20" />
          ) : data.awaitingPayment.length === 0 ? (
            <EmptyState icon={<Clock className="h-6 w-6" aria-hidden="true" />} title="Nobody is waiting" body="New sign-ups appear here with the pack they asked for." />
          ) : (
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
                      Wants <b>{s.requestedPack.size} locks</b> · {money(s.requestedPack.unitPrice)} each ·{' '}
                      <b>{money(s.requestedPack.totalPrice)}</b>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      className="btn-secondary py-1.5 text-caption"
                      href={`https://wa.me/${whatsappNumber(s.phone)}`}
                      target="_blank"
                      rel="noopener"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
                    </a>
                    <a className="btn-secondary py-1.5 text-caption" href={`tel:${s.phone}`}>
                      <Phone className="h-4 w-4" aria-hidden="true" /> Call
                    </a>
                    <button
                      type="button"
                      className="btn-primary py-1.5 text-caption"
                      disabled={issuing !== null}
                      onClick={() => issue(s)}
                    >
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      {issuing === s.dealerId ? 'Issuing…' : `Paid — issue ${s.requestedPack.size} locks`}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Every shop, and how many locks it has left. */}
        <Card className="lg:col-span-2" flush>
          <div className="p-5 pb-3">
            <CardHeader title="Shops" hint="Locks left, phones under management, and what each has paid" />
          </div>
          {!data ? (
            <div className="p-5 pt-0">
              <Skeleton className="h-40" />
            </div>
          ) : data.shops.length === 0 ? (
            <div className="p-5 pt-0">
              <EmptyState icon={<Store className="h-6 w-6" aria-hidden="true" />} title="No shops yet" body="Shops appear here as soon as they register." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body">
                <thead>
                  <tr className="border-y-2 border-ink-900 bg-paper-200/60 text-micro font-extrabold uppercase tracking-[0.1em] text-ink-700">
                    <th className="px-5 py-2.5">Shop</th>
                    <th className="px-3 py-2.5 text-right">Locks left</th>
                    <th className="px-3 py-2.5 text-right">Phones</th>
                    <th className="px-3 py-2.5 text-right">Paid</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {data.shops.map((s) => (
                    <tr key={s.dealerId} className="hover:bg-sun-100/60">
                      <td className="px-5 py-3">
                        <p className="font-bold text-ink-900">{s.name}</p>
                        <p className="text-caption text-ink-500">
                          {s.city} · {s.ownerName}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right tabular">
                        <span className={s.outOfLocks ? 'font-bold text-critical-700' : s.runningLow ? 'font-bold text-caution-700' : 'text-ink-900'}>
                          {s.available}
                        </span>
                        {s.requestedPack && s.packsBought === 0 && (
                          <span className="ml-2 status-pill status-pending">unpaid</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-900">
                        {s.devices.total}
                        {s.devices.locked > 0 && <span className="ml-1 text-caption text-critical-700">({s.devices.locked} locked)</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-900">{money(s.billed)}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-caption"
                          onClick={() => {
                            setSelectedDealerId(s.dealerId);
                            window.scrollTo(0, 0);
                          }}
                          aria-label={`Open ${s.name}`}
                        >
                          Open <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {/* Shops about to be unable to sell. */}
          <Card>
            <CardHeader title="Running out" hint="Five locks or fewer left" />
            <div className="mt-3">
              {!data ? (
                <Skeleton className="h-16" />
              ) : watchList.length === 0 ? (
                <p className="text-body text-ink-500">Every paying shop has locks to spare.</p>
              ) : (
                <ul className="space-y-2">
                  {watchList.map((s) => (
                    <li key={s.dealerId} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <AlertTriangle className={`h-4 w-4 shrink-0 ${s.outOfLocks ? 'text-critical-600' : 'text-caution-600'}`} aria-hidden="true" />
                        <span className="truncate font-semibold text-ink-900">{s.name}</span>
                      </span>
                      <span className="tabular text-caption font-bold text-ink-700">{s.available} left</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Every phone on the platform, and the ones that went quiet. */}
          <Card>
            <CardHeader title="Phones" hint="Every handset across all shops" />
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
              {data && data.fleet.stale > 0 && (
                <p className="flex items-center gap-2 rounded-md border-2 border-ink-900 bg-critical-50 px-3 py-2 text-caption font-semibold text-critical-700">
                  <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {data.fleet.stale} managed phones have not checked in for {data.fleet.staleAfterDays}+ days
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {failed && (
        <p className="text-center text-caption text-ink-500">
          <button type="button" className="underline" onClick={load}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
};

export default PlatformDashboardPage;
