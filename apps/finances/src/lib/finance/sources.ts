import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import * as q from '@/lib/db/queries';
import {callConnector,connectorCapabilities,ConnectorUnavailable} from '@/lib/connectors/client';
import {bankLinkResultSchema,bankCompleteSchema} from '@/lib/connectors/contracts';
import type { FinancePrincipal } from '@/lib/db/finance-queries';
import { parseMoney } from './money';
import { transactionSchema } from './contracts';
import {publicBaseUrl} from '@/lib/config/paths';
import { OperationError } from '@/lib/server/operation';
import type { FinanceAccountRecord } from '@/db/types';
export function mergeFinanceCardObligations(
  previous: FinanceAccountRecord['cardObligations'],
  fresh: NonNullable<FinanceAccountRecord['cardObligations']>,
) {
  if (previous?.source !== 'manual')
    return {
      ...fresh,
      chosenPaymentMinor:
        previous?.chosenPaymentMinor ?? fresh.chosenPaymentMinor,
    };
  return {
    ...fresh,
    ...previous,
    currentBalanceMinor: fresh.currentBalanceMinor,
    statementBalanceMinor:
      previous.statementBalanceMinor ?? fresh.statementBalanceMinor,
    minimumPaymentMinor:
      previous.minimumPaymentMinor ?? fresh.minimumPaymentMinor,
    dueOn: previous.dueOn ?? fresh.dueOn,
  };
}
export class FinanceSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function financeSourceCall(connectionId:string,actionId:string,input:unknown){
 try{
  const value=input as Record<string,unknown>;
  if(actionId==='gmail.finance_read')return await callConnector(connectionId,'gmail.messages.read',value);
  if(actionId==='outlook_mail.finance_read')return await callConnector(connectionId,'outlook.messages.read',value);
  if(actionId!=='plaid.finance_call')throw new Error('Unsupported connector operation');
  const path=z.enum(['/transactions/sync','/accounts/get','/liabilities/get','/item/remove','/webhook_verification_key/get']).parse(value.path);
  const operations={'/transactions/sync':'plaid.transactions.sync','/accounts/get':'plaid.accounts.read','/liabilities/get':'plaid.liabilities.read','/item/remove':'plaid.item.remove','/webhook_verification_key/get':'plaid.webhook.key'} as const;
  return await callConnector(connectionId,operations[path],value.body as Record<string,unknown>);
 }catch(e){if(e instanceof ConnectorUnavailable)throw new FinanceSourceError(e.code,e.message);throw e;}
}
export async function listFinanceSourceConnections(p:FinancePrincipal){if(!p.owner)throw new OperationError(403,{message:'Owner setup required'});try{return (await connectorCapabilities()).connections;}catch(e){if(e instanceof ConnectorUnavailable)return [];throw e;}}
export async function beginFinanceBankLink(
  p: FinancePrincipal,
  input: {
    developerConnectionId: string;
    environment: 'sandbox' | 'production';
    confirmUSPersonalUSD: true;
    liabilities: boolean;
    reconnectAccountId?: string;
    redirectUri?: string;
  },
) {
  if (
    !p.owner ||
    !q.getFinanceSettings()?.enabled ||
    !q.getFinanceSettings()?.restoreReviewed
  )
    throw new OperationError(403, { message: 'Owner finance setup required' });
  const account=input.reconnectAccountId?q.requireFinance(p,[input.reconnectAccountId],'sync')[0]:null;
  const connectionId=account?.connectionId??input.developerConnectionId;
  const result=bankLinkResultSchema.parse(await callConnector(connectionId,'plaid.link.begin',{environment:input.environment,liabilities:input.liabilities,confirmUSPersonalUSD:input.confirmUSPersonalUSD,reconnect:!!account,redirectUri:input.redirectUri,webhookUrl:publicBaseUrl()?new URL('/api/webhooks/finance/plaid',publicBaseUrl()!).href:null,daysRequested:730}));
  const session=q.createFinanceSetupSession(p,{connectionId,environment:input.environment,itemId:result.setupId});
  return {sessionId:session.id,linkToken:result.linkToken,expiresAt:result.expiresAt,environment:input.environment};
}
const plaidAccount = z.object({
  mask: z.string().nullable().optional(),
  account_id: z.string(),
  name: z.string(),
  type: z.string(),
  subtype: z.string().nullable().optional(),
  balances: z.object({
    current: z.number().nullable(),
    iso_currency_code: z.string().nullable(),
    unofficial_currency_code: z.string().nullable().optional(),
  }),
});
export async function finishFinanceBankLink(
  p: FinancePrincipal,
  input: {
    sessionId: string;
    publicToken?: string;
    selectedAccountIds: string[];
    liabilities: boolean;
  },
) {
  const session = q.getFinanceSetupSession(p, input.sessionId);
  const result=bankCompleteSchema.parse(await callConnector(session.connectionId,'plaid.link.complete',{setupId:session.itemId,publicToken:input.publicToken,selectedAccountIds:input.selectedAccountIds,liabilities:input.liabilities},session.id));
  const connectionId=result.connectionId,itemId=result.itemId,raw=result;
  const accounts = raw.accounts.map((a) => plaidAccount.parse(a));
  if (
    !input.selectedAccountIds.length ||
    input.selectedAccountIds.some(
      (id) => !accounts.some((a) => a.account_id === id),
    )
  )
    throw new Error('Select available accounts');
  const saved = accounts
    .filter((a) => input.selectedAccountIds.includes(a.account_id))
    .map((a) => {
      const currency = a.balances.iso_currency_code;
      if (!currency) throw new Error('Account currency is unavailable');
      return q.createFinanceAccount(p, {
        name: a.name,
        kind:
          a.type === 'credit'
            ? 'credit'
            : a.type === 'depository'
              ? 'cash'
              : 'excluded',
        provider: 'plaid',
        currency,
        connectionId,
        sourceId: a.account_id,
        mask: a.mask ?? null,
        balanceMinor:
          a.balances.current === null
            ? null
            : providerMinor(a.balances.current, currency),
        balanceIncludesPending: false,
        historyStart: null,
        asOf: new Date().toISOString(),
      });
    });
  q.saveFinanceItem(p, {
    itemId,
    connectionId,
    environment: session.environment,
    liabilitiesEnabled: input.liabilities,
  });
  q.consumeFinanceSetupSession(p, session.id);
  q.queueFinanceSync(p, saved[0].id);
  return {
    accounts: saved,
    history: 'Up to 24 months requested. Actual coverage is shown after sync.',
  };
}
/** Provider decimal JSON values must round-trip as currency decimal strings. */
export function providerMinor(amount: number, currency: string) {
  if (!Number.isFinite(amount)) throw new Error('Invalid provider amount');
  return parseMoney(String(amount), currency);
}
const plaidTransaction = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(),
  iso_currency_code: z.string().nullable(),
  date: z.string(),
  authorized_date: z.string().nullable().optional(),
  merchant_name: z.string().nullable().optional(),
  name: z.string(),
  pending: z.boolean(),
  pending_transaction_id: z.string().nullable().optional(),
  personal_finance_category: z
    .object({ primary: z.string(), detailed: z.string() })
    .nullable()
    .optional(),
});
export function normalizePlaidTransaction(
  raw: unknown,
  accountMap: Map<string, string>,
) {
  const t = plaidTransaction.parse(raw),
    accountId = accountMap.get(t.account_id);
  if (!accountId) return null;
  if (!t.iso_currency_code) throw new Error('Transaction currency is missing');
  const primary = t.personal_finance_category?.primary ?? '',
    detailed = t.personal_finance_category?.detailed ?? '',
    kind =
      primary === 'INCOME'
        ? 'income'
        : /TRANSFER|LOAN_PAYMENTS/.test(primary)
          ? /CREDIT_CARD_PAYMENT/.test(detailed)
            ? 'card_payment'
            : 'transfer'
          : /INTEREST/.test(detailed)
            ? 'interest'
            : /FEES/.test(primary)
              ? 'fee'
              : t.amount < 0
                ? 'refund'
                : 'purchase';
  const category =
    kind === 'income'
      ? 'income'
      : ['transfer', 'card_payment'].includes(kind)
        ? 'transfer'
        : /FOOD_AND_DRINK/.test(primary)
          ? 'dining'
          : /RENT_AND_UTILITIES/.test(primary)
            ? 'fixed'
            : /ENTERTAINMENT/.test(primary)
              ? 'subscriptions'
              : /GENERAL_MERCHANDISE/.test(primary)
                ? 'shopping'
                : 'other';
  return transactionSchema.parse({
    sourceId: t.transaction_id,
    accountId,
    amountMinor: providerMinor(t.amount, t.iso_currency_code),
    currency: t.iso_currency_code,
    postedOn: t.date,
    authorizedOn: t.authorized_date ?? null,
    merchant: t.merchant_name ?? t.name,
    category,
    kind,
    state: t.pending ? 'pending' : 'posted',
    pendingSourceId: t.pending_transaction_id ?? null,
    obligationId: null,
    refundOf: null,
  });
}
export async function collectPlaidSync(
  call: (cursor: string | null) => Promise<unknown>,
  initialCursor: string | null,
  accountMap: Map<string, string>,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = initialCursor;
    const added: unknown[] = [],
      removed: { accountId: string; sourceId: string }[] = [];
    try {
      for (let page = 0; page < 500; page++) {
        const raw = (await call(cursor)) as {
          added: unknown[];
          modified: unknown[];
          removed: { account_id: string; transaction_id: string }[];
          next_cursor: string;
          has_more: boolean;
        };
        for (const t of [...raw.added, ...raw.modified]) {
          const row = normalizePlaidTransaction(t, accountMap);
          if (row) added.push(row);
        }
        for (const t of raw.removed) {
          const id = accountMap.get(t.account_id);
          if (id) removed.push({ accountId: id, sourceId: t.transaction_id });
        }
        if (added.length + removed.length > 50000)
          throw new Error('Sync batch exceeds limit');
        cursor = raw.next_cursor;
        if (!raw.has_more) return { added, removed, cursor };
      }
      throw new Error('Sync pagination exceeds limit');
    } catch (e) {
      if (
        !(e instanceof FinanceSourceError) ||
        e.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
        attempt === 2
      )
        throw e;
    }
  }
  throw new Error('Sync could not finish');
}
export async function syncFinanceBank(
  p: FinancePrincipal,
  job: { id?:string; leaseToken?:string|null; accountId: string; generation: number; cursor: string | null },
) {
  const anchor = q.requireFinance(p, [job.accountId], 'sync')[0];
  if (!anchor.connectionId) throw new Error('Bank connection missing');
  const accounts = q.financeConnectionAccounts(p, anchor.connectionId),
    map = new Map(accounts.map((a) => [a.sourceId, a.id]));
  const batch = await collectPlaidSync(
    (cursor) =>
      financeSourceCall(anchor.connectionId!, 'plaid.finance_call', {
        path: '/transactions/sync',
        body: { ...(cursor ? { cursor } : {}), count: 500 },
      }),
    job.cursor,
    map,
  );
  const asOf = new Date().toISOString();
  q.applyFinanceSync(p, {
    accountIds: accounts.map((a) => a.id),
    generation: job.generation,
    ...batch,
    syncAccountId: anchor.id,
    jobId:job.id, leaseToken:job.leaseToken,
    asOf,
  });
  const balances = (await financeSourceCall(
    anchor.connectionId,
    'plaid.finance_call',
    { path: '/accounts/get', body: {} },
  )) as { accounts: unknown[] };
  for (const raw of balances.accounts) {
    const a = plaidAccount.parse(raw),
      local = accounts.find((row) => row.sourceId === a.account_id);
    if (local && a.balances.iso_currency_code === local.currency)
      q.updateFinanceAccountSource(p, local.id, {
        historyStart:
          q
            .financeTransactionsForCalculation(p, {
              accountIds: [local.id],
              startOn: '1970-01-01',
              endOn: asOf.slice(0, 10),
            })
            .filter((t) => t.state !== 'removed')[0]?.postedOn ?? undefined,
        balanceMinor:
          a.balances.current === null
            ? null
            : providerMinor(a.balances.current, local.currency),
        asOf,
      });
  }
  const item = q.getFinanceItem(p, anchor.connectionId);
  if (item?.liabilitiesEnabled)
    try {
      const data = (await financeSourceCall(
        anchor.connectionId,
        'plaid.finance_call',
        { path: '/liabilities/get', body: {} },
      )) as {
        liabilities?: {
          credit?: {
            account_id: string;
            last_statement_balance: number | null;
            minimum_payment_amount: number | null;
            next_payment_due_date: string | null;
          }[];
        };
      };
      for (const card of data.liabilities?.credit ?? []) {
        const local = accounts.find((a) => a.sourceId === card.account_id);
        if (local)
          q.updateFinanceAccountSource(p, local.id, {
            cardObligations: mergeFinanceCardObligations(
              local.cardObligations,
              {
                asOf,
                statementBalanceMinor:
                  card.last_statement_balance === null
                    ? null
                    : providerMinor(
                        card.last_statement_balance,
                        local.currency,
                      ),
                minimumPaymentMinor:
                  card.minimum_payment_amount === null
                    ? null
                    : providerMinor(
                        card.minimum_payment_amount,
                        local.currency,
                      ),
                currentBalanceMinor: q.requireFinance(p, [local.id])[0]
                  .balanceMinor,
                chosenPaymentMinor:
                  local.cardObligations?.chosenPaymentMinor ?? null,
                dueOn: card.next_payment_due_date,
                source: 'provider',
              },
            ),
          });
      }
    } catch {
      /* Transactions remains usable when Liabilities is unsupported. */
    }
  return batch.cursor;
}
export async function connectFinanceMailbox(
  p: FinancePrincipal,
  input: {
    connectionId: string;
    provider: 'google' | 'microsoft';
    initialStartOn: string;
    query: string;
    monitoring: boolean;
    acknowledgeBroadMailboxRead: true;
  },
) {
  if (!p.owner) throw new Error('Owner setup required');
  const connection=(await connectorCapabilities()).connections.find(c=>c.id===input.connectionId&&c.provider===input.provider&&c.status==='active');
  if(!connection)throw new Error('Select an active mailbox connection');
  const stored={connection};
  const required =
    input.provider === 'google'
      ? 'https://www.googleapis.com/auth/gmail.readonly'
      : 'Mail.Read';
  if (
    !stored.connection.scopes.includes(required) &&
    !(
      input.provider === 'google' &&
      stored.connection.scopes.includes('https://mail.google.com/')
    )
  )
    throw new Error('Authorize read-only mailbox access in Connectors');
  const a = q.createFinanceAccount(p, {
    name:
      stored.connection.label ?? 'Receipt mailbox',
    kind: 'mailbox',
    provider: input.provider,
    currency: q.getFinanceSettings()!.currency,
    connectionId: input.connectionId,
    sourceId: `mail:${input.connectionId}`,
    balanceMinor: null,
    balanceIncludesPending: false,
    historyStart: input.initialStartOn,
    asOf: null,
  });
  q.bindFinanceMailbox(p, {
    accountId: a.id,
    initialStartOn: input.initialStartOn,
    query: input.query,
    monitoring: input.monitoring,
  });
  q.queueFinanceSync(p, a.id);
  return a;
}
export async function disconnectFinanceSource(
  p: FinancePrincipal,
  id: string,
  retain: boolean,
) {
  const a = q.requireFinance(p, [id])[0],
    connection = a.connectionId,
    siblings = connection ? q.financeConnectionAccounts(p, connection) : [];
  const result = q.disconnectFinanceAccount(p, id, true);
  let providerRevoked = true;
  if (connection && a.provider === 'plaid' && siblings.length === 1) {
    try {
      await financeSourceCall(connection, 'plaid.finance_call', {
        path: '/item/remove',
        body: {},
      });
    } catch {
      providerRevoked = false;
    }
    try{await callConnector(connection,'connection.release',{});}catch{providerRevoked=false;}
    q.retireFinanceItem(p, connection);
  }
  if (!retain) q.deleteLiveFinanceData(p, [id]);
  return {
    ...result,
    providerRevoked,
    revocationMessage: providerRevoked
      ? 'Finance binding removed.'
      : 'Local access removed. Provider revocation could not be confirmed. Review the institution connection.',
  };
}

export function webhookDigest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
