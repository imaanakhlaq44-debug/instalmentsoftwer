import { useEffect, useState } from 'react';
import { Bell, ChevronLeft, Settings } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { vibrateForNotification } from '../../utils/notificationHaptics.js';
import { ApiService } from '../../services/api.js';

/** One app header, without the website's search/language/dealer toolbar. */
export function AppTopBar() {
  const { role, selectedDealerId } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState(0);
  const platform = role === 'SUPER_ADMIN' && !selectedDealerId;
  useEffect(() => {
    let cancelled = false, busy = false;
    let previous: Set<string> | null = null;
    setPending(0);
    const refresh = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const result = platform ? await ApiService.getPlatformOverview() : await ApiService.getNotifications({ status: 'QUEUED', limit: 20 });
        if (cancelled) return;
        const ids = new Set<string>(platform ? (result as any).awaitingPayment.map((n: any) => n.id) : (result as any).data.map((n: any) => n.id));
        setPending(platform ? (result as any).awaitingPayment.length + ((result as any).totals.ordersToCheck ?? 0) : (result as any).counts?.queued ?? (result as any).pagination?.total ?? 0);
        if (previous && [...ids].some(id => !previous!.has(id))) vibrateForNotification();
        previous = ids;
      } catch { /* Keep the last known badge during a temporary network failure. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const visible = () => { void refresh(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [platform, selectedDealerId]);
  return <header className="shop-app-header">
    <div className="shop-app-brand">
      {pathname !== '/' && <button type="button" className="shop-app-icon" aria-label="Back to home" onClick={() => navigate('/')}><ChevronLeft /></button>}
      <img src="/logo-mark.webp" width="29" height="29" alt="" />
      <span>ALMAS SDM</span>
    </div>
    <div className="flex items-center gap-1">
      <button type="button" className="shop-app-icon shop-app-bell" aria-label={platform ? 'Lock orders' : 'Notifications'} onClick={() => navigate(platform ? '/orders' : '/notifications')}><Bell />{pending > 0 && <span className="shop-app-notice">{pending > 99 ? '99+' : pending}</span>}</button>
      <button type="button" className="shop-app-icon" aria-label="App settings" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event('almas:open-sections'))}><Settings /></button>
    </div>
  </header>;
}


