import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardList, Plus, RefreshCw, Smartphone, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { firstName, money } from '../utils/format.js';
import { ShopKhataHome } from '../components/dashboard/ShopKhataHome.js';
import { PlatformKhataHome } from '../components/dashboard/PlatformKhataHome.js';

interface AppStats {
  collectedToday: number; collectedThisMonth: number; outstandingAmount: number;
  dueTodayCount: number; paidDueTodayCount: number; totalDevices: number; totalCustomers: number;
  overdueInstallmentsCount: number; pendingVerificationAmount: number; tamperAlertDevices?: number;
}
type Tile = { label: string; icon: typeof Plus; action: () => void; tone: string; disabled?: boolean };
const TILE_ART: Record<string, string> = {
  'New sale': 'agreement', 'Record payment': 'wallet', 'Scan new phone': 'phone', 'Customer list': 'customer',
  'My phones': 'phone', 'My payments': 'wallet', Installments: 'agreement', Notifications: 'agreement',
  'Lock orders': 'agreement', 'All shops': 'customer', 'Device Locks': 'wallet', 'Phone tests': 'phone',
  Phones: 'phone', Payments: 'wallet',
};
const amount = (value?: number) => value == null ? '—' : money(value);

function Greeting() {
  const { user, dealer } = useAuth();
  return <div className="app-home-greeting"><h1><span>Salam,</span> <span data-i18n-skip>{firstName(user?.name || dealer?.ownerName)}</span> <span aria-hidden="true">👋</span></h1><img className="app-home-hero-phone" src="/icons/3d/phone.png" alt="" width="70" height="82" aria-hidden="true" /></div>;
}

function Tiles({ items }: { items: Tile[] }) {
  return <div className="app-home-tiles">{items.map(({ icon: Icon, ...item }) => <button type="button" key={item.label} className={`app-home-tile ${item.tone}`} onClick={item.action} disabled={item.disabled}>{TILE_ART[item.label] ? <img className="app-home-tile-art" src={`/icons/3d/${TILE_ART[item.label]}.png`} alt="" width="64" height="64" aria-hidden="true" /> : <Icon aria-hidden="true" />}<span>{item.label}</span></button>)}</div>;
}
function Failure({ retry }: { retry: () => void }) {
  return <div role="alert" className="app-home-error"><p>Could not load the latest figures.</p><button type="button" onClick={retry}><RefreshCw className="h-4 w-4" />Try again</button></div>;
}
export function ShopAppHomePage() {
  const { role, selectedDealerId } = useAuth();
  if (role === 'SUPER_ADMIN' && !selectedDealerId) return <PlatformKhataHome />;
  // The shop's own team gets the khata home; a customer keeps their own phones and payments.
  return role === 'CUSTOMER' ? <PortfolioHome /> : <ShopKhataHome />;
}

/** A customer's own home in the shop app: their phones, payments and dues. */
function PortfolioHome() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AppStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true; setStats(null); setFailed(false);
    ApiService.getDashboardStats().then(data => { if (live) setStats(data); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [reload]);
  const items: Tile[] = [
    { label: 'My phones', icon: Smartphone, action: () => navigate('/devices'), tone: 'navy' },
    { label: 'My payments', icon: Wallet, action: () => navigate('/payments'), tone: 'paper' },
    { label: 'Installments', icon: CalendarDays, action: () => navigate('/installments'), tone: 'mint' },
    { label: 'Notifications', icon: ClipboardList, action: () => navigate('/notifications'), tone: 'peach' },
  ];
  return <div className="app-home" aria-label="Shop app home">
    {failed && <Failure retry={() => setReload(n => n + 1)} />}
    <section className="app-home-money" aria-label="Collection overview" aria-busy={!stats && !failed}>
      <Greeting />
      <div className="app-home-money-top"><h2>Today's collection</h2>{stats && <span className="app-home-chip" aria-label="Today's scheduled installments paid">{stats.dueTodayCount ? <>{stats.paidDueTodayCount} / {stats.dueTodayCount} <span>paid</span></> : <span>No dues today</span>}</span>}</div>
      <p className="app-home-amount" data-i18n-skip>{amount(stats?.collectedToday)}</p>
      <dl className="app-home-money-details"><div><dt>Total outstanding</dt><dd data-i18n-skip>{amount(stats?.outstandingAmount)}</dd></div><div><dt>Collected this month</dt><dd data-i18n-skip>{amount(stats?.collectedThisMonth)}</dd></div></dl>
    </section>
    <Tiles items={items} />
    {stats && <>
      <button type="button" className="app-home-attention" onClick={() => navigate(stats.overdueInstallmentsCount ? '/installments?status=OVERDUE' : '/installments')}>
        <span className="app-home-count">{stats.overdueInstallmentsCount}</span><span className="min-w-0 flex-1"><strong>{stats.overdueInstallmentsCount ? 'Installments past due' : 'No overdue installments'}</strong><small>{stats.overdueInstallmentsCount ? 'Open the list and follow up' : 'View your installment schedule'}</small></span><ArrowRight className="rtl:rotate-180" />
      </button>
    </>}
  </div>;
}
