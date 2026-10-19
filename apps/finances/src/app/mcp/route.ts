import {AppError} from '@ri/app-kit/contract';
import {boundedRequestBody} from '@/lib/http';
import {isOperationError} from '@/lib/server/operation';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {createFinanceMcpServer} from '@/lib/mcp/server';
import {requestPrincipal} from '@/lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  const p=requestPrincipal(request);if(!p)return new Response(null,{status:401,headers:{'WWW-Authenticate':'Bearer realm="personal-finance"'}});
  if(Number(request.headers.get('content-length'))>1024*1024)return new Response(null,{status:413});
  const bytes=await boundedRequestBody(request,1024*1024);
  const bounded=new Request(request.url,{method:request.method,headers:request.headers,body:new Uint8Array(bytes)});
  // One stateless handler per request, bound to its principal: MCP 2026-07-28 and 2025-era clients.
  const handler=createMcpHandler(()=>createFinanceMcpServer(()=>{const current=requestPrincipal(request);if(!current)throw new AppError('revoked','The Finance permission changed. Review access and refresh');return current;}),{legacy:'stateless',maxRequestBodySize:1024*1024});
  // No close(): a streamed modern response may still be in flight when fetch resolves. Each exchange closes its own instance.
  return await handler.fetch(bounded);
 }catch(e){return new Response(null,{status:isOperationError(e)?e.status:403});}
}
export function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
export function DELETE(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
