import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createTestHome,type TestHome} from '@/test/fixtures/home';
import {seedSyntheticFinance} from '@/lib/finance/synthetic';
import {defaultFinanceViews} from '@/lib/finance/default-views';
import * as q from '@/lib/db/queries';
import {composeFinanceView} from './finance';
import {openFinanceChat,askFinanceChat} from './finance-chat';
const generated=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/harness/one-shot',()=>({runHarnessJson:generated}));
let home:TestHome;
beforeEach(async()=>{home=await createTestHome();generated.mockReset();});
afterEach(async()=>{await home.cleanup();});
it('persists a requested activity range while preserving the adopted budget period',async()=>{
 const f=seedSyntheticFinance(q.financeOwner);generated.mockResolvedValue({definition:defaultFinanceViews.Activity,dateScope:{startOn:'2026-04-06',endOn:'2026-10-07'}});
 const view=await composeFinanceView(q.financeOwner,{question:'Show dining over the last six months',scope:f.views[0].scope,expectedRevision:0,mutationKey:'composed-date-001'});
 expect(view.scope.startOn).toBe('2026-04-06');expect(q.getFinanceBudget(q.financeOwner,f.budget.id).plan).toEqual(f.budget.plan);
 expect(view.scope.accountIds).toEqual(f.views[0].scope.accountIds);
});
it('preserves a manual view edit when generation returns against an older revision',async()=>{
 const f=seedSyntheticFinance(q.financeOwner),view=f.views[0];
 generated.mockImplementation(async()=>{q.saveFinanceView(q.financeOwner,{id:view.id,definition:{...view.definition,title:'Manual edit'},scope:view.scope,expectedRevision:view.revision,mutationKey:'manual-view-edit-001'});return {definition:defaultFinanceViews.Activity};});
 await expect(composeFinanceView(q.financeOwner,{question:'Revise',scope:view.scope,viewId:view.id,expectedRevision:view.revision,mutationKey:'stale-composition-001'})).rejects.toThrow('changed');
 expect(q.getFinanceView(q.financeOwner,view.id).definition.title).toBe('Manual edit');
});
it('saves conversation responses once and keeps financial changes as proposals',async()=>{
 const f=seedSyntheticFinance(q.financeOwner),chat=await openFinanceChat(q.financeOwner,{viewId:f.views[0].id,includeEvidence:false,allowEdits:true});
 generated.mockResolvedValue({answer:'The current plan is available for review.',scenario:{categoryLimits:{dining:30000},goalContributions:{},obligationAmounts:{}}});
 const input={sessionId:chat.sessionId,message:'Try less dining',requestId:crypto.randomUUID()};await askFinanceChat(q.financeOwner,input);await askFinanceChat(q.financeOwner,input);
 expect(generated).toHaveBeenCalledTimes(1);expect(q.financeChatMessages(q.financeOwner,chat.sessionId).messages).toHaveLength(2);expect(q.getFinanceBudget(q.financeOwner,f.budget.id).plan).toEqual(f.budget.plan);
 await expect(askFinanceChat(q.financeOwner,{...input,message:'Different request'})).rejects.toThrow('different input');
});
it('rejects an in-flight reply when the owner withdraws evidence access',async()=>{
 const f=seedSyntheticFinance(q.financeOwner),chat=await openFinanceChat(q.financeOwner,{viewId:f.views[0].id,includeEvidence:true,allowEdits:false});
 generated.mockImplementation(async()=>{q.createFinanceChat(q.financeOwner,f.views[0].id,false);return {answer:'Old evidence context'};});
 await expect(askFinanceChat(q.financeOwner,{sessionId:chat.sessionId,message:'Review receipts',requestId:crypto.randomUUID()})).rejects.toThrow('Evidence permission changed');
 expect(q.financeChatMessages(q.financeOwner,chat.sessionId).messages.map(m=>m.role)).toEqual(['user']);
});
it('rejects a reply against a budget changed during generation',async()=>{
 const f=seedSyntheticFinance(q.financeOwner),chat=await openFinanceChat(q.financeOwner,{viewId:f.views[0].id,includeEvidence:false,allowEdits:false});
 generated.mockImplementation(async()=>{q.changeFinanceBudget(q.financeOwner,{id:f.budget.id,expectedRevision:f.budget.revision,mutationKey:'concurrent-budget-edit',plan:{...f.budget.plan,incomeMinor:f.budget.plan.incomeMinor+1000}});return {answer:'Old budget context'};});
 await expect(askFinanceChat(q.financeOwner,{sessionId:chat.sessionId,message:'Review spending',requestId:crypto.randomUUID()})).rejects.toThrow('budget changed during');
 expect(q.financeChatMessages(q.financeOwner,chat.sessionId).messages.map(m=>m.role)).toEqual(['user']);
});
