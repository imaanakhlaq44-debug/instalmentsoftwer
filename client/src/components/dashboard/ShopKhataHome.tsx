import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MessageCircle, Plus, RefreshCw, Search, ShieldAlert, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';
import { firstName, money } from '../../utils/format.js';
import { AddCustomerWizardModal } from '../modals/AddCustomerWizardModal.js';
import { WhatsAppModal, type WhatsAppTarget } from '../whatsapp/WhatsAppButton.js';
import { RecordPaymentSheet, type RecordPaymentTarget } from '../payments/RecordPaymentSheet.js';
import { PendingWork } from './PendingWork.js';

/**
 * The shop's home, as the owner chose it: "1 · Khata card".
 *
 * Top to bottom it answers the counter's three questions in order — how much
 * came in today (the SHOP KHATA card), who still owes today (one card per plan,
 * with Remind and Collect on it), and how to start the next sale (the yellow
 * button). It is the website's own look: ink borders, hard shadows, sun
 * yellow, navy and emerald.
 *
 * `app` is the Android shop app's home (one column, sale button docked above
 * the nav). `web` is the website's shop dashboard: the same khata, in two
 * columns on a wide screen.
 */

export interface KhataStats {
  collectedToday: number;
  dueTodayCount: number;
  paidDueTodayCount: number;
  pendingVerificationAmount: number;
  tamperAlertDevices?: number;
  collectedThisMonth?: number;
  outstandingAmount?: number;
  silentDevices?: number;
  frpRefusedDevices?: number;
  frpConfigured?: boolean | null;
}

export interface TodayCustomer {
  planId: string;
  installmentId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceId?: string;
  deviceName: string;
  totalInstallments: number;
  paidInstallments: number;
  installmentsDue: number;
  amountDue: number;
  dueDate: string;
  daysLate: number;
}

interface TodayList {
  total: number;
  dueTodayCount: number;
  lateCount: number;
  customers: TodayCustomer[];
}

