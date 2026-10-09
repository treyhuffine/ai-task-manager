import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { z } from 'zod/v4';
import type { FinancePlan, FinanceScenarioChanges, FinanceEvidenceData, FinanceViewDefinition, FinanceViewScope, cardObligationsSchema } from '@/lib/finance/contracts';
export type StoredAttachment={file_name:string;original_name:string;mime_type:string;size:number;uploaded_at:string};
export type Attachment={fileName:string;originalName:string;mimeType:string;size:number;uploadedAt:string};
const timestamps={createdAt:text().notNull().default(sql`(datetime('now'))`),updatedAt:text().notNull().default(sql`(datetime('now'))`).$onUpdate(()=>sql`(datetime('now'))`)};
export const financeSettings = sqliteTable('finance_settings', {
  id: text().primaryKey(), ...timestamps,
  enabled: integer({ mode: 'boolean' }).notNull(),
  restoreReviewed: integer({ mode: 'boolean' }).notNull(),
  currency: text().notNull(), timezone: text().notNull(), startDay: integer().notNull(),
  generation: integer().notNull().default(0),
  autoTasks: integer({ mode: 'boolean' }).notNull(),
  thresholds: text({mode:'json'}).$type<{overspendMinor:number;priceChangePercent:number}>().notNull(),
});
export const financeAccounts = sqliteTable('finance_accounts', {
  id: text().primaryKey(), ...timestamps,
  name: text().notNull(), kind: text({enum:['cash','credit','mailbox','excluded']}).notNull(),
  provider: text({enum:['manual','plaid','google','microsoft','synthetic']}).notNull(),
  currency: text().notNull(), connectionId: text(), sourceId: text().notNull(), mask:text(),
  access: text({enum:['connected','retained','revoked']}).notNull(),
  balanceMinor: integer(), balanceIncludesPending: integer({mode:'boolean'}).notNull(),
  historyStart: text(), asOf: text(),
  cardObligations: text({mode:'json'}).$type<z.infer<typeof cardObligationsSchema>>(),
  syncStatus: text({enum:['idle','syncing','stale','reconnect','error']}).notNull(),
},t=>[uniqueIndex('finance_accounts_source').on(t.provider,t.sourceId),index('finance_accounts_connection').on(t.connectionId)]);
export const financeGrants = sqliteTable('finance_grants', {
  id:text().primaryKey(), ...timestamps,
  principal:text().notNull(), accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),
  operations:text({mode:'json'}).$type<('read'|'write'|'sync'|'evidence')[]>().notNull(),
  revoked:integer({mode:'boolean'}).notNull(),
},t=>[uniqueIndex('finance_grants_principal_account').on(t.principal,t.accountId)]);
export const financeTransactions = sqliteTable('finance_transactions', {
  id:text().primaryKey(), ...timestamps,
  accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),sourceId:text().notNull(),
  amountMinor:integer().notNull(),currency:text().notNull(),postedOn:text().notNull(),authorizedOn:text(),
  merchant:text().notNull(),category:text().notNull(),
  kind:text({enum:['purchase','refund','income','transfer','card_payment','interest','fee']}).notNull(),
  state:text({enum:['pending','posted','removed']}).notNull(),pendingSourceId:text(),obligationId:text(),refundOf:text(),
  sourceRevision:integer().notNull().default(0),
},t=>[uniqueIndex('finance_transactions_source').on(t.accountId,t.sourceId),index('finance_transactions_account_date').on(t.accountId,t.postedOn,t.id),index('finance_transactions_pending').on(t.accountId,t.pendingSourceId)]);
export const financeOverrides = sqliteTable('finance_overrides',{
  id:text().primaryKey(), ...timestamps,
  transactionId:text().notNull().references(()=>financeTransactions.id,{onDelete:'cascade'}),
  category:text(),kind:text({enum:['purchase','refund','income','transfer','card_payment','interest','fee']}),
  obligationId:text(), revision:integer().notNull().default(0),
},t=>[uniqueIndex('finance_overrides_transaction').on(t.transactionId)]);
export const financeRules = sqliteTable('finance_rules',{
  id:text().primaryKey(), ...timestamps, accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),
  merchant:text().notNull(),category:text().notNull(),
},t=>[uniqueIndex('finance_rules_merchant').on(t.accountId,t.merchant)]);
export const financeEvidence = sqliteTable('finance_evidence',{
  id:text().primaryKey(), ...timestamps, accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),
  sourceId:text().notNull(), fingerprint:text().notNull(),occurredOn:text().notNull(),
  data:text({mode:'json'}).$type<FinanceEvidenceData>().notNull(),
  attachments:text({mode:'json'}).$type<StoredAttachment[]>().notNull().default([]),
  revision:integer().notNull().default(0), humanReviewed:integer({mode:'boolean'}).notNull(),
},t=>[uniqueIndex('finance_evidence_source').on(t.accountId,t.sourceId),index('finance_evidence_fingerprint').on(t.fingerprint),index('finance_evidence_account_date').on(t.accountId,t.occurredOn)]);
export const financeAllocations = sqliteTable('finance_allocations',{
  id:text().primaryKey(), ...timestamps,
  evidenceId:text().notNull().references(()=>financeEvidence.id,{onDelete:'cascade'}),
  transactionId:text().notNull().references(()=>financeTransactions.id,{onDelete:'cascade'}),
  amountMinor:integer().notNull(), itemId:text(), decision:text({enum:['human','confirmed','suggested','rejected']}).notNull(),
  role:text({enum:['purchase','refund','recharge']}),
  confidence:real().notNull(), revision:integer().notNull().default(0),
},t=>[uniqueIndex('finance_allocation_pair').on(t.evidenceId,t.transactionId),index('finance_allocation_transaction').on(t.transactionId)]);
export const financeRecurring = sqliteTable('finance_recurring',{
  id:text().primaryKey(), ...timestamps,
  accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),key:text().notNull(),
  merchant:text().notNull(),category:text().notNull(),currency:text().notNull(),amountMinor:integer().notNull(),
  cadence:text({enum:['monthly','annual','variable']}).notNull(),nextOn:text(),
  status:text({enum:['suspected','confirmed','cancelled']}).notNull(),
  transactionIds:text({mode:'json'}).$type<string[]>().notNull().default([]),evidenceIds:text({mode:'json'}).$type<string[]>().notNull().default([]),
  previousAmountMinor:integer(), revision:integer().notNull().default(0),
},t=>[uniqueIndex('finance_recurring_key').on(t.accountId,t.key)]);
export const financeBudgets = sqliteTable('finance_budgets',{
  id:text().primaryKey(), ...timestamps,
  name:text().notNull(),state:text({enum:['proposal','adopted','closed']}).notNull(),
  plan:text({mode:'json'}).$type<FinancePlan>().notNull(),
  accountIds:text({mode:'json'}).$type<string[]>().notNull(),
  revision:integer().notNull().default(0),
});
export const financeScenarios = sqliteTable('finance_scenarios',{
  id:text().primaryKey(), ...timestamps,
  budgetId:text().notNull().references(()=>financeBudgets.id,{onDelete:'cascade'}),baseRevision:integer().notNull(),
  name:text().notNull(),changes:text({mode:'json'}).$type<FinanceScenarioChanges>().notNull(),
  revision:integer().notNull().default(0),
},t=>[index('finance_scenarios_budget').on(t.budgetId)]);
export const financeViews = sqliteTable('finance_views',{
  id:text().primaryKey(), ...timestamps,
  definition:text({mode:'json'}).$type<FinanceViewDefinition>().notNull(),
  scope:text({mode:'json'}).$type<FinanceViewScope>().notNull(),
  scenarioId:text().references(()=>financeScenarios.id,{onDelete:'set null'}),
  originChatId:text(),revision:integer().notNull().default(0),
  mode:text({enum:['live','snapshot']}).notNull(), asOf:text().notNull(),
},t=>[index('finance_views_updated').on(t.updatedAt,t.id)]);
export const financeRevisions = sqliteTable('finance_revisions',{
  id:text().primaryKey(), ...timestamps,
  entityType:text({enum:['budget','view','scenario','override','allocation','transaction']}).notNull(),entityId:text().notNull(),
  revision:integer().notNull(),before:text({mode:'json'}).$type<unknown>(),after:text({mode:'json'}).$type<unknown>(),
  operation:text().notNull(),mutationKey:text().notNull(),principal:text().notNull(),
},t=>[uniqueIndex('finance_revisions_mutation').on(t.principal,t.mutationKey),index('finance_revisions_entity').on(t.entityType,t.entityId,t.revision)]);
export const financeFindings = sqliteTable('finance_findings',{
  id:text().primaryKey(), ...timestamps,
  accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),key:text().notNull(),
  kind:text({enum:['deduction','settlement','renewal','price_change','after_cancellation','overspending','connection','ambiguous_match','duplicate','goal']}).notNull(),
  message:text().notNull(),evidenceId:text().references(()=>financeEvidence.id,{onDelete:'set null'}),
  transactionIds:text({mode:'json'}).$type<string[]>().notNull().default([]),
  state:text({enum:['open','resolved','snoozed']}).notNull(),snoozedUntil:text(),dueOn:text(),amountMinor:integer(),
  handoffId:text(),
},t=>[uniqueIndex('finance_findings_key').on(t.accountId,t.key),index('finance_findings_state').on(t.state,t.accountId)]);
export const financeSync = sqliteTable('finance_sync',{
  id:text().primaryKey(), ...timestamps,
  accountId:text().notNull().references(()=>financeAccounts.id,{onDelete:'cascade'}),cursor:text(),
  generation:integer().notNull(),state:text({enum:['idle','running','retry','disabled']}).notNull(),
  attempts:integer().notNull().default(0),nextOn:text().notNull(),leaseUntil:text(),lastError:text(),
  rerunRequested:integer({mode:'boolean'}),leaseToken:text(),
},t=>[uniqueIndex('finance_sync_account').on(t.accountId),index('finance_sync_due').on(t.state,t.nextOn)]);
export const financeWebhookReceipts = sqliteTable('finance_webhook_receipts',{
  id:text().primaryKey(), ...timestamps,provider:text().notNull(),digest:text().notNull(),
},t=>[uniqueIndex('finance_webhook_digest').on(t.provider,t.digest)]);

