import {randomUUID} from 'node:crypto';
import {describe,it,expect,beforeEach,afterAll} from 'vitest';
import {as,reseed,repo,ACCOUNTS} from '../helpers.js';
import {prisma,disconnectDatabase} from '../../src/db/prisma.js';
beforeEach(async()=>{await reseed()},60000);afterAll(async()=>{await disconnectDatabase()});
const data={form:{customerName:'Pending Buyer',customerPhone:'03001112233',model:'Galaxy A15',purchasePrice:54000,downPayment:16000,totalInstallments:6}};
describe('saved pending work',()=>{
 it('restores partial fields, rejects stale writes and keeps tenants separate',async()=>{
 const id=randomUUID(); const saved=await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:0,data});expect(saved.status).toBe(200);expect(saved.body.version).toBe(1);
 const list=await as(ACCOUNTS.dealerAdmin).get('/api/sale-drafts');expect(list.body.drafts.find((d:any)=>d.id===id).data).toEqual(data);
 expect((await as(ACCOUNTS.otherDealerAdmin).get('/api/sale-drafts')).body.drafts).toHaveLength(0);
 expect((await as(ACCOUNTS.otherDealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:1,data})).status).toBe(404);
 expect((await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:0,data})).status).toBe(409);
 const second=await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:1,data:{form:{...data.form,customerName:'Updated Buyer'}}});expect(second.body.version).toBe(2);
 expect((await as(ACCOUNTS.dealerAdmin).delete('/api/sale-drafts/'+id)).status).toBe(200);
 });
 it('does not let staff read or discard the owners draft',async()=>{
 const id=randomUUID();await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:0,data}).expect(200);
 expect((await as(ACCOUNTS.dealerStaff).get('/api/sale-drafts')).status).toBe(403);
 expect((await as(ACCOUNTS.dealerStaff).delete('/api/sale-drafts/'+id)).status).toBe(403);
 expect(await prisma.saleDraft.count({where:{id}})).toBe(1);
 });
 it('rejects signatures and incorrect field types in drafts',async()=>{
 for(const form of [{signature:'private'},{customerName:123},{purchasePrice:'54000'}])expect((await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+randomUUID()).send({expectedVersion:0,data:{form}})).status).toBe(422);
 });
 it('does not reopen or discard a completed sale',async()=>{
 const id=randomUUID();await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:0,data}).expect(200);await prisma.saleDraft.update({where:{id},data:{completedAt:new Date()}});
 expect((await as(ACCOUNTS.dealerAdmin).get('/api/sale-drafts')).body.drafts).toHaveLength(0);
 expect((await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:1,data})).status).toBe(409);
 expect((await as(ACCOUNTS.dealerAdmin).delete('/api/sale-drafts/'+id)).status).toBe(409);
 });
});
async function installment(){const plan=(await repo.installmentPlans.findFirst({customerId:'cust-1'}))!;const rows=await repo.installments.findByPlan(plan.id);const row=rows.find(i=>i.status!=='PAID')!;const date=new Date();date.setUTCDate(date.getUTCDate()+60);const graceDate=date.toISOString().slice(0,10);await repo.installments.update(row.id,{graceDate:'2026-01-01',status:'OVERDUE'});return {plan,row,graceDate};}
describe('per installment grace',()=>{
 it('extends grace without changing due date, balance or amount and wakes the policy stream',async()=>{
 const {plan,row,graceDate}=await installment();const before=(await repo.devices.findById(plan.deviceId))!;
 const result=await as(ACCOUNTS.dealerAdmin).post('/api/installments/'+row.id+'/extend-grace').send({graceDate,reason:'Customer needs time until the agreed date'});expect(result.status).toBe(200);
 const after=(await repo.installments.findById(row.id))!;expect(after.graceDate).toBe(graceDate);expect(after.dueDate).toBe(row.dueDate);expect(after.amountDue).toBe(row.amountDue);expect(after.amountPaid).toBe(row.amountPaid);expect((await repo.installmentPlans.findById(plan.id))?.remainingBalance).toBe(plan.remainingBalance);
 expect((await repo.devices.findById(plan.deviceId))?.commandVersion).toBe((before.commandVersion??0)+1);
 expect(await prisma.auditLog.count({where:{action:'INSTALLMENT_GRACE_EXTENDED',targetId:row.id}})).toBe(1);
 });
 it('refuses staff, other shops, paid installments and backwards dates',async()=>{
 const {row,graceDate}=await installment();const url='/api/installments/'+row.id+'/extend-grace';const body={graceDate,reason:'Customer requests extra days'};
 expect((await as(ACCOUNTS.dealerStaff).post(url).send(body)).status).toBe(403);
 expect((await as(ACCOUNTS.otherDealerAdmin).post(url).send(body)).status).toBe(404);
 expect((await as(ACCOUNTS.dealerAdmin).post(url).send({...body,graceDate:'2025-01-01'})).status).toBe(400);
 await repo.installments.update(row.id,{status:'PAID',amountPaid:row.amountDue});expect((await as(ACCOUNTS.dealerAdmin).post(url).send(body)).status).toBe(400);
 });
 it('preserves a manual security lock',async()=>{
 const {plan,row,graceDate}=await installment();await repo.devices.update(plan.deviceId,{status:'LOCKED',lockReason:'Lost phone reported by customer'});
 await as(ACCOUNTS.dealerAdmin).post('/api/installments/'+row.id+'/extend-grace').send({graceDate,reason:'Customer requests extra days'}).expect(200);
 expect((await repo.devices.findById(plan.deviceId))?.status).toBe('LOCKED');
 });
});

