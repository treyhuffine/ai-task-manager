'use client';
import { useEffect, useEffectEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { parseMoney, formatMoney, currencyDigits } from '@/lib/finance/money';
import { financeBudgetDiff } from '@/lib/finance/budget-diff';
import { type FinancePlan } from '@/lib/finance/contracts';
import { FinancePlanFields } from './finance-plan-fields';
import type { FinanceAccountRecord, FinanceBudgetRecord } from '@/db/types';
declare global {
  interface Window {
    Plaid?: {
      create: (o: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (
          token: string,
          meta: { accounts?: { id: string }[] },
        ) => void;
        onExit: () => void;
      }) => { open: () => void; destroy: () => void };
    };
  }
}
async function loadPlaid() {
  if (window.Plaid) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Plaid Link did not load'));
    document.head.append(script);
  });
}
export function FinanceSourceSetup({
  accounts,
  onDone,
}: {
  accounts: FinanceAccountRecord[];
  onDone: () => Promise<void>;
}) {
  const candidates = useQuery(trpc.finance.grantCandidates.queryOptions()),
    grants = useQuery(trpc.finance.grants.queryOptions());
  const [chatId, setChatId] = useState(''),
    [readEvidence, setReadEvidence] = useState(false),
    [writeBudget, setWriteBudget] = useState(false),
    [grantAccounts, setGrantAccounts] = useState<string[]>([]);
  const connections = useQuery(trpc.finance.sourceConnections.queryOptions()),
    copies = useQuery(trpc.finance.copies.queryOptions());
  const [selected, setSelected] = useState(''),
    [environment, setEnvironment] = useState<'sandbox' | 'production'>(
      'sandbox',
    ),
    [confirmed, setConfirmed] = useState(false),
    [monitoring, setMonitoring] = useState(true),
    [since, setSince] = useState(() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 6);
      return d.toISOString().slice(0, 10);
    }),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection setup failed');
    } finally {
      setBusy(false);
    }
  }
  async function launch(
    saved: {
      sessionId: string;
      linkToken: string;
      liabilities: boolean;
      selectedAccountIds?: string[];
    },
    redirect = false,
  ) {
    await loadPlaid();
    sessionStorage.setItem('ri.finance.link', JSON.stringify(saved));
    const link = window.Plaid!.create({
      token: saved.linkToken,
      ...(redirect ? { receivedRedirectUri: window.location.href } : {}),
      onSuccess: (publicToken, meta) => {
        void run(async () => {
          await trpcClient.finance.finishBankLink.mutate({
            sessionId: saved.sessionId,
            publicToken,
            selectedAccountIds:
              meta.accounts?.map((a) => a.id) ?? saved.selectedAccountIds ?? [],
            liabilities: saved.liabilities,
          });
          sessionStorage.removeItem('ri.finance.link');
          link.destroy();
        });
      },
      onExit: () => {
        setBusy(false);
        link.destroy();
      },
    });
    link.open();
  }
  const resumeLink = useEffectEvent(() => {
    if (!new URLSearchParams(window.location.search).has('oauth_state_id'))
      return;
    const saved = sessionStorage.getItem('ri.finance.link');
    if (saved) void run(() => launch(JSON.parse(saved), true));
  });
  useEffect(() => resumeLink(), []);
  const connection = connections.data?.find((c) => c.id === selected);
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium">Connect a source</h3>
      <p className="text-xs text-muted-foreground">
        Authorize the source in{' '}
        Ri’s Connectors        , then bind it here. Plaid needs your developer client credentials and
        Transactions access. Verify Trial eligibility, institution coverage, and
        pricing before using production.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <select
        aria-label="Source connection"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full rounded border border-border bg-background p-2 text-sm"
      >
        <option value="">Select authorized source</option>
        {connections.data
          ?.filter((c) => c.status === 'active')
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.provider}: {c.label}
            </option>
          ))}
      </select>
      {connection?.provider === 'plaid' ? (
        <>
          <label className="block text-sm">
            Plaid environment{' '}
            <select
              aria-label="Plaid environment"
              className="ml-2 rounded border border-border bg-background p-2"
              value={environment}
              onChange={(e) =>
                setEnvironment(e.target.value as typeof environment)
              }
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production or eligible Trial</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Statement balances, minimum payments and due dates are requested
            where supported. Missing fields can be entered manually. Available
            credit is never treated as cash.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I authorize linking selected U.S. personal accounts in USD to this
            finance app.
          </label>
          <Button
            size="sm"
            disabled={busy || !confirmed}
            onClick={() =>
              void run(async () => {
                const saved = await trpcClient.finance.beginBankLink.mutate({
                  developerConnectionId: selected,
                  environment,
                  confirmUSPersonalUSD: true,
                  liabilities: true,
                  redirectUri: window.location.origin + '/finance',
                });
                await launch({ ...saved, liabilities: true });
              })
            }
          >
            Open bank account selection
          </Button>
        </>
      ) : connection &&
        ['google', 'microsoft'].includes(connection.provider) ? (
        <>
          <p className="text-xs text-muted-foreground">
            Read access covers this mailbox. Receipt filtering happens in the finance app and
            does not limit the provider permission. This feature does not send
            or delete mail. The selected AI provider may receive relevant
            excerpts.
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              Initial history from{' '}
              <Input
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={monitoring}
                onChange={(e) => setMonitoring(e.target.checked)}
              />
              Continue monitoring receipts
            </label>
          </div>
          <Input
            aria-label="Merchant search"
            placeholder="Optional Gmail merchant or order query"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I authorize read-only ingestion and the selected monitoring setting.
          </label>
          <Button
            size="sm"
            disabled={busy || !confirmed}
            onClick={() =>
              void run(() =>
                trpcClient.finance.connectMailbox.mutate({
                  connectionId: selected,
                  provider: connection.provider as 'google' | 'microsoft',
                  initialStartOn: since,
                  query,
                  monitoring,
                  acknowledgeBroadMailboxRead: true,
                }),
              )
            }
          >
            Bind receipt mailbox
          </Button>
        </>
      ) : null}
      <div className="space-y-2">
        {accounts
          .filter((a) => a.provider === 'plaid' && a.access === 'connected')
          .map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const saved = await trpcClient.finance.beginBankLink.mutate({
                    developerConnectionId: a.connectionId!,
                    environment,
                    confirmUSPersonalUSD: true,
                    liabilities: true,
                    reconnectAccountId: a.id,
                  });
                  await launch({
                    ...saved,
                    liabilities: true,
                    selectedAccountIds: accounts
                      .filter((row) => row.connectionId === a.connectionId)
                      .map((row) => row.sourceId),
                  });
                })
              }
            >
              Repair {a.name}
            </Button>
          ))}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer">
          Allow a chat to use finance
        </summary>
        <p className="my-2 text-muted-foreground">
          Choose the accounts and operations explicitly. Financial results
          returned to an authorized chat can become part of its transcript.
          Receipt evidence requires a separate selection.
        </p>
        <select
          className="w-full rounded border border-border bg-background p-2"
          aria-label="Client to authorize"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
        >
          <option value="">Choose a client</option>
          {candidates.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label ?? 'Main chat'} ({c.id.slice(-8)})
            </option>
          ))}
        </select>
        <div className="my-3 flex flex-wrap gap-3">
          {accounts
            .filter((a) => a.access === 'connected')
            .map((a) => (
              <label key={a.id} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={grantAccounts.includes(a.id)}
                  onChange={(e) =>
                    setGrantAccounts(
                      e.target.checked
                        ? [...grantAccounts, a.id]
                        : grantAccounts.filter((id) => id !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
        </div>
        <label className="mr-3 inline-flex gap-2">
          <input
            type="checkbox"
            checked={readEvidence}
            onChange={(e) => setReadEvidence(e.target.checked)}
          />
          Read receipts and evidence
        </label>
        <label className="inline-flex gap-2">
          <input
            type="checkbox"
            checked={writeBudget}
            onChange={(e) => setWriteBudget(e.target.checked)}
          />
          Save budgets, matches and views
        </label>
        <Button
          className="my-3"
          size="sm"
          disabled={!chatId || !grantAccounts.length || busy}
          onClick={() =>
            void run(async () => {
              await trpcClient.finance.grant.mutate({
                principal: 'client:' + chatId,
                accountIds: grantAccounts,
                operations: [
                  'read',
                  ...(readEvidence ? ['evidence' as const] : []),
                  ...(writeBudget ? ['write' as const] : []),
                ],
              });
              await grants.refetch();
            })
          }
        >
          Save selected access
        </Button>
        {grants.data
          ?.filter((g) => !g.revoked)
          .map((g) => (
            <div key={g.id} className="mb-2 flex flex-wrap items-center gap-2">
              <span>
                {candidates.data?.find((c) => 'client:' + c.id === g.principal)
                  ?.label ?? 'Authorized client'}{' '}
                •{' '}
                {accounts.find((a) => a.id === g.accountId)?.name ??
                  'Unavailable account'}{' '}
                • {g.operations.join(', ')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run(async () => {
                    await trpcClient.finance.grant.mutate({
                      principal: g.principal,
                      accountIds: [g.accountId],
                      operations: [],
                      revoked: true,
                    });
                    await grants.refetch();
                  })
                }
              >
                Revoke access
              </Button>
            </div>
          ))}
      </details>
      <details className="text-xs">
        <summary className="cursor-pointer">
          Copies created by this plugin
        </summary>
        <p className="my-2 text-muted-foreground">
          This inventory covers recorded plugin exports and deliberate shares.
          Downloads, screenshots, provider copies and unrecorded copies cannot
          be erased from here. Finance backups retain data under ordinary
          retention.
        </p>
        {copies.data?.length ? (
          copies.data.map((c) => (
            <p key={c.id}>
              {c.destination} • {c.reference ?? 'Protected reference'} •{' '}
              {c.createdAt} • {c.status}
            </p>
          ))
        ) : (
          <p>No recorded exports or shared copies.</p>
        )}
      </details>
    </div>
  );
}
export function FinanceBudgetEditor({
  accounts,
  budget,
  onDone,
}: {
  accounts: FinanceAccountRecord[];
  budget: FinanceBudgetRecord | null;
  onDone: (viewId?: string) => Promise<void>;
}) {
  const [income, setIncome] = useState(''),
    [startDay, setStartDay] = useState(1),
    [draft, setDraft] = useState<FinancePlan | null>(null),
    [assumptions, setAssumptions] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const loadDraft = useEffectEvent(() => setDraft(budget?.plan ?? null));
  useEffect(() => loadDraft(), [budget?.id, budget?.revision]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Budget setup failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-5 rounded-xl border border-border p-5">
      <details open={!budget || budget.state === 'proposal'}>
        <summary className="cursor-pointer text-sm font-medium">
          {budget
            ? `${budget.state === 'proposal' ? 'Review proposal' : 'Edit budget'}: ${budget.name}`
            : 'Help me make a budget'}
        </summary>
        {error && (
          <p role="alert" className="my-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!budget ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              A proposal uses available income and spending history. You choose
              the targets before adopting it. With no history, enter manual
              amounts.
            </p>
            <div className="flex flex-wrap gap-3">
              <Input
                aria-label="Expected take-home income"
                placeholder="Conservative monthly take-home, USD"
                className="w-72"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
              <label className="text-sm">
                Start day{' '}
                <Input
                  className="w-20"
                  aria-label="Budget start day"
                  type="number"
                  min={1}
                  max={31}
                  value={startDay}
                  onChange={(e) => setStartDay(Number(e.target.value))}
                />
              </label>
              <Button
                disabled={
                  busy ||
                  !accounts.some(
                    (a) => a.access === 'connected' && a.kind !== 'mailbox',
                  )
                }
                onClick={() =>
                  void run(async () => {
                    const proposal =
                      await trpcClient.finance.proposeBudget.mutate({
                        accountIds: accounts
                          .filter((a) => a.access !== 'revoked')
                          .map((a) => a.id),
                        incomeMinor: income
                          ? parseMoney(income, 'USD')
                          : undefined,
                        startDay,
                        mutationKey: crypto.randomUUID(),
                      });
                    setAssumptions(proposal.assumptions);
                    await onDone(proposal.views[0].id);
                  })
                }
              >
                Propose starting budget
              </Button>
            </div>
          </div>
        ) : (
          draft && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                {draft.startOn} to {draft.endOn} • {draft.currency} • Revision{' '}
                {budget.revision}. This form edits a draft. Save shows the
                resulting version and supports undo.
              </p>
              {financeBudgetDiff(budget.plan, draft).length > 0 && (
                <details open>
                  <summary className="text-sm font-medium">
                    Changes to save
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {financeBudgetDiff(budget.plan, draft).map((d) => (
                      <li key={d.field}>
                        {d.label}:{' '}
                        {d.money && typeof d.before === 'number'
                          ? formatMoney(d.before, d.currency)
                          : String(d.before ?? 'None')}{' '}
                        to{' '}
                        {d.money && typeof d.after === 'number'
                          ? formatMoney(d.after, d.currency)
                          : String(d.after ?? 'None')}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="block text-sm">
                Expected take-home income{' '}
                <Input
                  className="mt-1 w-56"
                  type="number"
                  step={1 / 10 ** currencyDigits(draft.currency)}
                  value={
                    draft.incomeMinor / 10 ** currencyDigits(draft.currency)
                  }
                  onChange={(e) => {
                    try {
                      setDraft({
                        ...draft,
                        incomeMinor: parseMoney(
                          e.target.value || '0',
                          draft.currency,
                        ),
                        incomeConfidence: 'confirmed',
                      });
                    } catch {}
                  }}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.categories.map((c, i) => (
                  <label key={c.id} className="text-sm">
                    {c.name}
                    <div className="mt-1 flex gap-2">
                      <Input
                        aria-label={`${c.name} allocation`}
                        type="number"
                        min="0"
                        step={1 / 10 ** currencyDigits(draft.currency)}
                        value={
                          c.limitMinor / 10 ** currencyDigits(draft.currency)
                        }
                        onChange={(e) => {
                          try {
                            const categories = [...draft.categories];
                            categories[i] = {
                              ...c,
                              limitMinor: parseMoney(
                                e.target.value || '0',
                                draft.currency,
                              ),
                            };
                            setDraft({ ...draft, categories });
                          } catch {}
                        }}
                      />
                      <select
                        aria-label={`${c.name} rollover`}
                        className="rounded border border-border bg-background p-2 text-xs"
                        value={c.rollover}
                        onChange={(e) => {
                          const categories = [...draft.categories];
                          categories[i] = {
                            ...c,
                            rollover: e.target.value as typeof c.rollover,
                          };
                          setDraft({ ...draft, categories });
                        }}
                      >
                        <option value="none">No rollover</option>
                        <option value="positive">Positive only</option>
                        <option value="both">Positive and negative</option>
                      </select>
                    </div>
                  </label>
                ))}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer">
                  Goals, reserves, upcoming bills and forecasts
                </summary>
                <div className="mt-4">
                  <FinancePlanFields
                    plan={draft}
                    onChange={setDraft}
                    accounts={accounts}
                  />
                </div>
              </details>
              <p className="text-xs text-muted-foreground">
                Draft allocations:{' '}
                {formatMoney(
                  draft.categories.reduce((n, c) => n + c.limitMinor, 0),
                  draft.currency,
                )}
                . Expected income:{' '}
                {formatMoney(draft.incomeMinor, draft.currency)}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await trpcClient.finance.changeBudget.mutate({
                        id: budget.id,
                        expectedRevision: budget.revision,
                        mutationKey: crypto.randomUUID(),
                        plan: draft,
                        adopt: budget.state === 'proposal',
                      });
                      await onDone();
                    })
                  }
                >
                  {budget.state === 'proposal'
                    ? 'Adopt reviewed budget'
                    : 'Save budget revision'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await trpcClient.finance.changeBudget.mutate({
                        id: budget.id,
                        expectedRevision: budget.revision,
                        mutationKey: crypto.randomUUID(),
                        undo: true,
                      });
                      await onDone();
                    })
                  }
                >
                  Undo last change
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await trpcClient.finance.nextPeriod.mutate({
                        id: budget.id,
                        mutationKey: crypto.randomUUID(),
                      });
                      const view = await trpcClient.finance.saveView.mutate({
                        definition: {
                          version: 1,
                          title: 'Next period budget',
                          layout: 'grid',
                          components: [
                            {
                              id: 'remaining',
                              title: 'Remaining allocation',
                              type: 'metric',
                              metric: 'remaining',
                            },
                            {
                              id: 'categories',
                              title: 'Plan and spending',
                              type: 'chart',
                              dataset: 'budget',
                              style: 'bars',
                            },
                          ],
                        },
                        scope: {
                          accountIds: next.accountIds,
                          startOn: next.plan.startOn,
                          endOn: next.plan.endOn,
                          budgetId: next.id,
                          evidenceId: null,
                        },
                        expectedRevision: 0,
                        mutationKey: crypto.randomUUID(),
                      });
                      await onDone(view.id);
                    })
                  }
                >
                  Propose next period with rollover
                </Button>
              </div>
            </div>
          )
        )}
        {assumptions.map((a) => (
          <p key={a} className="mt-2 text-xs text-muted-foreground">
            {a}
          </p>
        ))}
      </details>
    </section>
  );
}

