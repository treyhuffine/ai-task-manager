import {eq,desc,and} from 'drizzle-orm';
import {uuidv7} from 'uuidv7';
import {getDb} from './index';
import * as s from './schema';
import {getFinanceView,requireFinance,type FinancePrincipal} from './finance-queries';
export function getFinanceAiSettings(){const row=getDb().select().from(s.financeAppSettings).where(eq(s.financeAppSettings.id,'local')).get();return {harness:row?.harness??'claude'} as const;}
export function configureFinanceAi(harness:'claude'|'codex'|'cursor'|'opencode'|'antigravity'){return getDb().insert(s.financeAppSettings).values({id:'local',harness}).onConflictDoUpdate({target:s.financeAppSettings.id,set:{harness}}).returning().get();}
export function createLocalFollowup(input:{title:string;body:string;hardDeadline?:string;findingId:string;reference:string}){
 return getDb().insert(s.financeHandoffs).values({id:uuidv7(),findingId:input.findingId,title:input.title,reference:input.reference,dueOn:input.hardDeadline??null,state:'pending',taskId:null}).onConflictDoNothing().returning().get()??getDb().select().from(s.financeHandoffs).where(eq(s.financeHandoffs.findingId,input.findingId)).get()!;
}
export function listFinanceHandoffs(p:FinancePrincipal){if(!p.owner)throw new Error('Owner required');return getDb().select().from(s.financeHandoffs).limit(500).all();}
export function createFinanceChat(p:FinancePrincipal,viewId:string,includeEvidence:boolean){const view=getFinanceView(p,viewId);requireFinance(p,view.scope.accountIds);const existing=getDb().select().from(s.financeChats).where(eq(s.financeChats.viewId,viewId)).get();if(existing){return getDb().update(s.financeChats).set({includeEvidence}).where(eq(s.financeChats.id,existing.id)).returning().get()!;}return getDb().insert(s.financeChats).values({id:uuidv7(),viewId,includeEvidence}).returning().get();}
export function financeChatMessages(p:FinancePrincipal,chatId:string){const chat=getDb().select().from(s.financeChats).where(eq(s.financeChats.id,chatId)).get();if(!chat)throw new Error('Conversation not found');getFinanceView(p,chat.viewId);return {chat,messages:getDb().select().from(s.financeChatMessages).where(eq(s.financeChatMessages.chatId,chatId)).orderBy(desc(s.financeChatMessages.createdAt),desc(s.financeChatMessages.id)).limit(100).all().reverse()};}
export function saveFinanceChatMessage(input:{chatId:string;role:'user'|'assistant';content:string;requestId:string;asOf?:string}){return getDb().insert(s.financeChatMessages).values({id:uuidv7(),...input}).onConflictDoNothing().returning().get();}

export function financeChatRequest(p:FinancePrincipal,chatId:string,requestId:string){financeChatMessages(p,chatId);return getDb().select().from(s.financeChatMessages).where(and(eq(s.financeChatMessages.chatId,chatId),eq(s.financeChatMessages.requestId,requestId))).all();}
