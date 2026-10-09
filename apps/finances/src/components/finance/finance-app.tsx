'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Wallet,
  Plus,
  RefreshCw,
  Download,
  MessageCircleMore,
  Settings2,
  X,
  FileText,
} from 'lucide-react';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { defaultFinanceViews } from '@/lib/finance/default-views';
import {
  type FinanceScenarioChanges,
} from '@/lib/finance/contracts';
import { formatMoney, parseMoney } from '@/lib/finance/money';
import {
  FinanceSourceSetup,
  FinanceBudgetEditor,
  FinanceCardEditor,
} from './finance-setup';
import {
  FinanceEvidenceEditor,
  FinanceManualEvidence,
} from './finance-evidence';
import type { FinanceEvidenceRecord } from '@/db/types';
import { StandaloneSettings } from './standalone-settings';
import { FinanceChat } from './finance-chat';
import {
  FinanceManualAccount,
  FinanceManualTransaction,
} from './finance-manual';

export function FinanceApp() {
  const router = useRouter(),
    params = useSearchParams(),
    queryClient = useQueryClient();
  const status = useQuery({
    ...trpc.finance.status.queryOptions(),
    refetchInterval: 15000,
  });
  const viewId =
    params.get('view') ??
    status.data?.views.find(
      (v) => v.definition.title === defaultFinanceViews.Budget.title,
    )?.id ??
    status.data?.views[0]?.id;
  const view = useQuery({
    ...trpc.finance.openView.queryOptions({ id: viewId ?? '' }),
    enabled:
      !!viewId &&
      !!status.data?.settings?.enabled &&
      !!status.data?.settings?.restoreReviewed,
    refetchInterval: 15000,
  });
  const configure = useMutation(trpc.finance.configure.mutationOptions());
  const seed = useMutation(trpc.finance.seedSynthetic.mutationOptions());
  const compose = useMutation({
    ...trpc.finance.composeView.mutationOptions(),
    meta: { carriesInput: true },
  });
  const responses = useRef(new Map<unknown, unknown>()),
    inFlight = useRef(new Set<unknown>());
  const frame = useRef<HTMLIFrameElement>(null),
    frameId = useRef(crypto.randomUUID()),
    scenarioBaseRevision = useRef<number | null>(null),
    bridgeData = useRef(view.data),
    scenarioChanges = useRef<FinanceScenarioChanges>({
      categoryLimits: {},
      goalContributions: {},
      obligationAmounts: {},
    });
  const viewFilters = useRef<{
    startOn?: string;
    endOn?: string;
    accountIds?: string[];
  }>({});
  const [frameNonce, setFrameNonce] = useState(frameId.current);
  const [ready, setReady] = useState(false),
    [height, setHeight] = useState(720),
    [error, setError] = useState(''),
    [question, setQuestion] = useState(''),
    [setup, setSetup] = useState(false),
    [evidence, setEvidence] = useState<FinanceEvidenceRecord | null>(null),
    [inspect, setInspect] = useState<unknown>(null),
    [newName, setNewName] = useState(''),
    [balance, setBalance] = useState(''),
    [kind, setKind] = useState<'cash' | 'credit' | 'mailbox' | 'excluded'>(
      'cash',
    ),
    [csv, setCsv] = useState(''),
    [accountId, setAccountId] = useState(''),
    [csvPreview, setCsvPreview] = useState<unknown>(null);
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.finance.status.queryKey(),
    });
    if (viewId)
      await queryClient.invalidateQueries({
        queryKey: trpc.finance.openView.queryKey({ id: viewId }),
      });
  }, [queryClient, viewId]);
  useEffect(() => {
    const finding = params.get('finding');
    if (
      !finding ||
      !status.data?.settings?.enabled ||
      !status.data.settings.restoreReviewed
    )
      return;
    void trpcClient.finance.finding
      .query({ id: finding })
      .then(async (f) => {
        setInspect(f);
        if (f.evidenceId)
          setEvidence(
            await trpcClient.finance.evidence.query({ id: f.evidenceId }),
          );
      })
      .catch((e) => setError(e.message));
  }, [
    params,
    status.data?.settings?.enabled,
    status.data?.settings?.restoreReviewed,
  ]);
  useEffect(() => {
    bridgeData.current = view.data;
  }, [view.data]);
  useEffect(() => {
    frameId.current = crypto.randomUUID();
    setFrameNonce(frameId.current);
    setReady(false);
    responses.current.clear();
    inFlight.current.clear();
    scenarioBaseRevision.current = null;
    viewFilters.current = {};
    setEvidence(null);
    setInspect(null);
    scenarioChanges.current = {
      categoryLimits: {},
      goalContributions: {},
      obligationAmounts: {},
    };
  }, [viewId]);
  useEffect(() => {
    if (!view.data || !ready) return;
    let cancelled = false;
    const currentId = frameId.current;
    const active =
      scenarioBaseRevision.current !== null ||
      Object.keys(viewFilters.current).length > 0;
    const result =
      active && viewId
        ? trpcClient.finance.openView.query({
            id: viewId,
            expectedRevision: view.data.view.revision,
            changes: scenarioChanges.current,
            filters: viewFilters.current,
          })
        : Promise.resolve(view.data);
    void result
      .then((data) => {
        if (cancelled || currentId !== frameId.current) return;
        bridgeData.current = data;
        frame.current?.contentWindow?.postMessage(
          {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: { structuredContent: data },
            _meta: { frameId: currentId },
          },
          '*',
        );
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [view.data, ready, viewId]);
  useEffect(() => {
    const listener = async (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        event.data?._meta?.frameId !== frameId.current
      )
        return;
      const m = event.data;
      if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return;
      const reply = (result: unknown, errorMessage?: string) => {
        const response = {
          jsonrpc: '2.0',
          id: m.id,
          ...(errorMessage
            ? { error: { code: -32602, message: errorMessage } }
            : { result }),
          _meta: { frameId: frameId.current },
        };
        inFlight.current.delete(m.id);
        responses.current.set(m.id, response);
        if (responses.current.size > 256)
          responses.current.delete(responses.current.keys().next().value);
        frame.current?.contentWindow?.postMessage(response, '*');
      };
      if (m.method === 'ui/initialize') {
        reply({
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'Finances', version: '1' },
          hostCapabilities: { serverTools: {} },
        });
        return;
      }
      if (m.method === 'ui/notifications/initialized') {
        setReady(true);
        return;
      }
      if (m.method === 'ui/notifications/size-changed') {
        if (Number.isFinite(m.params?.height))
          setHeight(Math.max(500, Math.min(12000, m.params.height)));
        return;
      }
      if (m.method !== 'tools/call') {
        reply(null, 'Unsupported finance bridge method');
        return;
      }
      if (!Number.isSafeInteger(m.id) || m.id < 1 || m.id > 1000000000) return;
      if (responses.current.has(m.id)) {
        frame.current?.contentWindow?.postMessage(
          responses.current.get(m.id),
          '*',
        );
        return;
      }
      if (inFlight.current.has(m.id)) return;
      inFlight.current.add(m.id);
      const current = bridgeData.current;
      if (!current || !viewId) {
        reply(null, 'View is unavailable');
        return;
      }
      const args = m.params?.arguments;
      if (
        !args ||
        args.viewId !== viewId ||
        args.viewRevision !== current.view.revision
      ) {
        reply(null, 'View changed. Reload the current revision.');
        return;
      }
      try {
        const name=m.params.name;
        const next=await trpcClient.finance.viewOperation.mutate({name,arguments:args});
        if('inspection' in next){
          if(next.inspection.type==='evidence')setEvidence(next.inspection.record as FinanceEvidenceRecord);
          else setInspect(next.inspection.record);
        }else{
          bridgeData.current=next;
          if(name==='finance_scenario_preview'){scenarioBaseRevision.current=args.budgetRevision??null;scenarioChanges.current=args.changes;}
          if(name==='finance_filter')viewFilters.current=args.filters??{};
          if(['finance_view_apply_scenario','finance_view_undo_budget'].includes(name)){scenarioBaseRevision.current=null;scenarioChanges.current={categoryLimits:{},goalContributions:{},obligationAmounts:{}};}
          if(name==='finance_save_view_filters')viewFilters.current={};
        }
        reply({structuredContent:next,content:[{type:'text',text:'Updated the selected finance view.'}]});
        if(name!=='finance_scenario_preview'&&name!=='finance_inspect')await refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Finance action failed';
        setError(message);
        reply(null, message);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [viewId, refresh]); // Authority is always rechecked by the typed server operations.
  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'This action could not finish',
      );
    }
  }
  async function composeView() {
    if (!view.data || !question.trim()) return;
    await run(async () => {
      const result = await compose.mutateAsync({
        question,
        scope: view.data!.view.scope,
        expectedRevision: 0,
        mutationKey: crypto.randomUUID(),
      });
      setQuestion('');
      router.push(`/finance?view=${result.id}`);
    });
  }
  const fictional=!!status.data?.accounts.length&&status.data.accounts.every(a=>a.provider==='synthetic');
  const enabled = status.data?.settings?.enabled,
    reviewed = status.data?.settings?.restoreReviewed;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-4 sm:gap-3 sm:px-5 backdrop-blur">
        <Link
          href="/"
          aria-label="Finance home"
          className="rounded-md p-2 hover:bg-muted"
        >
          <ArrowLeft size={18} />
        </Link>
        <Wallet size={20} className="text-primary" />
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Finances</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">
            {fictional?'Fictional example. No real accounts connected.':'Budgets, evidence, and the next useful action'}
          </p>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setSetup((v) => !v)}>
          <Settings2 size={14} />
          <span className="hidden sm:inline">Accounts and settings</span>
          <span className="sm:hidden">Settings</span>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{setup && <StandaloneSettings accounts={status.data?.accounts??[]} />}
        {(error || status.error || view.error || compose.error) && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error ||
              status.error?.message ||
              view.error?.message ||
              compose.error?.message}
          </p>
        )}
        {status.isLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading finance...
          </p>
        )}
        {!enabled && !status.isLoading && (
          <section className="mx-auto mt-12 max-w-xl rounded-2xl border border-border bg-muted/20 p-8">
            <Wallet className="mb-5 size-9 text-primary" />
            <h2 className="text-xl font-semibold">
              A clearer picture of your money
            </h2>
            <p className="my-4 text-sm leading-6 text-muted-foreground">
              Plan spending, connect purchases to receipts, and follow up when a
              promised refund is missing. Your records live in this app’s private data folder.
              Relevant evidence can be processed by your selected AI harness.
            </p>
            <Button
              disabled={configure.isPending}
              onClick={() =>
                void run(() => configure.mutateAsync({ enabled: true }))
              }
            >
              Enable finances
            </Button>
            {status.data?.syntheticAllowed && (
              <Button
                className="ml-3"
                variant="outline"
                disabled={seed.isPending}
                onClick={() => void run(() => seed.mutateAsync())}
              >
                Open fictional example
              </Button>
            )}
          </section>
        )}
        {enabled && !reviewed && (
          <section className="rounded-xl border border-border p-6">
            <h2 className="font-medium">Review restored finance data</h2>
            <p className="my-3 text-sm text-muted-foreground">
              This finance data was restored from a backup. It can contain records
              deleted later. Finance access and synchronization stay paused
              until you review this copy.
            </p>
            <Button
              onClick={() =>
                void run(() =>
                  configure.mutateAsync({
                    enabled: true,
                    restoreReviewed: true,
                  }),
                )
              }
            >
              Allow finance on this restored finance data
            </Button>
          </section>
        )}
        {enabled && reviewed && (
          <>
            <nav
              aria-label="Finance views"
              className="mb-5 flex flex-wrap gap-2"
            >
              {Object.keys(defaultFinanceViews).map((name, index) => {
                const saved = status.data?.views.find(
                  (v) =>
                    v.definition.title ===
                    defaultFinanceViews[
                      name as keyof typeof defaultFinanceViews
                    ].title,
                );
                return (
                  <Button
                    key={name}
                    size="sm"
                    variant={saved?.id === viewId ? 'default' : 'outline'}
                    onClick={() => {
                      if (saved) router.push(`/finance?view=${saved.id}`);
                      else if (view.data)
                        void run(async () => {
                          const next = await trpcClient.finance.saveView.mutate(
                            {
                              definition:
                                defaultFinanceViews[
                                  name as keyof typeof defaultFinanceViews
                                ],
                              scope: view.data!.view.scope,
                              expectedRevision: 0,
                              mutationKey: crypto.randomUUID(),
                            },
                          );
                          router.push(`/finance?view=${next.id}`);
                        });
                      else setSetup(true);
                    }}
                  >
                    {name}
                    {index === 0 &&
                    status.data?.budgets[0]?.state === 'proposal'
                      ? ' proposal'
                      : ''}
                  </Button>
                );
              })}
            </nav>
            {status.data?.views.length !== 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor="saved-view"
                >
                  Saved view
                </label>
                <select
                  id="saved-view"
                  className="min-w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={viewId ?? ''}
                  onChange={(e) =>
                    router.push(`/finance?view=${e.target.value}`)
                  }
                >
                  {status.data?.views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.definition.title}
                    </option>
                  ))}
                </select>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={14} />
                  Refresh data
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(async () => {
                      if (!view.data) return;
                      const data = await trpcClient.finance.datasets.query(
                        view.data.view.scope,
                      );
                      await trpcClient.finance.recordExport.mutate({
                        accountIds: view.data.view.scope.accountIds,
                      });
                      const blob = new Blob([JSON.stringify(data, null, 2)], {
                          type: 'application/json',
                        }),
                        url = URL.createObjectURL(blob),
                        a = document.createElement('a');
                      a.href = url;
                      a.download = 'finance-export.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  <Download size={14} />
                  Export this view
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(async () => {
                      if (!view.data) return;
                      const s = {
                          ...view.data.view.scope,
                          ...view.data.view.scope.filters,
                        },
                        result =
                          await trpcClient.finance.exportTransactions.mutate({
                            accountIds: s.accountIds,
                            startOn: s.startOn,
                            endOn: s.endOn,
                          });
                      const blob = new Blob([result.csv], {
                          type: 'text/csv;charset=utf-8',
                        }),
                        url = URL.createObjectURL(blob),
                        link = document.createElement('a');
                      link.href = url;
                      link.download = 'finance-transactions.csv';
                      link.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  Export transactions CSV
                </Button>
              </div>
            )}
            {view.data && !view.error ? (
              <div className="overflow-hidden rounded-xl border border-border bg-[#121713]">
                <iframe
                  key={frameNonce}
                  ref={frame}
                  title="Interactive personal finance view"
                  sandbox="allow-scripts"
                  allow=""
                  referrerPolicy="no-referrer"
                  src={`/api/finance/renderer#frame=${frameNonce}&origin=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '')}`}
                  className="block w-full border-0"
                  style={{ height }}
                />
              </div>
            ) : view.isLoading ? (
              <p role="status">Loading the selected view...</p>
            ) : (
              <section className="rounded-xl border border-dashed border-border p-8 text-center">
                <h2 className="font-medium">Start with your accounts</h2>
                <p className="my-3 text-sm text-muted-foreground">
                  Add a manual account or connect a source, then propose a
                  budget. In development you can explore the complete workflow
                  with fictional records.
                </p>
                <Button variant="outline" onClick={() => setSetup(true)}>
                  Set up accounts
                </Button>
                {status.data?.syntheticAllowed && (
                  <Button
                    className="ml-3"
                    disabled={seed.isPending}
                    onClick={() => void run(() => seed.mutateAsync())}
                  >
                    Open fictional example
                  </Button>
                )}
              </section>
            )}
            <FinanceBudgetEditor
              accounts={status.data?.accounts ?? []}
              budget={view.data?.data.budgetRecord ?? null}
              onDone={async (id) => {
                await refresh();
                if (id) router.push(`/finance?view=${id}`);
              }}
            />
            {viewId && <FinanceChat key={viewId} viewId={viewId} />}
            {view.data && (
              <section className="mt-5 rounded-xl border border-border bg-muted/15 p-4">
                <label
                  htmlFor="finance-question"
                  className="mb-2 flex items-center gap-2 text-sm font-medium"
                >
                  <MessageCircleMore size={16} />
                  Build a view around your question
                </label>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void composeView();
                  }}
                >
                  <Input
                    id="finance-question"
                    placeholder="Show dining and subscriptions over the last six months"
                    value={question}
                    maxLength={2000}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={compose.isPending || !question.trim()}
                  >
                    {compose.isPending ? 'Composing...' : 'Create view'}
                  </Button>
                </form>
                <p className="mt-2 text-xs text-muted-foreground">
                  The agent chooses the layout. The finance server calculates the
                  financial values. Your current view stays available if
                  generation fails.
                </p>
              </section>
            )}
          </>
        )}
        {setup && enabled && (
          <section className="mt-6 space-y-5 rounded-xl border border-border p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Accounts and settings</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close account settings"
                onClick={() => setSetup(false)}
              >
                <X size={16} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Confirm U.S. personal accounts and USD before connecting real
              sources. Real bank and mailbox setup is independently authorized
              through Connectors. CSV and manual records remain available for
              coverage gaps.
            </p>
            <FinanceSourceSetup
              accounts={status.data?.accounts ?? []}
              onDone={refresh}
            />
            <div className="space-y-2">
              {status.data?.accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/25 p-3"
                >
                  <div className="min-w-32 flex-1">
                    <p className="text-sm">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.provider} • {a.access} •{' '}
                      {a.asOf
                        ? new Date(a.asOf).toLocaleString()
                        : 'No sync yet'}
                    </p>
                  </div>
                  <span className="text-sm">
                    {a.balanceMinor !== null
                      ? formatMoney(a.balanceMinor, a.currency)
                      : 'Balance unknown'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(() =>
                        trpcClient.finance.disconnect.mutate({
                          id: a.id,
                          retain: true,
                        }),
                      )
                    }
                  >
                    Disconnect, retain history
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Delete live finance data for this account? Finance backups retain recoverable copies under normal retention. Previously shared text and exports are separate copies.',
                        )
                      )
                        void run(() =>
                          trpcClient.finance.deleteLive.mutate({
                            accountIds: [a.id],
                            acknowledgeRetainedCopies: true,
                          }),
                        );
                    }}
                  >
                    Delete live data
                  </Button>
                  {a.kind === 'credit' && a.access === 'connected' && (
                    <FinanceCardEditor
                      key={a.id + ':' + a.updatedAt}
                      account={a}
                      onDone={refresh}
                    />
                  )}
                  {['manual', 'synthetic'].includes(a.provider) &&
                    !['mailbox', 'excluded'].includes(a.kind) && (
                      <FinanceManualAccount
                        key={a.id + ':' + a.updatedAt}
                        account={a}
                        onSaved={refresh}
                      />
                    )}
                </div>
              ))}
            </div>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await trpcClient.finance.createAccount.mutate({
                    name: newName,
                    kind,
                    provider: 'manual',
                    currency: 'USD',
                    connectionId: null,
                    sourceId: crypto.randomUUID(),
                    balanceMinor: balance ? parseMoney(balance, 'USD') : null,
                    balanceIncludesPending: false,
                    historyStart: null,
                    asOf: new Date().toISOString(),
                  });
                  setAccountId(result.id);
                  setNewName('');
                  setBalance('');
                });
              }}
            >
              <Input
                aria-label="Account name"
                placeholder="Account name"
                className="w-48"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <select
                aria-label="Account type"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="cash">Cash account</option>
                <option value="credit">Credit card</option>
                <option value="mailbox">Receipt mailbox</option>
                <option value="excluded">Excluded account</option>
              </select>
              <Input
                aria-label="Current balance"
                placeholder="Current balance in USD"
                className="w-48"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
              <Button type="submit">
                <Plus size={14} />
                Add manual account
              </Button>
            </form>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Import transactions</h3>
              <FinanceManualTransaction
                accounts={status.data?.accounts ?? []}
                onSaved={refresh}
              />
              <p className="text-xs text-muted-foreground">
                CSV columns: date, merchant, amount, category. Dates use
                YYYY-MM-DD. Positive amounts mean spending, negative amounts
                mean credits. Repeated imports keep source identifiers.
              </p>
              <select
                aria-label="CSV account"
                className="rounded-md border border-border bg-background p-2 text-sm"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setCsvPreview(null);
                }}
              >
                <option value="">Select account</option>
                {status.data?.accounts
                  .filter(
                    (a) => a.access === 'connected' && a.kind !== 'mailbox',
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <textarea
                aria-label="CSV transactions"
                className="block h-28 w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
                placeholder={
                  'date,merchant,amount,category\n2026-10-06,Cafe,12.34,dining'
                }
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setCsvPreview(null);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!accountId || !csv}
                onClick={() =>
                  void run(async () =>
                    setCsvPreview(
                      await trpcClient.finance.importCsv.mutate({
                        accountId,
                        currency: 'USD',
                        text: csv,
                        positiveMeansSpending: true,
                        preview: true,
                      }),
                    ),
                  )
                }
              >
                Preview import
              </Button>
              <Button
                className="ml-2"
                size="sm"
                disabled={!csvPreview}
                onClick={() =>
                  void run(async () => {
                    await trpcClient.finance.importCsv.mutate({
                      accountId,
                      currency: 'USD',
                      text: csv,
                      positiveMeansSpending: true,
                      preview: false,
                    });
                    setCsv('');
                    setCsvPreview(null);
                  })
                }
              >
                Import previewed records
              </Button>
              {csvPreview !== null && (
                <pre className="max-h-40 overflow-auto rounded bg-muted/30 p-3 text-xs">
                  {JSON.stringify(csvPreview, null, 2)}
                </pre>
              )}
            </div>
            <label className="block text-sm">
              Overspending alert threshold (USD)
              <Input
                className="mt-1 w-40"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  (status.data?.settings?.thresholds.overspendMinor ?? 2500) /
                  100
                }
                onBlur={(e) =>
                  void run(() =>
                    configure.mutateAsync({
                      enabled: true,
                      thresholds: {
                        overspendMinor: parseMoney(
                          e.target.value || '0',
                          'USD',
                        ),
                        priceChangePercent:
                          status.data?.settings?.thresholds
                            .priceChangePercent ?? 10,
                      },
                    }),
                  )
                }
              />
            </label>
            <label className="block text-sm">
              Price increase alert (%)
              <Input
                className="mt-1 w-40"
                type="number"
                min="0"
                max="1000"
                defaultValue={
                  status.data?.settings?.thresholds.priceChangePercent ?? 10
                }
                onBlur={(e) =>
                  void run(() =>
                    configure.mutateAsync({
                      enabled: true,
                      thresholds: {
                        overspendMinor:
                          status.data?.settings?.thresholds.overspendMinor ??
                          2500,
                        priceChangePercent: Number(e.target.value),
                      },
                    }),
                  )
                }
              />
            </label>
            <div className="flex gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void run(() => configure.mutateAsync({ enabled: false }))
                }
              >
                Disable finance
              </Button>
              <span className="text-xs text-muted-foreground">
                Disabling stops jobs and retains history.
              </span>
            </div>
          </section>
        )}
        {enabled && reviewed && setup && (
          <FinanceManualEvidence
            accounts={status.data?.accounts ?? []}
            onSaved={async (e) => {
              setEvidence(e);
              await refresh();
            }}
          />
        )}
        {enabled && reviewed && (evidence !== null || inspect !== null) && (
          <aside
            aria-label="Protected finance evidence"
            className="mt-5 rounded-xl border border-primary/25 bg-muted/20 p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <FileText size={17} />
              <h2 className="flex-1 font-medium">Protected source evidence</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close evidence"
                onClick={() => {
                  setEvidence(null);
                  setInspect(null);
                }}
              >
                <X size={16} />
              </Button>
            </div>
            {evidence && (
              <>
                <p className="text-sm font-medium">
                  {evidence.data.merchant} • {evidence.data.occurredOn}
                </p>
                <p className="my-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {evidence.data.excerpt}
                </p>
                <p className="text-xs text-muted-foreground">
                  {evidence.data.provenance.source} • Confidence{' '}
                  {Math.round(evidence.data.confidence * 100)}% • Extraction{' '}
                  {evidence.data.provenance.extractorVersion}
                </p>
                <FinanceEvidenceEditor
                  key={evidence.id + ':' + evidence.revision}
                  evidence={evidence}
                  transactions={view.data?.data.transactions ?? []}
                  onSaved={async (result) => {
                    setEvidence(result);
                    if (view.data)
                      await trpcClient.finance.reconcile.mutate(
                        view.data.view.scope,
                      );
                    await refresh();
                  }}
                />
              </>
            )}
            {inspect !== null &&
              typeof inspect === 'object' &&
              'kind' in inspect &&
              'id' in inspect &&
              'key' in inspect && (
                <Button
                  className="my-3"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run(() =>
                      trpcClient.finance.followup.mutate({
                        findingId: String(inspect.id),
                      }),
                    )
                  }
                >
                  Prepare Ri follow-up
                </Button>
              )}
            {inspect !== null && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(inspect, null, 2)}
              </pre>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
