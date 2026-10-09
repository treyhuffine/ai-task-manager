import {requireOwner} from '@/lib/auth';
import {boundedRequestBody} from '@/lib/http';
import {isOperationError} from '@/lib/server/operation';
import {fetchRequestHandler} from '@trpc/server/adapters/fetch';
import {appRouter} from '@/lib/trpc/router';
export const runtime='nodejs';
const handler=async(request:Request)=>{try{requireOwner(request);const bounded=request.method==='POST'?new Request(request.url,{method:request.method,headers:request.headers,body:new Uint8Array(await boundedRequestBody(request,20*1024*1024))}):request;return fetchRequestHandler({endpoint:'/api/trpc',req:bounded,router:appRouter,createContext:()=>({request:bounded})});}catch(e){return new Response(null,{status:isOperationError(e)?e.status:400});}};
export {handler as GET,handler as POST};
