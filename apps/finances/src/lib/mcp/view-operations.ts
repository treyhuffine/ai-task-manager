import {z} from 'zod/v4';
import * as q from '@/lib/db/queries';
import {openFinanceView} from '@/lib/finance/service';
import type {FinancePrincipal} from '@/lib/db/finance-queries';
import {financeId,revisionNumber,scenarioChangesSchema,dateOnly,mutationKey} from '@/lib/finance/contracts';
export const widgetInputSchema=z.object({viewId:financeId,viewRevision:revisionNumber,budgetRevision:revisionNumber.optional(),id:financeId.optional(),dataset:z.enum(['transactions','evidence','refunds','findings','accounts','recurring','budget']).optional(),changes:scenarioChangesSchema.optional(),filters:z.object({startOn:dateOnly.optional(),endOn:dateOnly.optional(),accountIds:z.array(financeId).min(1).max(100).optional()}).strict().optional(),mutationKey:mutationKey.optional()}).strict();
export const viewOperations=['finance_refresh','finance_filter','finance_scenario_preview','finance_inspect','finance_save_view_filters','finance_save_view_scenario','finance_view_apply_scenario','finance_view_undo_budget'] as const;
export type ViewOperation=typeof viewOperations[number];
export function runViewOperation(p:FinancePrincipal,name:ViewOperation,raw:unknown){
 const input=widgetInputSchema.parse(raw),view=q.getFinanceView(p,input.viewId);
 const checkView=()=>{if(view.revision!==input.viewRevision)throw new Error('The selected view changed. Reopen its current revision.');};
 if(!['finance_save_view_filters','finance_save_view_scenario','finance_view_apply_scenario','finance_view_undo_budget'].includes(name))checkView();
 if(name==='finance_inspect'){
  if(!input.id)throw new Error('Choose a record to inspect');
  const current=openFinanceView(p,view.id);
  if(input.dataset==='evidence'||input.dataset==='refunds'){const evidence=q.getFinanceEvidence(p,input.id);if(!view.scope.accountIds.includes(evidence.accountId))throw new Error('This evidence is outside the selected view');return {inspection:{type:'evidence',record:evidence,allocations:q.listFinanceAllocations(p,[evidence.id])}};}
  if(input.dataset==='findings'){const finding=q.getFinanceFinding(p,input.id);if(!view.scope.accountIds.includes(finding.accountId))throw new Error('This finding is outside the selected view');return {inspection:{type:'finding',record:finding}};}
  const rows=input.dataset==='transactions'?current.data.transactions:input.dataset==='accounts'?current.data.accounts:input.dataset==='recurring'?current.data.recurring:current.data.budget?.categories??[];
  const record=rows.find(r=>('id' in r&&r.id===input.id)||('key' in r&&r.key===input.id));if(!record)throw new Error('Record unavailable in the current scope');return {inspection:{type:input.dataset,record}};
 }
 if(['finance_save_view_filters','finance_save_view_scenario','finance_view_apply_scenario','finance_view_undo_budget'].includes(name)){
  if(!input.mutationKey)throw new Error('This operation requires a replay key');
  const key=input.mutationKey;
  q.runFinanceViewMutation(p,view.id,key,{name,input},()=>{
  checkView();
  q.requireFinance(p,view.scope.accountIds,'write');
  if(name==='finance_save_view_filters')q.saveFinanceView(p,{id:view.id,definition:view.definition,scope:{...view.scope,filters:input.filters},expectedRevision:view.revision,mutationKey:key});
  else{
   if(!view.scope.budgetId)throw new Error('Select a budget for this operation');
   const budget=q.getFinanceBudget(p,view.scope.budgetId);
   if(input.budgetRevision!==budget.revision)throw new Error('The budget changed. Refresh and review the current budget before continuing.');
   if(name==='finance_view_undo_budget')q.changeFinanceBudget(p,{id:budget.id,expectedRevision:budget.revision,mutationKey:key,undo:true});
   else{
    if(!input.changes)throw new Error('Review a scenario before saving or applying');
    const scenario=q.saveFinanceScenario(p,{budgetId:budget.id,name:'View scenario',changes:input.changes,expectedRevision:0,mutationKey:key+':scenario'});
    if(name==='finance_save_view_scenario')q.saveFinanceView(p,{id:view.id,definition:view.definition,scope:view.scope,scenarioId:scenario.id,expectedRevision:view.revision,mutationKey:key+':view'});
    else q.applyFinanceScenario(p,{scenarioId:scenario.id,expectedBudgetRevision:budget.revision,mutationKey:key+':apply'});
   }
  }
  });
 }
 return openFinanceView(p,view.id,{changes:input.changes,filters:input.filters});
}
