import type { SaleForm } from './saleValidation.js';
import type { AndroidVersion } from './phoneSupport.js';
export type DraftForm = SaleForm & { color:string; android:AndroidVersion; playStore:boolean; qrType:string };
export interface SaleDraft { id:string;dealerId:string;version:number;updatedAt:string;data:{form:Partial<DraftForm>;phoneIntakeId?:string;scannedOsVersion?:string;advanceChoice?:number|null} }
