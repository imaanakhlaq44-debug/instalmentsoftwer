import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { ApiService } from '../../services/api.js';
export function DeleteShopDialog({ shop, onClose, onDeleted }: { shop: { dealerId: string; name: string }; onClose: () => void; onDeleted: () => void }) {
  const [name,setName] = useState(''); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement; const overflow = document.body.style.overflow; document.body.style.overflow='hidden';
    panel.current?.querySelector('input')?.focus();
    const key = (e: KeyboardEvent) => { if(e.key==='Escape') { e.preventDefault(); if(!busy) onClose(); }
      if(e.key==='Tab') { const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') ?? []); if(e.shiftKey && document.activeElement===nodes[0]) {e.preventDefault();nodes.at(-1)?.focus();} else if(!e.shiftKey && document.activeElement===nodes.at(-1)) {e.preventDefault();nodes[0]?.focus();} }
    }; document.addEventListener('keydown',key);
    return () => { document.body.style.overflow=overflow; document.removeEventListener('keydown',key);previous?.focus(); };
  },[busy,onClose]);
  return createPortal(<div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-ink-900/60 p-5" role="dialog" aria-modal="true" aria-label="Delete shop">
    <form ref={panel} className="surface w-full max-w-lg space-y-5 p-6" onSubmit={async e=>{e.preventDefault();if(busy||name.trim()!==shop.name)return;setBusy(true);setError('');try{await ApiService.deleteShop(shop.dealerId,name.trim());onDeleted();}catch(err){setError(err instanceof Error?err.message:'Could not delete this shop.');setBusy(false);}}}>
      <header className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-title font-black"><AlertTriangle className="h-6 w-6 text-critical-700"/>Delete shop</h2><button type="button" className="btn-ghost p-2" aria-label="Close delete shop" disabled={busy} onClick={onClose}><X className="h-5 w-5"/></button></header>
      <p className="font-bold" data-i18n-skip>{shop.name}</p>
      <p className="text-body">Shop access and all its locks will stop working. Its customer phones will be released from management when they connect to the internet.</p>
      <p className="text-caption text-ink-500">Payment and agreement records will remain in the audit history. This action cannot be undone here.</p>
      <label className="block"><span className="field-label">Type the exact shop name to confirm</span><input aria-label="Type shop name" className="input" value={name} onChange={e=>setName(e.target.value)} disabled={busy} autoComplete="off" data-i18n-skip /></label>
      {error&&<p role="alert" className="text-body text-critical-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="btn-secondary text-white" style={{ backgroundColor: '#b42318', borderColor: '#7a271a', color: '#fff' }} disabled={busy||name.trim()!==shop.name}><Trash2 className="h-4 w-4"/>{busy?'Deleting…':'Delete shop and release phones'}</button></div>
    </form>
  </div>,document.body);
}
