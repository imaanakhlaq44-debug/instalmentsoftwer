import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardList, MessageCircle, RefreshCw, Search, Store } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';
import { money } from '../../utils/format.js';
import { whatsappNumber, type PlatformOverview } from '../../pages/PlatformDashboardPage.js';
import { SegmentBar, initials } from './ShopKhataHome.js';

/**
 * The platform owner's home in the shop app, in the same khata style as a
 * shop's: what the platform earned this month, the orders waiting on a
 * decision, and the shops that need a word (out of locks, running low, or with
 * phones behind on payments) — each one a WhatsApp or a tap away.
 */

type ShopRow = PlatformOverview['shops'][number];

/** Out of locks first, then running low, then the most phones behind. */
export function shopsNeedingAttention(shops: ShopRow[]): ShopRow[] {
  const weight = (s: ShopRow) => (s.outOfLocks ? 2 : s.runningLow ? 1 : 0);
  return [...shops].sort((a, b) => weight(b) - weight(a) || b.devices.overdue - a.devices.overdue || b.consumed - a.consumed);
}

function LocksPill({ shop }: { shop: ShopRow }) {
  if (shop.outOfLocks) return <span className="khata-pill late">Out of locks</span>;
  if (shop.runningLow) return <span className="khata-pill due">{`${shop.available} locks left`}</span>;
  return <span className="khata-pill ok">{`${shop.available} locks left`}</span>;
}

export const PlatformKhataHome: React.FC = () => {
  const navigate = useNavigate();
  const { setSelectedDealerId } = useAuth();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    ApiService.getPlatformOverview()
      .then((result) => { if (live) setData(result); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [reload]);

  const totals = data?.totals;
  const orders = data ? data.awaitingPayment.length + (data.totals.ordersToCheck ?? 0) : 0;
  const ranked = data ? shopsNeedingAttention(data.shops) : [];
  const shown = ranked.slice(0, 3);
  const more = ranked.length - shown.length;
  const openShop = (dealerId: string) => { setSelectedDealerId(dealerId); navigate('/'); window.scrollTo(0, 0); };

  return (
    <div className="khata-home" aria-label="Platform app home">
      {failed && (
        <div role="alert" className="khata-alert critical">
          <span>Could not load the latest figures.</span>
          <button type="button" onClick={() => setReload((n) => n + 1)}><RefreshCw aria-hidden="true" />Try again</button>
        </div>
      )}

      <section className="khata-hero" aria-label="Platform earnings" aria-busy={!data && !failed}>
        <div className="khata-card">
          <div className="khata-card-strip">
            <span>Platform khata</span>
            <span className="khata-today-pill">This month</span>
          </div>
          <div className="khata-card-body">
            <p className="khata-eyebrow">Earned this month</p>
            <p className="khata-amount" data-i18n-skip>{totals ? money(totals.revenueThisMonth) : '—'}</p>
            {totals && <>
              <SegmentBar done={totals.locksConsumed} total={totals.locksSold} label="Locks on phones" />
              <p className="khata-progress-text">{`${totals.locksConsumed} of ${totals.locksSold} locks on phones`}</p>
              <dl className="khata-stats">
                <div><dt>Earned in total</dt><dd data-i18n-skip>{money(totals.revenue)}</dd></div>
                <div><dt>Locks sold this month</dt><dd>{totals.locksSoldThisMonth}</dd></div>
              </dl>
            </>}
          </div>
        </div>
      </section>

      {data && (
        <button type="button" className={`khata-alert${orders ? '' : ' calm'}`} onClick={() => navigate('/orders')}>
          <ClipboardList aria-hidden="true" />
          <span>{orders ? `${orders} lock orders to check` : 'No orders waiting'}</span>
          <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
        </button>
      )}

      <section aria-labelledby="platform-shops-title">
        <h2 id="platform-shops-title" className="khata-section-title">Shops to look at</h2>
        {data && shown.length === 0 && <div className="khata-empty">No shops yet.</div>}
        <ul className="khata-list">
          {shown.map((shop) => {
            const total = shop.available + shop.consumed;
            return (
              <li key={shop.dealerId} className="khata-customer">
                <button type="button" className="khata-customer-top" onClick={() => openShop(shop.dealerId)}>
                  <span className="khata-avatar" aria-hidden="true" data-i18n-skip>{initials(shop.name)}</span>
                  <span className="khata-who">
                    <strong data-i18n-skip>{shop.name}</strong>
                    <small><span data-i18n-skip>{shop.city}</span> · <span data-i18n-skip>{shop.ownerName}</span></small>
                  </span>
                </button>
                <div className="khata-customer-money">
                  <span className="khata-due-amount">{`${shop.devices.total} phones`}</span>
                  <LocksPill shop={shop} />
                </div>
                <SegmentBar done={shop.consumed} total={total} label={`${shop.consumed} of ${total} locks used`} />
                <p className="khata-paid-count">
                  <span>{`${shop.consumed} of ${total} locks used`}</span>
                  {shop.devices.overdue > 0 && <> · <span className="khata-warn">{`${shop.devices.overdue} phones behind`}</span></>}
                </p>
                <div className="khata-actions">
                  <a className="khata-btn-wa" href={`https://wa.me/${whatsappNumber(shop.phone)}`} target="_blank" rel="noreferrer">
                    <MessageCircle aria-hidden="true" />WhatsApp
                  </a>
                  <button type="button" className="khata-btn-ink" onClick={() => openShop(shop.dealerId)}>
                    <Store aria-hidden="true" />Open shop
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {more > 0 && (
          <button type="button" className="khata-more" onClick={() => navigate('/shops')}>
            <span>{`+ ${more} more shops · see all`}</span>
            <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
          </button>
        )}
      </section>

      <div className="khata-dock">
        <button type="button" className="khata-btn-sun khata-dock-sale" onClick={() => navigate('/orders')}>
          <ClipboardList aria-hidden="true" />Lock orders
        </button>
        <button type="button" className="khata-dock-search" onClick={() => navigate('/shops')} aria-label="Search shops">
          <Search aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