export const financeItems = sqliteTable('finance_items', {
  id:text().primaryKey(),...timestamps,itemId:text().notNull().unique(),connectionId:text().notNull().unique(),
  environment:text({enum:['sandbox','production']}).notNull(),liabilitiesEnabled:integer({mode:'boolean'}).notNull(),
  status:text({enum:['active','reconnect','removed']}).notNull(),
});
export const financeSetupSessions = sqliteTable('finance_setup_sessions', {
  id:text().primaryKey(),...timestamps,connectionId:text().notNull(),environment:text({enum:['sandbox','production']}).notNull(),
  expiresAt:text().notNull(),itemId:text(),consumed:integer({mode:'boolean'}).notNull(),
});
export const financeMailboxes = sqliteTable('finance_mailboxes', {
  id:text().primaryKey(),...timestamps,accountId:text().notNull().unique().references(()=>financeAccounts.id,{onDelete:'cascade'}),
  initialStartOn:text().notNull(),query:text().notNull(),monitoring:integer({mode:'boolean'}).notNull(),
});
export const financeAttachmentRefs = sqliteTable('finance_attachment_refs', {
  id:text().primaryKey(),...timestamps,evidenceId:text().notNull().references(()=>financeEvidence.id,{onDelete:'cascade'}),
  fileName:text().notNull(),
},t=>[uniqueIndex('finance_attachment_ref_unique').on(t.evidenceId,t.fileName),index('finance_attachment_file').on(t.fileName)]);
export const financeCopies = sqliteTable('finance_copies', {
  id:text().primaryKey(),...timestamps,accountIds:text({mode:'json'}).$type<string[]>().notNull(),
  destination:text().notNull(),reference:text(),status:text({enum:['created','cleaned','external']}).notNull(),
});
export const financeFileDeletions = sqliteTable('finance_file_deletions', {
  id:text().primaryKey(),...timestamps,fileName:text().notNull().unique(),attempts:integer().notNull().default(0),
});
export const financeAppSettings=sqliteTable('finance_app_settings',{id:text().primaryKey(),...timestamps,harness:text({enum:['claude','codex','cursor','opencode','antigravity']}).notNull()});
export const financeClients=sqliteTable('finance_clients',{id:text().primaryKey(),...timestamps,label:text().notNull(),tokenHash:text().notNull().unique(),revoked:integer({mode:'boolean'}).notNull()});
export const financeHandoffs=sqliteTable('finance_handoffs',{id:text().primaryKey(),...timestamps,findingId:text().notNull().unique().references(()=>financeFindings.id,{onDelete:'cascade'}),title:text().notNull(),reference:text().notNull(),dueOn:text(),state:text({enum:['pending','delivered','cancelled']}).notNull(),taskId:text()});
export const financeChats=sqliteTable('finance_chats',{id:text().primaryKey(),...timestamps,viewId:text().notNull().unique().references(()=>financeViews.id,{onDelete:'cascade'}),includeEvidence:integer({mode:'boolean'}).notNull()});
export const financeChatMessages=sqliteTable('finance_chat_messages',{id:text().primaryKey(),...timestamps,chatId:text().notNull().references(()=>financeChats.id,{onDelete:'cascade'}),role:text({enum:['user','assistant']}).notNull(),content:text().notNull(),requestId:text().notNull(),asOf:text()},t=>[uniqueIndex('finance_chat_message_request').on(t.chatId,t.role,t.requestId),index('finance_chat_message_order').on(t.chatId,t.createdAt,t.id)]);
