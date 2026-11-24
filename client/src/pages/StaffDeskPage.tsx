import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, LogOut, MessageCircle, Phone, Plus, QrCode, RefreshCw, Search, Wallet } from 'lucide-react';
import { AddCustomerWizardModal } from '../components/modals/AddCustomerWizardModal.js';
import { EnrollmentPage } from './EnrollmentPage.js';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { LanguageToggle } from '../i18n/LanguageContext.js';
import { money } from '../utils/format.js';
import { whatsappNumber } from './PlatformDashboardPage.js';
import { initials } from '../components/dashboard/ShopKhataHome.js';
import { RecordPaymentSheet, type RecordPaymentTarget } from '../components/payments/RecordPaymentSheet.js';

/**
 * The whole app, for a shop's staff login.
 *
 * The owner's rule: every staff login contacts customers (the number, with
 * Call and WhatsApp). Counter staff also take payments at the counter (they
 * wait for the owner's approval), make new sales and connect the sold phone.
 * Nothing else is on this screen, and the server refuses everything else too,
 * so there is no menu, no settings and no account deletion here.
 */
export interface StaffDeskPlan {
  planId: string;
  deviceName: string;
  totalInstallments: number;
  paidInstallments: number;
  installmentsDue: number;
  amountDue: number;
  daysLate: number;
  installmentId: string | null;
  nextAmount: number;
  nextDueDate: string | null;
}

export interface StaffDeskCustomer {
  customerId: string;
  name: string;
  phone: string;
  amountDue: number;
  daysLate: number;
  plans: StaffDeskPlan[];
}

const DuePill: React.FC<{ plan: StaffDeskPlan }> = ({ plan }) => {
  if (plan.amountDue <= 0) return <span className="khata-pill ok">Up to date</span>;
  if (plan.daysLate <= 0) return <span className="khata-pill due">Due today</span>;
  return <span className="khata-pill late">{plan.daysLate === 1 ? '1 day late' : `${plan.daysLate} days late`}</span>;
};

export const StaffDeskPage: React.FC = () => {
  const location = useLocation();
  const { user, dealer, role, logout } = useAuth();
  const canCollect = role === 'DEALER_STAFF';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<StaffDeskCustomer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [paying, setPaying] = useState<RecordPaymentTarget | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await ApiService.getStaffDesk(query || undefined);
      setCustomers(res?.customers ?? []);
    } catch {
      setFailed(true);
      setCustomers([]);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  // Debounce typing so every key press is not a request.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // Counter staff can also open the connect-phone screen; every other address
  // comes back to the desk.
  if (canCollect && location.pathname === '/enrollment') {
    return (
      <div className="staff-desk">
        <header className="staff-desk-head">
          <button type="button" className="khata-icon-btn" onClick={() => navigate('/')} aria-label="Back to customers">
            <ChevronLeft aria-hidden="true" />
          </button>
          <div className="staff-desk-who">
            <p className="khata-eyebrow" data-i18n-skip>{dealer?.name ?? 'ALMAS SDM'}</p>
            <strong>Connect phone</strong>
          </div>
          <div className="staff-desk-tools"><LanguageToggle /></div>
        </header>
        <div className="p-4"><EnrollmentPage /></div>
      </div>
    );
  }
  if (location.pathname !== '/') return <Navigate to="/" replace />;

  return (
    <div className="staff-desk">
      <header className="staff-desk-head">
        <div className="staff-desk-who">
          <p className="khata-eyebrow" data-i18n-skip>{dealer?.name ?? 'ALMAS SDM'}</p>
          <strong data-i18n-skip>{user?.name}</strong>
          <span className="staff-desk-role">{canCollect ? 'Counter staff' : 'View only'}</span>
        </div>
        <div className="staff-desk-tools">
          <LanguageToggle />
          <button type="button" className="khata-icon-btn" onClick={() => logout()} aria-label="Sign out">
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="khata-home is-staff">
        <section className="staff-desk-intro" aria-label="What you can do">
          <p>{canCollect ? 'Make sales, connect phones, call customers and take installments. Payments are added once the owner approves them.' : 'Call customers about their installments.'}</p>
        </section>

        {canCollect && (
          <div className="khata-dock staff-desk-jobs">
            <button type="button" className="khata-btn-sun khata-dock-sale" onClick={() => setSaleOpen(true)}>
              <Plus aria-hidden="true" />New sale
            </button>
            <button type="button" className="khata-btn-ink" onClick={() => navigate('/enrollment')}>
              <QrCode aria-hidden="true" />Connect phone
            </button>
          </div>
        )}

        <label className="staff-desk-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search by name or phone</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone"
            aria-label="Search by name or phone"
          />
          <button type="button" className="khata-icon-btn" onClick={() => void load()} aria-label="Refresh list">
            <RefreshCw aria-hidden="true" />
          </button>
        </label>

        <h2 className="khata-section-title">Customers</h2>
        {failed && <div role="alert" className="khata-alert critical">Could not load customers. Check the internet and try again.</div>}
        {customers === null && <div className="khata-empty" aria-busy="true">Loading…</div>}
        {customers && customers.length === 0 && !failed && (
          <div className="khata-empty">{query ? 'No customer matches this search.' : 'No customers yet.'}</div>
        )}

        <ul className="khata-list">
          {customers?.map((c) => (
            <li key={c.customerId} className="khata-customer">
              <div className="khata-customer-top">
                <span className="khata-avatar" aria-hidden="true" data-i18n-skip>{initials(c.name)}</span>
                <span className="khata-who">
                  <strong data-i18n-skip>{c.name}</strong>
                  <small dir="ltr" data-i18n-skip>{c.phone}</small>
                </span>
                {c.amountDue > 0 && <span className="khata-due-amount" data-i18n-skip>{money(c.amountDue)}</span>}
              </div>

              {c.plans.map((p) => (
                <div key={p.planId} className="staff-desk-plan">
                  <div className="staff-desk-plan-line">
                    <span className="staff-desk-device" data-i18n-skip>{p.deviceName}</span>
                    <DuePill plan={p} />
                  </div>
                  <p className="khata-paid-count">{`${p.paidInstallments} of ${p.totalInstallments} installments received`}</p>
                  {canCollect && (
                    <button
                      type="button"
                      className="khata-btn-sun staff-desk-collect"
                      aria-label={`Collect payment from ${c.name}`}
                      onClick={() => setPaying({
                        customerId: c.customerId,
                        customerName: c.name,
                        planId: p.planId,
                        suggestedAmount: p.amountDue > 0 ? p.amountDue : p.nextAmount,
                      })}
                    >
                      <Wallet aria-hidden="true" />Collect payment
                    </button>
                  )}
                </div>
              ))}

              {c.phone && (
                <div className="khata-actions">
                  <a className="khata-btn-ink" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${c.name}`}>
                    <Phone aria-hidden="true" />Call
                  </a>
                  <a className="khata-btn-wa" href={`https://wa.me/${whatsappNumber(c.phone)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${c.name}`}>
                    <MessageCircle aria-hidden="true" />WhatsApp
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {paying && (
        <RecordPaymentSheet {...paying} onClose={() => setPaying(null)} onRecorded={() => void load()} />
      )}
      {saleOpen && <AddCustomerWizardModal onClose={() => setSaleOpen(false)} onSuccess={() => void load()} />}
    </div>
  );
};
