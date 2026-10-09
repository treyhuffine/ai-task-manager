import { localAppsEnabled } from '@/lib/local-apps/service';
import { brokerCall,brokerCapabilities } from '@/lib/local-apps/broker';
import { publicError } from '@ri/app-kit/contract';
import { readLimitedJson } from '@/lib/api/limited-body';
async function handle(request:Request,context:{params:Promise<{operation:string}>}) {
  if(!localAppsEnabled())return new Response(null,{status:404});
  const credential=request.headers.get('authorization')?.replace(/^Bearer /,'')??'',ticket=request.headers.get('x-app-invocation-ticket');
  try {const {operation}=await context.params; if(operation==='capabilities'&&request.method==='GET')return Response.json(await brokerCapabilities(credential,ticket)); if(operation==='call'&&request.method==='POST')return Response.json(await brokerCall(credential,ticket,await readLimitedJson(request))); return new Response(null,{status:404});}
  catch(error){const failure=publicError(error);return Response.json({version:1,ok:false,code:failure.code,message:failure.message},{status:failure.code==='revoked'||failure.code==='forbidden'?403:400});}
}
export const POST=handle;
export const GET=handle;
