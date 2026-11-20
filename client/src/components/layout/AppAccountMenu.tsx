import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { LanguageToggle } from '../../i18n/LanguageContext.js';
import { ApiService } from '../../services/api.js';

export function AppAccountMenu({ close }: { close: () => void }) {
  const { user, role, logout, selectedDealerId, setSelectedDealerId } = useAuth();
  const navigate = useNavigate();
  const [shops, setShops] = useState<{ dealerId: string; dealerName: string }[]>([]);
  useEffect(() => {
    let live = true;
    if (role === 'SUPER_ADMIN') ApiService.getLicenses().then(result => { if (live) setShops(result.dealers ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, [role]);
  return <div className="mb-5 space-y-4">
    <div><p className="font-bold" data-i18n-skip>{user?.name}</p><p className="text-caption text-ink-500" data-i18n-skip>{user?.email}</p></div>
    <LanguageToggle />
    {role === 'SUPER_ADMIN' && <div><label htmlFor="app-shop" className="field-label">Open a shop</label><select id="app-shop" className="input" value={selectedDealerId || ''} onChange={event => { setSelectedDealerId(event.target.value || undefined); navigate('/'); close(); }}><option value="">All shops (platform)</option>{shops.map(shop => <option key={shop.dealerId} value={shop.dealerId}>{shop.dealerName}</option>)}</select></div>}
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="btn-secondary text-caption" onClick={() => { close(); navigate('/change-password'); }}><KeyRound className="h-4 w-4" />Change password</button>
      <button type="button" className="btn-secondary text-caption" onClick={() => { close(); logout(); }}><LogOut className="h-4 w-4" />Sign out</button>
    </div>
    <button type="button" className="btn-secondary w-full" onClick={() => {
      close();
      const bridge = (window as unknown as { AlmasDocument?: { postMessage: (value: string) => void } }).AlmasDocument;
      bridge?.postMessage(JSON.stringify({ action: 'menu' }));
    }}><SlidersHorizontal className="h-4 w-4" />App options</button>
  </div>;
}
