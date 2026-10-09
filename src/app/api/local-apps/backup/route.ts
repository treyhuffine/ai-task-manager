import { getRequestKey } from '@/lib/auth/request-key';
import { localApps,localAppsEnabled } from '@/lib/local-apps/service';
import { readLimitedJson } from '@/lib/api/limited-body';
export async function POST(request:Request){
 if(!localAppsEnabled())return Response.json({localAppsEnabled:false},{status:404});
 if(getRequestKey(request.headers)?.scope!=='viewer')return new Response(null,{status:403});
 try{return Response.json(await localApps().beginSnapshot());}catch(error){return Response.json({error:error instanceof Error?error.message:'Backup could not pause apps'},{status:409});}
}
export async function DELETE(request:Request){
 if(!localAppsEnabled())return new Response(null,{status:404});
 if(getRequestKey(request.headers)?.scope!=='viewer')return new Response(null,{status:403});
 try{const body=await readLimitedJson(request) as {lease:string};await localApps().endSnapshot(body.lease);return Response.json({resumed:true});}catch{return new Response(null,{status:409});}
}