/** More segments than this stop reading as "one per installment"; the bar goes solid. */
const MAX_SEGMENTS = 24;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export const SegmentBar: React.FC<{ done: number; total: number; label: string; tone?: 'navy' | 'light' }> = ({ done, total, label, tone = 'light' }) => {
  const safeTotal = Math.max(0, total);
  const safeDone = Math.min(Math.max(0, done), safeTotal);
  return (
    <div
      className={`khata-segments ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={safeDone}
    >
      {safeTotal === 0 ? <span className="khata-seg" /> : safeTotal > MAX_SEGMENTS
        ? <span className="khata-seg solid"><span style={{ width: `${(safeDone / safeTotal) * 100}%` }} /></span>
        : Array.from({ length: safeTotal }, (_, i) => <span key={i} className={`khata-seg${i < safeDone ? ' paid' : ''}`} />)}
    </div>
  );
};

function DuePill({ daysLate }: { daysLate: number }) {
  if (daysLate <= 0) return <span className="khata-pill due">Due today</span>;
  return <span className="khata-pill late">{daysLate === 1 ? '1 day late' : `${daysLate} days late`}</span>;
}

export const ShopKhataHome: React.FC<{ layout?: 'app' | 'web' }> = ({ layout = 'app' }) => {
  const { user, dealer, selectedDealerId, role, isStaff, shopEditMode } = useAuth();
  const navigate = useNavigate();
  // A platform admin looking into a shop reads it unless they switched to editing.
  const canAct = isStaff && !(role === 'SUPER_ADMIN' && !shopEditMode);
  const web = layout === 'web';

  const [stats, setStats] = useState<KhataStats | null>(null);
  const [today, setToday] = useState<TodayList | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [saleOpen, setSaleOpen] = useState(false);
  const [remind, setRemind] = useState<WhatsAppTarget | null>(null);
  const [collect, setCollect] = useState<RecordPaymentTarget | null>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([ApiService.getDashboardStats(selectedDealerId), ApiService.getTodayList(selectedDealerId, web ? 6 : 3)])
      .then(([s, t]) => { if (live) { setStats(s); setToday(t); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [selectedDealerId, reload, web]);

  const refresh = () => setReload((n) => n + 1);
  const more = today ? today.total - today.customers.length : 0;

  const dock = (
    <div className="khata-dock">
      {canAct && (
        <button type="button" className="khata-btn-sun khata-dock-sale" onClick={() => setSaleOpen(true)}>
          <Plus aria-hidden="true" />New sale
        </button>
      )}
      <button type="button" className="khata-dock-search" onClick={() => navigate('/customers')} aria-label="Search customers">
        <Search aria-hidden="true" />{(!canAct || web) && <span>Search customers</span>}
      </button>
    </div>
  );

  return (
    <div className={`khata-home${web ? ' is-web' : ''}`} aria-label={web ? 'Shop dashboard' : 'Shop app home'}>
      {web && (
        <div className="khata-web-head">
          <h1><span>Salam,</span> <span data-i18n-skip>{firstName(user?.name || dealer?.ownerName)}</span></h1>
          <button type="button" className="khata-icon-btn" onClick={refresh} aria-label="Refresh dashboard"><RefreshCw aria-hidden="true" /></button>
        </div>
      )}
      {failed && (
        <div role="alert" className="khata-alert critical">
          <span>Could not load the latest figures.</span>
          <button type="button" onClick={refresh}><RefreshCw aria-hidden="true" />Try again</button>
        </div>
      )}

      <div className="khata-grid">
        <div className="khata-col">
          <section className="khata-hero" aria-label="Today's collection" aria-busy={!stats && !failed}>
            <div className="khata-card">
              <div className="khata-card-strip">
                <span>Shop khata</span>
                <span className="khata-today-pill">Today</span>
              </div>
              <div className="khata-card-body">
                <p className="khata-eyebrow">Received today</p>
                <p className="khata-amount" data-i18n-skip>{stats ? money(stats.collectedToday) : '—'}</p>
                {stats && <>
                  <SegmentBar done={stats.paidDueTodayCount} total={stats.dueTodayCount} label="Today's installments received" />
                  <p className="khata-progress-text">
                    {stats.dueTodayCount
                      ? `${stats.paidDueTodayCount} of ${stats.dueTodayCount} installments received`
                      : 'No installments due today'}
                  </p>
                  {web && (
                    <dl className="khata-stats">
                      <div><dt>Collected this month</dt><dd data-i18n-skip>{money(stats.collectedThisMonth ?? 0)}</dd></div>
                      <div><dt>Total outstanding</dt><dd data-i18n-skip>{money(stats.outstandingAmount ?? 0)}</dd></div>
                    </dl>
                  )}
                </>}
              </div>
            </div>
          </section>

          {web && dock}

          {stats && stats.pendingVerificationAmount > 0 && (
            <button type="button" className="khata-alert" onClick={() => navigate('/payments?status=PENDING')}>
              <Wallet aria-hidden="true" /><span><strong data-i18n-skip>{money(stats.pendingVerificationAmount)}</strong> <span>Payments awaiting confirmation</span></span><ArrowRight className="rtl:rotate-180" aria-hidden="true" />
            </button>
          )}
          {stats && (stats.tamperAlertDevices ?? 0) > 0 && (
            <button type="button" className="khata-alert critical" onClick={() => navigate('/devices?tamper=true')}>
              <ShieldAlert aria-hidden="true" /><span>{stats.tamperAlertDevices} <span>Phones need inspection</span></span><ArrowRight className="rtl:rotate-180" aria-hidden="true" />
            </button>
          )}
          {stats && ((stats.silentDevices ?? 0) > 0 || (stats.frpRefusedDevices ?? 0) > 0) && (
            <button type="button" className="khata-alert" onClick={() => navigate('/devices')}>
              <ShieldAlert aria-hidden="true" /><span>Check phone connection or protection</span><ArrowRight className="rtl:rotate-180" aria-hidden="true" />
            </button>
          )}
          {stats && stats.frpConfigured === false && canAct && (
            <button type="button" className="khata-alert" onClick={() => navigate('/settings')}>
              <ShieldAlert aria-hidden="true" /><span>Finish phone protection setup</span><ArrowRight className="rtl:rotate-180" aria-hidden="true" />
            </button>
          )}

          {canAct && <div className="khata-pending"><PendingWork /></div>}
        </div>

        <section className="khata-col" aria-labelledby="khata-due-title">
          <h2 id="khata-due-title" className="khata-section-title">To collect today</h2>
          {today && today.customers.length === 0 && (
            <div className="khata-empty">Nobody owes an installment today.</div>
          )}
          <ul className="khata-list">
            {today?.customers.map((c) => (
              <li key={c.planId} className="khata-customer">
                <button type="button" className="khata-customer-top" onClick={() => navigate(`/customers/${c.customerId}`)}>
                  <span className="khata-avatar" aria-hidden="true" data-i18n-skip>{initials(c.customerName)}</span>
                  <span className="khata-who">
                    <strong data-i18n-skip>{c.customerName}</strong>
                    <small><span data-i18n-skip>{c.deviceName}</span> · <span>{`${c.totalInstallments} months`}</span></small>
                  </span>
                </button>
                <div className="khata-customer-money">
                  <span className="khata-due-amount" data-i18n-skip>{money(c.amountDue)}</span>
                  <DuePill daysLate={c.daysLate} />
                </div>
                <SegmentBar done={c.paidInstallments} total={c.totalInstallments} label={`${c.paidInstallments} of ${c.totalInstallments} paid`} />
                <p className="khata-paid-count">{`${c.paidInstallments} of ${c.totalInstallments} paid`}</p>
                {canAct && (
                  <div className="khata-actions">
                    <button
                      type="button"
                      className="khata-btn-wa"
                      onClick={() => setRemind({
                        customerId: c.customerId,
                        customerName: c.customerName,
                        kind: c.daysLate > 0 ? 'OVERDUE' : 'DUE_REMINDER',
                        installmentId: c.installmentId,
                        planId: c.planId,
                      })}
                    >
                      <MessageCircle aria-hidden="true" />Remind
                    </button>
                    <button
                      type="button"
                      className="khata-btn-ink"
                      onClick={() => setCollect({ customerId: c.customerId, customerName: c.customerName, planId: c.planId, suggestedAmount: c.amountDue })}
                    >
                      <Wallet aria-hidden="true" />Collect payment
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {more > 0 && (
            <button type="button" className="khata-more" onClick={() => navigate(today && today.lateCount ? '/installments?status=OVERDUE' : '/installments')}>
              <span>{`+ ${more} more customers today · see all`}</span>
              <ArrowRight className="rtl:rotate-180" aria-hidden="true" />
            </button>
          )}
        </section>
      </div>

      {!web && dock}

      {saleOpen && <AddCustomerWizardModal onClose={() => setSaleOpen(false)} onSuccess={refresh} />}
      {remind && <WhatsAppModal {...remind} onClose={() => setRemind(null)} />}
      {collect && <RecordPaymentSheet {...collect} onClose={() => setCollect(null)} onRecorded={refresh} />}
    </div>
  );
};
