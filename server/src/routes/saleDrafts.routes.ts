import { Router } from 'express';
import { z } from 'zod';
import { prisma, runInTransaction, runInShopTransaction } from '../db/prisma.js';
import { requireDealerStaff, getAuthUser, resolveDealerScope, resolveWritableDealerId, assertDealerAccess, routeParam } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
const fields = new Set('customerName customerPhone customerCnic customerAddress emergencyName emergencyPhone brand model imei serialNumber purchasePrice color ramStorage android playStore downPayment totalInstallments firstDueDate gracePeriodDays qrType'.split(' '));
const dataSchema=z.object({ form:z.record(z.string(),z.union([z.string().max(500),z.number().finite().min(0).max(1000000000),z.boolean()])).refine(v=>Object.entries(v).every(([k,value])=>fields.has(k) && (['purchasePrice','downPayment','totalInstallments','gracePeriodDays'].includes(k)?typeof value==='number':k==='playStore'?typeof value==='boolean':typeof value==='string')),'Unknown draft field.'), phoneIntakeId:z.string().uuid().optional(),scannedOsVersion:z.string().max(40).optional(),advanceChoice:z.number().min(0).max(100).nullable().optional() }).strict();
const saveSchema=z.object({dealerId:z.string().max(64).optional(),expectedVersion:z.number().int().min(0),data:dataSchema}).strict();
export const saleDraftsRouter=Router();saleDraftsRouter.use(requireDealerStaff);
saleDraftsRouter.get('/',asyncHandler(async(req,res)=>{
 const user=getAuthUser(req),scope=resolveDealerScope(req);
 const where={...(scope?{dealerId:scope}:{}),...(user.role==='DEALER_STAFF'?{userId:user.userId}:{}),completedAt:null};
 const [drafts,devices]=await Promise.all([prisma.saleDraft.findMany({where,orderBy:{updatedAt:'desc'},take:100}),prisma.device.findMany({where:{...(scope?{dealerId:scope}:{}),status:{in:['PENDING','ENROLLED']},noLock:false,dealer:{deletedAt:null}},select:{id:true,dealerId:true,brand:true,model:true,status:true,createdAt:true,customer:{select:{name:true}}},orderBy:{createdAt:'desc'},take:100})]);
 res.json({drafts,devices});
}));
saleDraftsRouter.put('/:id',validateBody(saveSchema),asyncHandler(async(req,res)=>{
 const id=z.string().uuid().parse(routeParam(req,'id')),user=getAuthUser(req),body=req.body as z.infer<typeof saveSchema>;
 const dealerId=await resolveWritableDealerId(req,body.dealerId);
 const draft=await runInShopTransaction(dealerId, async tx=>{
  const shop=await tx.dealer.findUnique({where:{id:dealerId}});if(!shop?.active||shop.deletedAt)throw AppError.forbidden('This shop is no longer active.');
  const existing=await tx.saleDraft.findUnique({where:{id}});
  if(existing&&(existing.dealerId!==dealerId||user.role==='DEALER_STAFF'&&existing.userId!==user.userId))throw AppError.notFound('Pending sale');
  if(existing?.completedAt)throw AppError.conflict('This sale has already been completed.');
  if((existing?.version??0)!==body.expectedVersion)throw AppError.conflict('This pending sale changed on another screen. Reopen it before editing.');
  if(body.data.phoneIntakeId){const intake=await tx.phoneIntake.findUnique({where:{id:body.data.phoneIntakeId}});if(!intake||intake.dealerId!==dealerId)throw AppError.notFound('Phone scan');}
  if(existing)return tx.saleDraft.update({where:{id},data:{data:body.data as any,version:{increment:1}}});
  return tx.saleDraft.create({data:{id,dealerId,userId:user.userId,data:body.data as any}});
 });res.json(draft);
}));
saleDraftsRouter.delete('/:id',asyncHandler(async(req,res)=>{
 const user=getAuthUser(req),id=routeParam(req,'id');
 await runInTransaction(async tx=>{const d=await tx.saleDraft.findUnique({where:{id}});if(!d)throw AppError.notFound('Pending sale');assertDealerAccess(req,d.dealerId);if(user.role==='DEALER_STAFF'&&d.userId!==user.userId)throw AppError.notFound('Pending sale');if(d.completedAt)throw AppError.conflict('A completed sale cannot be discarded.');await tx.saleDraft.delete({where:{id}})});
 res.json({success:true});
}));
