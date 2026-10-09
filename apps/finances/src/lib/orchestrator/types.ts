import {z} from 'zod/v4';
import type {FinancePrincipal} from '@/lib/db/finance-queries';
export type ActionContext={principal:FinancePrincipal};
export class ActionError extends Error{constructor(readonly code:'not_found'|'conflict'|'unsupported'|'invalid_params',message:string){super(message);}}
export function defineAction<P extends z.ZodRawShape>(action:{name:string;description:string;mutating?:boolean;params:P;handler:(ctx:ActionContext,input:z.infer<z.ZodObject<P>>)=>unknown}){return action;}
