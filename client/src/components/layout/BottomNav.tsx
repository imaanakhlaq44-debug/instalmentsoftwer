import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Link } from 'react-router-dom';
import { Menu, X, ChevronRight, ShieldCheck, UserRoundMinus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { navItemsForRole, NAV_GROUPS } from './navItems.js';

/** Which sections earn a slot on the small mobile bar, in priority order. */
const MOBILE_PRIORITY = ['/', '/devices', '/payments', '/customers', '/installments', '/orders', '/shops', '/licenses'];

export const BottomNav: React.FC = () => {
  const { role, selectedDealerId } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => { setMoreOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('[aria-label="More sections"] a, [aria-label="More sections"] button'));
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1]?.focus(); }
        if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const resized = () => { if (window.innerWidth >= 1024) close(); };
    window.addEventListener('resize', resized);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); window.removeEventListener('resize', resized); };
  }, [moreOpen]);

  // Same role-filtered source as the sidebar, trimmed to five slots.
  const allowed = navItemsForRole(role, Boolean(selectedDealerId));
  const items = MOBILE_PRIORITY.map((path) => allowed.find((i) => i.to === path))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .slice(0, 4)
    .map((i) => ({ ...i, label: i.to === '/' ? 'Home' : i.label.replace('Device ', '') }));

  if (items.length === 0) return null;

  return (
    <><nav aria-label="Main mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t
                 border-ink-900 bg-paper-50/95 backdrop-blur-sm lg:hidden"
      // Keeps the bar clear of the iOS home indicator.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-h-16 flex-1 flex-col items-center gap-1 py-2.5 text-micro normal-case tracking-normal transition-colors ${
                isActive ? 'text-accent-700' : 'text-ink-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`rounded-lg px-4 py-1 ${isActive ? 'bg-sun-200 text-ink-900' : ''}`}><Icon className="h-5 w-5" aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.8} /></span>
                <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
      <button ref={trigger} type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} aria-haspopup="dialog" className="flex min-h-16 flex-1 flex-col items-center gap-1 py-2.5 text-micro text-ink-700"><span className="rounded-lg px-4 py-1"><Menu className="h-5 w-5" /></span><span>More</span></button>
    </nav>
    {moreOpen && createPortal(<div className="fixed inset-0 z-[90] flex items-end bg-ink-900/50 lg:hidden" onClick={close}>
      <section role="dialog" aria-modal="true" aria-label="More sections" onClick={e => e.stopPropagation()} className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-2 border-ink-900 bg-paper-100 p-5 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
        <header className="mb-5 flex items-center justify-between"><div><p className="eyebrow">ALMAS SDM</p><h2 className="text-title font-black">All sections</h2></div><button ref={closeButton} type="button" aria-label="Close more sections" className="btn-secondary p-2.5" onClick={close}><X className="h-5 w-5" /></button></header>
        {NAV_GROUPS.map(group => {
          const links = allowed.filter(item => item.group === group);
          return links.length ? <div key={group} className="mb-5"><h3 className="eyebrow mb-2">{group}</h3><div className="surface divide-y divide-paper-300 overflow-hidden">{links.map(item => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={close} className={({isActive}) => `flex min-h-12 items-center gap-3 px-4 py-3 text-body font-bold ${isActive ? 'bg-sun-200 text-ink-900' : 'hover:bg-paper-200'}`}><Icon className="h-5 w-5" /><span className="flex-1">{item.label}</span><ChevronRight className="h-4 w-4" /></NavLink>; })}</div></div> : null;
        })}
        <div className="grid gap-2 sm:grid-cols-2"><Link className="btn-secondary justify-start" to="/privacy" onClick={close}><ShieldCheck className="h-4 w-4" />Privacy</Link><Link className="btn-secondary justify-start" to="/account-deletion" onClick={close}><UserRoundMinus className="h-4 w-4" />Delete account</Link></div>
      </section></div>,document.body)}
    </>
  );
};