export function FinanceCardEditor({
  account,
  onDone,
}: {
  account: FinanceAccountRecord;
  onDone: () => Promise<void>;
}) {
  const [statement, setStatement] = useState(
      account.cardObligations?.statementBalanceMinor == null
        ? ''
        : String(
            account.cardObligations.statementBalanceMinor /
              10 ** currencyDigits(account.currency),
          ),
    ),
    [minimum, setMinimum] = useState(
      account.cardObligations?.minimumPaymentMinor == null
        ? ''
        : String(
            account.cardObligations.minimumPaymentMinor /
              10 ** currencyDigits(account.currency),
          ),
    ),
    [chosen, setChosen] = useState(
      account.cardObligations?.chosenPaymentMinor == null
        ? ''
        : String(
            account.cardObligations.chosenPaymentMinor /
              10 ** currencyDigits(account.currency),
          ),
    ),
    [due, setDue] = useState(account.cardObligations?.dueOn ?? ''),
    [error, setError] = useState('');
  return (
    <details className="w-full text-xs">
      <summary className="cursor-pointer">
        Statement and payment details
      </summary>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          void trpcClient.finance.cardObligations
            .mutate({
              id: account.id,
              obligations: {
                statementBalanceMinor: statement
                  ? parseMoney(statement, account.currency)
                  : null,
                currentBalanceMinor:
                  account.cardObligations?.currentBalanceMinor ??
                  account.balanceMinor,
                minimumPaymentMinor: minimum
                  ? parseMoney(minimum, account.currency)
                  : null,
                chosenPaymentMinor: chosen
                  ? parseMoney(chosen, account.currency)
                  : null,
                dueOn: due || null,
                source: 'manual',
                asOf: new Date().toISOString(),
              },
            })
            .then(onDone)
            .catch((e) => setError(e.message));
        }}
      >
        {[
          ['Statement balance', statement, setStatement],
          ['Minimum payment', minimum, setMinimum],
          ['Planned payment', chosen, setChosen],
        ].map(([label, value, setter]) => (
          <label key={String(label)}>
            {String(label)} ({account.currency})
            <Input
              className="mt-1 w-36"
              value={String(value)}
              onChange={(e) => (setter as (s: string) => void)(e.target.value)}
            />
          </label>
        ))}
        <label>
          Payment due
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <Button size="sm" type="submit">
          Save payment details
        </Button>
        <p className="w-full text-muted-foreground">
          The planned payment is your choice. Due dates and minimums do not
          establish autopay. Missing details keep the cash estimate partial.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
