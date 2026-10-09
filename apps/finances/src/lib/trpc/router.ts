import {router,viewerProcedure as p} from './init';
import {financeRouter} from './finance-router';
import {z} from 'zod/v4';
import {publicBrokerConfig,saveBrokerConfig} from '@/lib/connectors/config';
import {connectorCapabilities,ConnectorUnavailable} from '@/lib/connectors/client';
import {createClientKey,listClientKeys,revokeClientKey} from '@/lib/auth';
import {financeId} from '@/lib/finance/contracts';
import {configureFinanceAi,getFinanceAiSettings,listFinanceHandoffs} from '@/lib/db/app-queries';
import {financeOwner} from '@/lib/db/finance-queries';
import {financeChatMessages} from '@/lib/db/app-queries';
import {askFinanceChat} from '@/lib/server/operations/finance-chat';
export const appRouter=router({finance:financeRouter,app:router({
 broker:p.query(async()=>{try{return {...publicBrokerConfig(),available:true,capabilities:await connectorCapabilities(),message:null};}catch(e){return {...publicBrokerConfig(),available:false,capabilities:null,message:e instanceof ConnectorUnavailable?e.message:'The broker response did not match the proposed contract'};}}),
 configureBroker:p.input(z.object({url:z.url(),token:z.string().min(16).max(4000)}).nullable()).mutation(({input})=>{saveBrokerConfig(input);return publicBrokerConfig();}),
 clients:p.query(()=>listClientKeys()),
 createClient:p.input(z.object({label:z.string().trim().min(1).max(160),accountIds:z.array(financeId).min(1).max(100),operations:z.array(z.enum(['read','write','sync','evidence'])).min(1).max(4)}).strict()).mutation(({input})=>createClientKey(input)),
 revokeClient:p.input(z.object({id:financeId}).strict()).mutation(({input})=>{revokeClientKey(input.id);return {revoked:true};}),
 aiSettings:p.query(()=>({...getFinanceAiSettings(),eligible:process.platform==='darwin'&&getFinanceAiSettings().harness==='claude',platform:process.platform})),
 configureAi:p.input(z.object({harness:z.enum(['claude','codex','cursor','opencode','antigravity'])}).strict()).mutation(({input})=>configureFinanceAi(input.harness)),
 handoffs:p.query(()=>listFinanceHandoffs(financeOwner)),
 messages:p.input(z.object({sessionId:financeId}).strict()).query(({input})=>financeChatMessages(financeOwner,input.sessionId)),
 ask:p.input(z.object({sessionId:financeId,message:z.string().trim().min(1).max(2000),requestId:z.string().uuid()}).strict()).mutation(({input})=>askFinanceChat(financeOwner,input)),
})});
export type AppRouter=typeof appRouter;
