import { useEffect, useState } from 'react';
import { Bell, ChevronLeft, MoreVertical } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';

/** One app header, without the website's search/language/dealer toolbar. */
export function AppTopBar() {
  const { role, selectedDealerId } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState(0);
  const platform = role === 'SUPER_ADMIN' && !selectedDealerId;
  useEffect(() => {
    let cancelled = false;
    if (platform) { setPending(0); return; }
    ApiService.getNotifications({ status: 'QUEUED', limit: 1 }).then(res => {
      if (!cancelled) setPending(res.counts?.queued ?? res.pagination?.total ?? 0);
    }).catch(() => setPending(0));
    return () => { cancelled = true; };
  }, [platform, selectedDealerId]);
  return <header className="shop-app-header">
    <div className="shop-app-brand">
      {pathname !== '/' && <button type="button" className="shop-app-icon" aria-label="Back to home" onClick={() => navigate('/')}><ChevronLeft /></button>}
      <img src="/logo-mark.webp" width="29" height="29" alt="" />
      <span>ALMAS SDM</span>
    </div>
    <div className="flex items-center gap-1">
      <button type="button" className="shop-app-icon shop-app-bell" aria-label={platform ? 'Lock orders' : 'Notifications'} onClick={() => navigate(platform ? '/orders' : '/notifications')}><Bell />{pending > 0 && <span className="shop-app-notice">{pending > 99 ? '99+' : pending}</span>}</button>
      <button type="button" className="shop-app-icon" aria-label="All sections" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event('almas:open-sections'))}><MoreVertical /></button>
    </div>
  </header>;
}
