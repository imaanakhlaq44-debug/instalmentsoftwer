import { runInTransaction } from '../db/prisma.js';
import { repo } from '../db/repositories/index.js';
import { AppError } from '../utils/AppError.js';
import { AuditService } from './AuditService.js';
import { toBusinessDate, amountOutstanding } from './InstallmentMath.js';
import { stagedFullLockDue } from './StagedRestrictions.js';
import { deviceCommandSignal } from './DeviceCommandSignal.js';
import { UserRole } from '../types/index.js';
export class InstallmentGraceService {
 static async extend(id:string, until:string, reason:string, actor:{userId:string;name:string;role:UserRole;dealerId?:string}, ipAddress?:string){
  const result=await runInTransaction(async tx=>{
   const inst=await repo.installments.findById(id,tx);if(!inst||actor.role!=='SUPER_ADMIN'&&inst.dealerId!==actor.dealerId)throw AppError.notFound('Installment');
   const plan=await repo.installmentPlans.findById(inst.planId,tx);if(!plan||['COMPLETED','CANCELLED'].includes(plan.status))throw AppError.badRequest('This plan is closed.');
   if(inst.status==='PAID'||amountOutstanding(inst)<=0)throw AppError.badRequest('A paid installment cannot be extended.');
   const today=toBusinessDate(new Date()),base=inst.graceDate>today?inst.graceDate:today;
   const max=new Date(base+'T00:00:00Z');max.setUTCDate(max.getUTCDate()+365);
   if(until<=inst.graceDate||until<today||until>max.toISOString().slice(0,10))throw AppError.badRequest('Choose a later grace date, within one year of the current grace date or today.');
   await repo.installments.update(id,{graceDate:until,status:inst.dueDate<=today?'DUE_TODAY':'PENDING'},tx);
   const rows=await repo.installments.findByPlan(plan.id,tx),overdue=rows.filter(i=>i.status==='OVERDUE');
   await repo.installmentPlans.update(plan.id,{status:overdue.length?'OVERDUE':rows.some(i=>i.status==='DUE_TODAY')?'DUE_TODAY':'CURRENT'},tx);
   const device=await repo.devices.findById(plan.deviceId,tx);let unlockQueued=false;
   if(device){
    const policy=await repo.devicePolicies.findByDealer(device.dealerId,tx);
    const needsFullLock=policy?.stagedRestrictionsEnabled?stagedFullLockDue(rows):overdue.length>0;
    const automated=!!device.lockReason&&(/^(Automated enforcement:|Installment #.*overdue)/i.test(device.lockReason));
    const autoUnlock=automated&&!needsFullLock&&['LOCKED','LOCK_PENDING'].includes(device.status);
    await tx.device.update({where:{id:device.id},data:{commandVersion:{increment:1},...(device.status==='OVERDUE'&&!overdue.length?{status:'ACTIVE',lockReason:null}:{}),...(autoUnlock?{status:'UNLOCK_PENDING',pendingCommand:'UNLOCK',pendingCommandAt:new Date(),lockReason:'Grace extended by the shop.'}:{})}});
    unlockQueued=autoUnlock;
    if(!overdue.length)await tx.notification.updateMany({where:{deviceId:device.id,status:'QUEUED',type:'PAYMENT_OVERDUE'},data:{status:'FAILED',failureReason:'Grace period extended by the shop.',leaseUntil:null}});
   }
   await AuditService.log({dealerId:inst.dealerId,userId:actor.userId,actorName:actor.name,actorRole:actor.role,action:'INSTALLMENT_GRACE_EXTENDED',targetType:'INSTALLMENT',targetId:id,details:'Grace extended from '+inst.graceDate+' to '+until+'. '+reason,ipAddress},tx);
   return {deviceId:device?.id,graceDate:until,unlockQueued};
  });if(result.deviceId)deviceCommandSignal.notify(result.deviceId);return result;
 }
}
