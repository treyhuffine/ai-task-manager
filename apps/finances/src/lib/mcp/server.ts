import {z} from 'zod/v4';
import {AppError,publicError} from '@ri/app-kit/contract';
import {OperationError} from '@/lib/server/operation';
import {ActionError} from '@/lib/orchestrator/types';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAppResource,registerAppTool,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import {toolsDefinition} from '@/lib/local-app/definition';
import {HOME_RESOURCE,VIEW_RESOURCE} from '@/lib/local-app/actions';
import {financeHomeHtml} from '@/lib/local-app/home-renderer';
import {financeRendererHtml} from '@/lib/finance/renderer';
import type {FinancePrincipal} from '@/lib/db/finance-queries';
export const FINANCE_RESOURCE='ui://personal-finance/renderer-v1.html';
export function createFinanceMcpServer(principal:()=>FinancePrincipal){
 const server=new McpServer({name:'personal-finance',version:'0.1.0'},{capabilities:{tools:{},resources:{}}});
 for(const action of toolsDefinition()){
  registerAppTool(server,action.name,{description:action.description,inputSchema:action.input as z.ZodObject<z.ZodRawShape>,outputSchema:action.output as z.ZodObject<z.ZodRawShape>,annotations:{readOnlyHint:action.effect==='read',destructiveHint:false,idempotentHint:action.effect==='read',openWorldHint:false},_meta:{ui:{...(action.visibility==='app'?{visibility:['app']}:{}),...(action.name==='finance_open_view'?{resourceUri:VIEW_RESOURCE}:action.name==='finance_open_app'?{resourceUri:HOME_RESOURCE}:{})}}},async raw=>{
   try{
    // Each callback revalidates the caller. A transport cannot retain a revoked grant.
    const result=await action.run(principal(),raw);
    principal();
    return {content:[{type:'text' as const,text:action.name==='finance_open_view'?'Opened the authorized saved finance view.':JSON.stringify(result)}],structuredContent:result as Record<string,unknown>};
    }catch(e){
    const mapped=e instanceof ActionError ? new AppError(e.code==='invalid_params'?'invalid_input':e.code,e.message) : e instanceof OperationError ? new AppError(({400:'invalid_input',403:'forbidden',404:'not_found',409:'conflict'} as const)[e.status as 400|403|404|409]??'app_failed',e.message) : e instanceof z.ZodError ? new AppError('invalid_input','The Finance input is invalid') : e;
    const failure=publicError(mapped);
    return {isError:true,_meta:{'com.ri/errorCode':failure.code},content:[{type:'text' as const,text:failure.message}]};
   }
  });
 }
 registerAppResource(server,'personal-finance-renderer',FINANCE_RESOURCE,{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:FINANCE_RESOURCE,mimeType:RESOURCE_MIME_TYPE,text:financeRendererHtml(),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[]}}}}]}));
 registerAppResource(server,'finance-home',HOME_RESOURCE,{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:HOME_RESOURCE,mimeType:RESOURCE_MIME_TYPE,text:financeHomeHtml(),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[]}}}}]}));
 return server;
}