it('completes a saved draft atomically and refuses the same sale twice',async()=>{
 const id=randomUUID();await as(ACCOUNTS.dealerAdmin).put('/api/sale-drafts/'+id).send({expectedVersion:0,data}).expect(200);
 const body={draftId:id,noLock:true,customer:{name:'Pending Buyer',phone:'0300-1112233',cnic:'35201-1234567-1',address:'Shop 4 Test Road Lahore',emergencyContactName:'Test Contact',emergencyContactPhone:'0301-4445566'},device:{brand:'Samsung',model:'A15',imei:'490154203237518',purchasePrice:54000},plan:{downPayment:16000,totalInstallments:6,firstDueDate:'2027-01-01'}};
 const sale=await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(body);expect(sale.status).toBe(201);const saved=await prisma.saleDraft.findUnique({where:{id}});expect(saved?.completedAt).toBeTruthy();expect(saved?.deviceId).toBe(sale.body.device.id);const devices=await repo.devices.count();expect((await as(ACCOUNTS.dealerAdmin).post('/api/customers').send(body)).status).toBe(409);expect(await repo.devices.count()).toBe(devices);
});
it('queues removal of an automated lock after grace while awaiting the real handset acknowledgement',async()=>{
 const {plan,row,graceDate}=await installment();for(const other of await repo.installments.findByPlan(plan.id)){if(other.id!==row.id)await repo.installments.update(other.id,{status:'PAID',amountPaid:other.amountDue});}
 await repo.devices.update(plan.deviceId,{status:'LOCKED',lockReason:'Automated enforcement: installment #1 is past grace.'});
 const res=await as(ACCOUNTS.dealerAdmin).post('/api/installments/'+row.id+'/extend-grace').send({graceDate,reason:'Customer requests extra days'});expect(res.status).toBe(200);expect(res.body.unlockQueued).toBe(true);const phone=await repo.devices.findById(plan.deviceId);expect(phone?.status).toBe('UNLOCK_PENDING');expect(phone?.pendingCommand).toBe('UNLOCK');
});
it('leaves an automated lock in place when another installment still needs full lock',async()=>{
 const {plan,row,graceDate}=await installment();const others=(await repo.installments.findByPlan(plan.id)).filter(i=>i.id!==row.id);const last=others.sort((a,b)=>b.installmentNumber-a.installmentNumber)[0];await repo.installments.update(last.id,{status:'OVERDUE'});await repo.devices.update(plan.deviceId,{status:'LOCKED',lockReason:'Automated enforcement: the final installment is overdue.'});
 const res=await as(ACCOUNTS.dealerAdmin).post('/api/installments/'+row.id+'/extend-grace').send({graceDate,reason:'Customer requests extra days'});expect(res.status).toBe(200);expect(res.body.unlockQueued).toBe(false);expect((await repo.devices.findById(plan.deviceId))?.status).toBe('LOCKED');
});
