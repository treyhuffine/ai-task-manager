import {AppError} from '@ri/app-kit/contract';
import {boundedRequestBody} from '@/lib/http';
import {isOperationError} from '@/lib/server/operation';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
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
  const server=createFinanceMcpServer(()=>{const current=requestPrincipal(request);if(!current)throw new AppError('revoked','The Finance permission changed. Review access and refresh');return current;}),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try{return await transport.handleRequest(bounded);}finally{await server.close();}
 }catch(e){return new Response(null,{status:isOperationError(e)?e.status:403});}
}
export function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
export function DELETE(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
