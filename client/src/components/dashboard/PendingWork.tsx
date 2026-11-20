import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, ArrowRight, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ApiService } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { AddCustomerWizardModal } from '../modals/AddCustomerWizardModal.js';
import type { SaleDraft } from '../../utils/saleDraft.js';
export function PendingWork({ disabled=false }: { disabled?:boolean }) {
 const { selectedDealerId,isStaff,showToast }=useAuth(),navigate=useNavigate();
 const [open,setOpen]=useState(false),[draft,setDraft]=useState<SaleDraft|null>(null),[data,setData]=useState<{drafts:SaleDraft[];devices:any[]}>({drafts:[],devices:[]}),[error,setError]=useState(''),[discarding,setDiscarding]=useState<string|null>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 const load=async()=>{if(!isStaff)return;try{setData(await ApiService.getPendingWork(selectedDealerId));setError('');}catch{setError('Could not load pending work. Please retry.')}};
 useEffect(()=>{if(!isStaff)return;let live=true;void ApiService.getPendingWork(selectedDealerId).then(d=>{if(live)setData(d);}).catch(()=>{if(live)setError('Could not load pending work. Please retry.');});const refresh=()=>{void load();};window.addEventListener('almas:pending-work-changed',refresh);return()=>{live=false;window.removeEventListener('almas:pending-work-changed',refresh);};},[selectedDealerId,isStaff]);
 useEffect(()=>{if(!open)return;const prev=document.activeElement as HTMLElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';closeButton.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);prev?.focus();};},[open]);
 if(!isStaff)return null;
 const count=data.drafts.length+data.devices.length;
 return <>
  <button type="button" className="btn-secondary w-full justify-between" disabled={disabled} onClick={()=>{setOpen(true);void load();}}><span className="inline-flex items-center gap-2"><ClipboardList className="h-4 w-4"/>Pending work{count>0&&<span className="rounded-full bg-sun-200 px-2 text-caption">{count}</span>}</span><ArrowRight className="h-4 w-4"/></button>
  {open&&createPortal(<div className="fixed inset-0 z-[80] grid place-items-center bg-ink-900/60 p-4"><section role="dialog" aria-modal="true" aria-label="Pending work" className="surface max-h-[90dvh] w-full max-w-2xl space-y-5 overflow-y-auto p-5">
    <header className="flex items-center justify-between"><h2 className="text-title font-black">Pending work</h2><button ref={closeButton} type="button" className="btn-secondary p-2" aria-label="Close pending work" onClick={()=>setOpen(false)}><X className="h-5 w-5"/></button></header>
    {error&&<div role="alert"><p>{error}</p><button type="button" className="btn-secondary mt-2" onClick={()=>void load()}>Try again</button></div>}
    <h3 className="font-bold">Saved sale forms</h3>
    {!data.drafts.length&&<p className="text-caption text-ink-500">No saved sale forms.</p>}
    {data.drafts.map(d=><article key={d.id} className="rounded-xl border-2 border-ink-900 bg-paper-50 p-4"><p className="font-bold" data-i18n-skip>{d.data.form.customerName||d.data.form.customerCnic||'Untitled sale'}</p><p className="text-caption" data-i18n-skip>{[d.data.form.brand,d.data.form.model].filter(Boolean).join(' ')}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-primary text-caption" onClick={()=>{setOpen(false);setDraft(d);}}>Continue sale</button><button type="button" className="btn-ghost text-caption" disabled={!!discarding} onClick={async()=>{setDiscarding(d.id);try{await ApiService.discardSaleDraft(d.id);await load();}catch(e){showToast(e instanceof Error?e.message:'Could not discard pending work.','error');}finally{setDiscarding(null);}}}>Discard saved form</button></div></article>)}
    <h3 className="font-bold">Phones awaiting setup</h3>
    {!data.devices.length&&<p className="text-caption text-ink-500">No phones awaiting setup.</p>}
    {data.devices.map(d=><article key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink-900 bg-sun-100 p-4"><div><p className="font-bold" data-i18n-skip>{d.brand} {d.model}</p><p className="text-caption" data-i18n-skip>{d.customer?.name}</p><p className="text-caption">Setup pending</p></div><button type="button" className="btn-secondary text-caption" onClick={()=>{setOpen(false);navigate('/enrollment?device='+encodeURIComponent(d.id));}}>Continue setup</button></article>)}
  </section></div>,document.body)}
  {draft&&<AddCustomerWizardModal key={draft.id} initialDraft={draft} onClose={()=>{setDraft(null);void load();}} onSuccess={()=>void load()}/>}
 </>;
}
