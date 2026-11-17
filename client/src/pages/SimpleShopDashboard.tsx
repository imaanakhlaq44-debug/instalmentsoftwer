import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { firstName, money } from '../utils/format.js';
import { Card, CardHeader, Skeleton } from '../components/ui/Card.js';
import { CollectionQueue, type OverdueRow } from '../components/dashboard/CollectionQueue.js';
import { PendingWork } from '../components/dashboard/PendingWork.js';
import { AddCustomerWizardModal } from '../components/modals/AddCustomerWizardModal.js';

export function SimpleShopDashboard() {
 const {user,dealer,selectedDealerId,role,shopEditMode}=useAuth();const navigate=useNavigate();
 const [stats,setStats]=useState<any>(null);const [rows,setRows]=useState<OverdueRow[]|null>(null);const [failed,setFailed]=useState(false);const [queueFailed,setQueueFailed]=useState(false);const [reload,setReload]=useState(0);const [sale,setSale]=useState(false);
 const viewOnly=role==='SUPER_ADMIN'&&!shopEditMode;
 useEffect(()=>{let live=true;setStats(null);setRows(null);setFailed(false);setQueueFailed(false);
 void ApiService.getDashboardStats(selectedDealerId).then(s=>{if(live)setStats(s)}).catch(()=>{if(live)setFailed(true)});
 void ApiService.getAttentionList(selectedDealerId).then(r=>{if(live)setRows(r.overdueInstallments??[])}).catch(()=>{if(live)setQueueFailed(true)});
 return()=>{live=false};},[selectedDealerId,reload]);
 const actions=[{label:'New sale',hint:'Customer, phone aur qiston ka plan',art:'agreement',action:()=>setSale(true),primary:true},{label:'Record payment',hint:'Customer ki qist jama karein',art:'wallet',action:()=>navigate('/payments')},{label:'Customer list',hint:'Customer dhoondein aur record kholein',art:'customer',action:()=>navigate('/customers')},{label:'My phones',hint:'Phone ka haal aur lock dekhein',art:'phone',action:()=>navigate('/devices')}];
 return <div className="space-y-6" aria-label="Shop dashboard">
 <header className="flex items-center justify-between gap-4"><div><h1 className="text-display">Salam, <span data-i18n-skip>{firstName(user?.name||dealer?.ownerName)}</span></h1><p className="mt-1 text-body text-ink-500">Aapki dukan, roz ke kaam ek jagah.</p></div><button type="button" className="btn-ghost p-2" aria-label="Refresh dashboard" onClick={()=>setReload(n=>n+1)}><RefreshCw className="h-5 w-5"/></button></header>
 <section aria-label="Daily shop actions" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{actions.map(a=><button key={a.label} type="button" disabled={!!a.primary&&viewOnly} onClick={a.action} className={'min-w-0 rounded-2xl border-2 border-ink-900 p-4 text-start shadow-[3px_3px_0_#0F1419] transition hover:-translate-y-0.5 disabled:opacity-50 '+(a.primary?'bg-[#1b3260] text-white':'bg-white text-ink-900')}><img src={'/icons/3d/'+a.art+'.png'} alt="" className="mb-3 h-14 w-14 object-contain"/><strong className="block break-words text-sm">{a.label}</strong><span className={'mt-1 block text-caption '+(a.primary?'text-white/80':'text-ink-500')}>{a.hint}</span></button>)}</section>
 <PendingWork disabled={viewOnly}/>
 {failed?<div role="alert" className="surface p-4"><p>Could not load the dashboard.</p><button className="btn-secondary mt-3" onClick={()=>setReload(n=>n+1)}>Try again</button></div>:<section aria-label="Shop collection summary" className="grid gap-3 sm:grid-cols-3">{[{label:"Today's collection",value:stats?.collectedToday,tone:'bg-sun-300'},{label:'Collected this month',value:stats?.collectedThisMonth,tone:'bg-positive-50'},{label:'Total outstanding',value:stats?.outstandingAmount,tone:'bg-white'}].map(s=><div key={s.label} className={'min-w-0 rounded-2xl border-2 border-ink-900 p-5 '+s.tone}><h2 className="text-caption font-bold text-ink-600">{s.label}</h2>{stats?<p className="mt-2 break-words text-2xl font-black" data-i18n-skip>{money(s.value??0)}</p>:<Skeleton className="mt-2 h-8 w-28"/>}</div>)}</section>}
 {stats&&<div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={()=>navigate('/installments?status=DUE_TODAY')} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink-900 bg-sun-100 p-4 text-start"><span><strong className="block">Aaj ki qistein</strong><span className="text-caption">{Math.max(0,(stats.dueTodayCount??0)-(stats.paidDueTodayCount??0))} baqi · {stats.paidDueTodayCount??0} ada</span></span><ArrowRight className="h-4 w-4 shrink-0"/></button><button type="button" onClick={()=>navigate('/installments?status=OVERDUE')} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink-900 bg-critical-50 p-4 text-start"><span><strong className="block">Late qistein</strong><span className="text-caption">{stats.overdueInstallmentsCount??0} qistein · {money(stats.overdueAmount??0)}</span></span><ArrowRight className="h-4 w-4 shrink-0"/></button></div>}
 {stats?.pendingVerificationAmount>0&&<button type="button" className="btn-secondary w-full justify-between" onClick={()=>navigate('/payments?status=PENDING')}>Payments awaiting confirmation <span data-i18n-skip>{money(stats.pendingVerificationAmount)}</span><ArrowRight className="h-4 w-4"/></button>}
 {!!stats?.tamperAlertDevices&&<button type="button" className="btn-secondary w-full justify-between" onClick={()=>navigate('/devices?tamper=true')}><ShieldAlert className="h-4 w-4"/>{stats.tamperAlertDevices} phones need inspection<ArrowRight className="h-4 w-4"/></button>}
 {(stats?.silentDevices>0||stats?.frpRefusedDevices>0)&&<button type="button" className="btn-secondary w-full justify-between" onClick={()=>navigate('/devices')}>Phone connection ya protection check karein<ArrowRight className="h-4 w-4"/></button>}
 {stats?.frpConfigured===false&&<button type="button" className="btn-secondary w-full justify-between" onClick={()=>navigate('/settings')}>Phone protection setup mukammal karein<ArrowRight className="h-4 w-4"/></button>}
 <Card><CardHeader title="Qist ki yaad-dihani" hint="Jin customers ki qist late hai" action={<button type="button" className="btn-ghost text-caption" onClick={()=>navigate('/installments?status=OVERDUE')}>See all <ArrowRight className="h-4 w-4"/></button>}/><div className="mt-4">{queueFailed?<p role="alert">Customer list load nahi hui. Refresh karein.</p>:rows?<CollectionQueue rows={rows}/>:<Skeleton className="h-24 w-full"/>}</div></Card>
 {sale&&<AddCustomerWizardModal onClose={()=>setSale(false)} onSuccess={()=>setReload(n=>n+1)}/>}
 </div>;
}
