import {initTRPC,TRPCError} from '@trpc/server';
import {requireOwner} from '@/lib/auth';
import {isOperationError} from '@/lib/server/operation';
const t=initTRPC.context<{request:Request}>().create();
export const router=t.router;
export const viewerProcedure=t.procedure.use(async({ctx,next})=>{
 try{requireOwner(ctx.request);const result=await next();if(!result.ok&&isOperationError(result.error.cause))throw result.error.cause;return result;}catch(e){if(isOperationError(e))throw new TRPCError({code:e.status===401?'UNAUTHORIZED':e.status===403?'FORBIDDEN':e.status===409?'CONFLICT':e.status===404?'NOT_FOUND':'BAD_REQUEST',message:e.message,cause:e});throw e;}
});
