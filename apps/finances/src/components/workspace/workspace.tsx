import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  FileUp,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import type { FinanceScenarioChanges } from "@/lib/finance/contracts";
import type {
  Account,
  Activity,
  FinanceClient,
  Home,
  Overview,
  Section,
} from "./types";
import {
  AccountDialog,
  ConnectionsDialog,
  EntryDialog,
  ImportDialog,
} from "./forms";
import { BudgetPanel } from "./budget";
import { TransactionDialog, TransactionRows } from "./transactions";
import {
  AskButton,
  dateLabel,
  Empty,
  ErrorMessage,
  label,
  money,
  monthScope,
  useOperation,
} from "./ui";

const sections = [
  ["overview", "Overview", LayoutDashboard],
  ["transactions", "Transactions", ListFilter],
  ["budget", "Budget", Wallet],
  ["accounts", "Accounts", CreditCard],
] as const;
const palette = [
  "var(--category-1)",
  "var(--category-2)",
  "var(--category-3)",
  "var(--category-4)",
  "var(--category-5)",
  "var(--category-6)",
];
export function Workspace({
  home: incoming,
  client,
}: {
  home: Home;
  client: FinanceClient;
}) {
  const [home, setHome] = useState(incoming),
    [previous, setPrevious] = useState(incoming);
  if (previous !== incoming) {
    setPrevious(incoming);
    setHome(incoming);
  }
  const [section, setSection] = useState<Section>("overview"),
    [month, setMonth] = useState(
      new Date().toLocaleDateString("en-CA").slice(0, 7),
    ),
    [accountId, setAccountId] = useState(""),
    [currencyChoice, setCurrency] = useState(
      home.settings?.currency ?? home.accounts[0]?.currency ?? "USD",
    );
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [category, setCategory] = useState(""),
    [state, setState] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [inspecting, setInspecting] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<
      "account" | "import" | "entry" | "connections" | null
    >(null),
    [editAccount, setEditAccount] = useState<Account | undefined>(),
    [importAccount, setImportAccount] = useState<string | undefined>();
  const [result, setResult] = useState<{
      key: string;
      overview: Overview;
      activity: Activity;
    } | null>(null),
    [loadError, setLoadError] = useState(""),
    [more, setMore] = useState(false);
  const [budgetContext, setBudgetContext] = useState<{
    budgetId?: string;
    budgetRevision?: number;
    changes?: FinanceScenarioChanges;
  }>({});
  const budgetChanged = useCallback(
    (value: typeof budgetContext) => setBudgetContext(value),
    [],
  );
  const { busy, error, run } = useOperation();
  const accounts = home.accounts.filter((a) => a.access !== "revoked");
  const currency = accounts.some((a) => a.currency === currencyChoice)
    ? currencyChoice
    : (accounts[0]?.currency ?? currencyChoice);
  const accountIds = accounts
    .filter((a) => !accountId || a.id === accountId)
    .map((a) => a.id);
  const scope = { accountIds, ...monthScope(month) };
  const filters = {
    ...scope,
    currency,
    ...(debounced ? { search: debounced } : {}),
    ...(category ? { category } : {}),
    ...(state ? { state: state as "posted" | "pending" } : {}),
  };
  const scopeKey = JSON.stringify(scope),
    filterKey = JSON.stringify(filters),
    key = scopeKey + filterKey + revision;
  const active = result?.key === key ? result : null;
  const summary = active?.overview.summaries.find(
    (s) => s.currency === currency,
  );
  const currentCurrency = home.accounts.some((a) => a.currency === currency)
    ? currency
    : home.accounts[0]?.currency;
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!accountIds.length || home.accessSetup || home.inspection) return;
    let live = true;
    void Promise.all([
      client.call<Overview>("finance_overview", JSON.parse(scopeKey)),
      client.call<Activity>("finance_activity", {
        ...JSON.parse(filterKey),
        limit: 50,
      }),
    ])
      .then(([overview, activity]) => {
        if (live) {
          setResult({ key, overview, activity });
          setLoadError("");
        }
      })
      .catch((e) => {
        if (live) setLoadError(e.message);
      });
    return () => {
      live = false;
    };
  }, [client, key, scopeKey, filterKey, home, accountIds.length]);
  useEffect(() => {
    if (home.accessSetup) return;
    const state = home.inspection
      ? {
          selected: [
            { type: home.inspection.type, id: home.inspection.record.id },
          ],
        }
      : {
          selected: selected.map((id) => ({ type: "transaction", id })),
          section,
          ...(accountIds.length
            ? { filters: JSON.parse(scopeKey), activity: JSON.parse(filterKey) }
            : {}),
          ...(section === "budget" ? budgetContext : {}),
        };
    // Only filter fields are shared, never arbitrary UI text or account credentials.
    if ("activity" in state && state.activity) {
      delete state.activity.accountIds;
      delete state.activity.startOn;
      delete state.activity.endOn;
    }
    void client.context(state).catch((e) => setLoadError(e.message));
  }, [
    client,
    home,
    scopeKey,
    filterKey,
    section,
    selected,
    budgetContext,
    accountIds.length,
  ]);
  const reload = async () => {
    setHome(await client.call<Home>("finance_home"));
    setRevision((v) => v + 1);
  };
  const resetSelection = () => {
    setSelected([]);
    setInspecting(null);
  };
  const go = (value: Section) => {
    setSection(value);
    resetSelection();
    if (value === "overview") {
      setCategory("");
      setSearch("");
      setDebounced("");
      setState("");
    }
  };
  const shiftMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(
      new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7),
    );
    resetSelection();
  };
  const selectRecord = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids.slice(-9), id],
    );
  const openRecord = (id: string) => {
    setSelected([id]);
    setInspecting(id);
  };
  const categoryClick = (value: string) => {
    setCategory(value);
    setSearch("");
    setDebounced("");
    setState("");
    go("transactions");
  };
  const chooseImport = (id?: string) => {
    setImportAccount(id);
    setDialog("import");
  };
  const addAccount = () => {
    setEditAccount(undefined);
    setDialog("account");
  };
  const canRecord =
    home.owner &&
    accounts.some((a) => a.provider === "manual" && a.access === "connected");
  if (home.accessSetup) return <AccessSetup home={home} client={client} />;
  if (home.inspection) return <Inspection home={home} client={client} />;
  return (
    <div className="finance-shell">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">
            <span className="brand-dot" />
            FINANCES
          </span>
          <h1>Your money, in view.</h1>
          <p>A little clarity for the decisions ahead.</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="Refresh finances"
            disabled={busy}
            onClick={() => void run(reload)}
          >
            <RefreshCw size={17} className={busy ? "spinning" : ""} />
          </button>
          {home.owner && (
            <button className="button" onClick={addAccount}>
              <Plus size={16} />
              Add account
            </button>
          )}
        </div>
      </header>
      <nav className="workspace-nav" aria-label="Finances sections">
        {sections.map(([id, title, Icon]) => (
          <button
            key={id}
            aria-current={section === id ? "page" : undefined}
            className={section === id ? "active" : ""}
            onClick={() => go(id)}
          >
            <Icon size={17} />
            {title}
          </button>
        ))}
      </nav>
      <main className="workspace-content">
        <ErrorMessage message={error || loadError} />
        {home.owner &&
          home.settings &&
          (!home.settings.enabled || !home.settings.restoreReviewed) && (
            <div className="notice">
              <ShieldCheck size={18} />
              <span>
                {!home.settings.restoreReviewed
                  ? "Review your restored data before enabling access. Previous account permissions are not automatically restored."
                  : "Finances is paused. Enable it to use your saved accounts and records."}
              </span>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await client.call("finance_setup", {
                      enabled: true,
                      currency: home.settings!.currency,
                      timezone: home.settings!.timezone,
                      restoreReviewed: true,
                    });
                    await reload();
                  })
                }
              >
                {home.settings.restoreReviewed
                  ? "Enable Finances"
                  : "Enable restored data"}
              </button>
            </div>
          )}
        {!accounts.length ? (
          <div className="welcome">
            <div className="welcome-mark">
              <Wallet size={32} />
            </div>
            <span className="eyebrow">START WITH WHAT YOU HAVE</span>
            <h2>
              Make room for a clearer
              <br />
              financial picture.
            </h2>
            <p>
              Bring your accounts and transactions together. Understand your
              spending, build a plan, and talk through your next move with Ri.
            </p>
            {home.owner ? (
              <div className="welcome-actions">
                <button className="button primary" onClick={addAccount}>
                  <Plus size={17} />
                  Add your first account
                </button>
                <button
                  className="text-button"
                  onClick={() => setDialog("connections")}
                >
                  Connect receipt sources
                  <ArrowUpRight size={15} />
                </button>
              </div>
            ) : (
              <p className="notice">
                This chat has no permitted accounts. Choose account access in Ri
                to continue.
              </p>
            )}
            <div className="welcome-features">
              <div>
                <Wallet size={20} />
                <strong>Your own records</strong>
                <span>Manual accounts and CSV imports</span>
              </div>
              <div>
                <MessageCircle size={20} />
                <strong>Work it out together</strong>
                <span>Ask Ri about what you see</span>
              </div>
              <div>
                <LockKeyhole size={20} />
                <strong>Access you choose</strong>
                <span>Control which accounts a chat can use</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {(section === "overview" || section === "transactions") && (
              <div className="filter-toolbar">
                <div className="month-control">
                  <button
                    className="icon-button"
                    aria-label="Previous month"
                    onClick={() => shiftMonth(-1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <input
                    aria-label="Month"
                    type="month"
                    value={month}
                    onChange={(e) => {
                      if (e.target.value) {
                        setMonth(e.target.value);
                        resetSelection();
                      }
                    }}
                  />
                  <button
                    className="icon-button"
                    aria-label="Next month"
                    onClick={() => shiftMonth(1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
                <div className="scope-filters">
                  <select
                    aria-label="Account filter"
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value);
                      resetSelection();
                    }}
                  >
                    <option value="">All accounts</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Currency filter"
                    value={currentCurrency ?? currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      resetSelection();
                    }}
                  >
                    {[
                      ...new Set([
                        currency,
                        ...accounts.map((a) => a.currency),
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {section === "overview" && (
              <>
                {!active ? (
                  <p className="loading" role="status">
                    Gathering your financial picture…
                  </p>
                ) : (
                  <>
                    <section className="card cashflow-card">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">
                            THIS MONTH, AT A GLANCE
                          </span>
                          <h2>Money in. Money out.</h2>
                        </div>
                        <span className="pill">
                          {summary?.transactionCount ?? 0} recorded transactions
                        </span>
                      </div>
                      <div className="metrics">
                        <div>
                          <span>
                            <ArrowDownLeft size={15} />
                            Income
                          </span>
                          <strong>
                            {money(summary?.incomeMinor ?? 0, currency)}
                          </strong>
                          <small>Posted income</small>
                        </div>
                        <div>
                          <span>
                            <ArrowUpRight size={15} />
                            Spending
                          </span>
                          <strong>
                            {money(summary?.spendingMinor ?? 0, currency)}
                          </strong>
                          <small>
                            {money(summary?.pendingMinor ?? 0, currency)}{" "}
                            pending, kept separate
                          </small>
                        </div>
                        <div>
                          <span>Net cash flow</span>
                          <strong
                            className={
                              (summary?.netMinor ?? 0) >= 0
                                ? "positive"
                                : "negative"
                            }
                          >
                            {money(summary?.netMinor ?? 0, currency)}
                          </strong>
                          <small>Income less spending</small>
                        </div>
                      </div>
                      <CashFlow summary={summary} month={month} />
                      <div className="card-footer">
                        <span className="hint">
                          Refunds reduce spending. Transfers and card payments
                          are excluded.
                        </span>
                        <AskButton
                          client={client}
                          prompt="Review my financial overview for the selected month and accounts. Explain what stands out and any gaps in coverage."
                        >
                          Talk through this month
                        </AskButton>
                      </div>
                    </section>
                    <div className="two-column">
                      <section className="card">
                        <div className="card-heading">
                          <div>
                            <h3>Where it went</h3>
                            <p>Net posted spending by category</p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => go("transactions")}
                          >
                            View all
                            <ArrowRight size={14} />
                          </button>
                        </div>
                        {summary?.categories.length ? (
                          <div className="category-breakdown">
                            <div className="category-strip" aria-hidden>
                              {summary.categories
                                .filter((c) => c.amountMinor > 0)
                                .map((c, i) => (
                                  <span
                                    key={c.category}
                                    style={{
                                      flex: c.amountMinor,
                                      background: palette[i % palette.length],
                                    }}
                                  />
                                ))}
                            </div>
                            {summary.categories.slice(0, 7).map((c, i) => (
                              <button
                                className="category-row"
                                key={c.category}
                                onClick={() => categoryClick(c.category)}
                              >
                                <span
                                  className="legend-dot"
                                  style={{
                                    background: palette[i % palette.length],
                                  }}
                                />
                                <span>{label(c.category)}</span>
                                <strong>
                                  {money(c.amountMinor, currency)}
                                </strong>
                                <ChevronRight size={15} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <Empty title="Your spending story starts here">
                            Add or import transactions to see where your money
                            goes.
                          </Empty>
                        )}
                      </section>
                      <section className="card">
                        <div className="card-heading">
                          <div>
                            <h3>Account snapshots</h3>
                            <p>Latest recorded balances</p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => go("accounts")}
                          >
                            Manage
                            <ArrowRight size={14} />
                          </button>
                        </div>
                        <div className="snapshot-total">
                          <span>Cash & savings</span>
                          <strong>{money(summary?.cashMinor, currency)}</strong>
                        </div>
                        {summary?.creditMinor !== null &&
                          summary?.creditMinor !== undefined && (
                            <div className="snapshot-total secondary">
                              <span>Credit card balances</span>
                              <strong>
                                {money(summary.creditMinor, currency)}
                              </strong>
                            </div>
                          )}
                        <div className="snapshot-accounts">
                          {accounts
                            .filter(
                              (a) =>
                                a.currency === currency &&
                                ["cash", "credit"].includes(a.kind),
                            )
                            .slice(0, 4)
                            .map((a) => (
                              <div className="simple-row" key={a.id}>
                                <span>
                                  <strong>{a.name}</strong>
                                  <small>
                                    {a.provider === "manual"
                                      ? "Manual snapshot"
                                      : "Updated"}{" "}
                                    · {dateLabel(a.asOf)}
                                  </small>
                                </span>
                                <span>{money(a.balanceMinor, a.currency)}</span>
                              </div>
                            ))}
                        </div>
                        <p className="card-note">
                          Balances are snapshots, not a net worth estimate.
                          {!!summary?.unknownBalances &&
                            " Some balances have not been added."}
                        </p>
                      </section>
                    </div>
                    {active.overview.coverage.some(
                      (c) => c.incomplete || c.stale || c.manual,
                    ) && (
                      <div className="coverage-note">
                        <CircleCoverage />
                        <p>
                          <strong>A picture of the records you have.</strong>{" "}
                          {active.overview.coverage.some((c) => c.incomplete)
                            ? "Some accounts have incomplete history. "
                            : ""}
                          {active.overview.coverage.some((c) => c.stale)
                            ? "Some balances need updating. "
                            : ""}
                          Manual accounts reflect what you enter or import.
                          Currencies are shown separately.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => go("accounts")}
                        >
                          Review accounts
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                    <div className="two-column activity-grid">
                      <section className="card">
                        <div className="card-heading">
                          <div>
                            <h3>Recent activity</h3>
                            <p>Your latest recorded transactions</p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => {
                              setCategory("");
                              setSearch("");
                              setState("");
                              go("transactions");
                            }}
                          >
                            See all
                            <ArrowRight size={14} />
                          </button>
                        </div>
                        <TransactionRows
                          rows={active.activity.rows.slice(0, 6)}
                          accounts={accounts}
                          selected={selected}
                          onSelect={selectRecord}
                          onOpen={openRecord}
                          compact
                        />
                      </section>
                      <section className="card">
                        <div className="card-heading">
                          <h3>Worth a look</h3>
                          <span className="pill">
                            {active.overview.findings.length}
                          </span>
                        </div>
                        {active.overview.findings.length ? (
                          active.overview.findings.slice(0, 4).map((f) => (
                            <button
                              className="finding"
                              key={f.id}
                              onClick={() =>
                                void run(async () => {
                                  await client.navigate(
                                    "/records/finding/" + f.id,
                                  );
                                })
                              }
                            >
                              <span className="finding-dot" />
                              <span>
                                <strong>{label(f.kind)}</strong>
                                <p>{f.message}</p>
                                {f.dueOn && (
                                  <small>Review by {dateLabel(f.dueOn)}</small>
                                )}
                              </span>
                              <ArrowUpRight size={15} />
                            </button>
                          ))
                        ) : (
                          <Empty
                            icon={<Check size={22} />}
                            title="No open findings"
                          >
                            Recorded checks have no open items. Unconnected
                            accounts and missing records are not covered.
                          </Empty>
                        )}
                      </section>
                    </div>
                    <SavedViews home={home} client={client} />
                  </>
                )}
              </>
            )}
            {section === "transactions" && (
              <>
                <div className="section-heading">
                  <div>
                    <h2>Every transaction, in context.</h2>
                    <p className="muted">
                      {active
                        ? active.activity.total + " matching records"
                        : "Search and review your recorded activity"}
                    </p>
                  </div>
                  {canRecord && (
                    <div className="inline-actions">
                      <button className="button" onClick={() => chooseImport()}>
                        <FileUp size={15} />
                        Import
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setDialog("entry")}
                      >
                        <Plus size={15} />
                        Add transaction
                      </button>
                    </div>
                  )}
                </div>
                <div className="transaction-filters">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Search merchants"
                      placeholder="Search merchants…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        resetSelection();
                      }}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => {
                          setSearch("");
                          resetSelection();
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <select
                    aria-label="Category filter"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      resetSelection();
                    }}
                  >
                    <option value="">All categories</option>
                    {[
                      ...new Set([
                        ...(category ? [category] : []),
                        ...(summary?.categories.map((c) => c.category) ?? []),
                      ]),
                    ]
                      .sort()
                      .map((c) => (
                        <option key={c} value={c}>
                          {label(c)}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="Transaction status"
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value);
                      resetSelection();
                    }}
                  >
                    <option value="">Posted & pending</option>
                    <option value="posted">Posted</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                {selected.length > 0 && (
                  <div className="selection-bar">
                    <span>{selected.length} selected</span>
                    <AskButton
                      client={client}
                      prompt="Review the selected transactions. Explain them together and identify anything I should look into."
                    >
                      Ask about selection
                    </AskButton>
                    <button className="text-button" onClick={resetSelection}>
                      Clear
                    </button>
                  </div>
                )}
                <section className="card">
                  {active ? (
                    <TransactionRows
                      rows={active.activity.rows}
                      accounts={accounts}
                      selected={selected}
                      onSelect={selectRecord}
                      onOpen={openRecord}
                    />
                  ) : (
                    <p className="loading" role="status">
                      Loading transactions…
                    </p>
                  )}
                  {active && (
                    <div className="card-footer">
                      <span className="hint">
                        Showing {active.activity.rows.length} of{" "}
                        {active.activity.total}
                      </span>
                      <div className="inline-actions">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const output = await client.call<{
                                text: string;
                                count: number;
                              }>("finance_export_activity", filters);
                              await client.download(
                                output.text,
                                "finances-" + month + ".csv",
                                "text/csv",
                              );
                            })
                          }
                        >
                          <Download size={14} />
                          Export filtered CSV
                        </button>
                        {home.owner && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await client.call(
                                  "finance_create_default_view",
                                  {
                                    name: "Activity",
                                    ...scope,
                                    budgetId: null,
                                    mutationKey: crypto.randomUUID(),
                                  },
                                );
                                await reload();
                              })
                            }
                          >
                            Save month view
                          </button>
                        )}
                      </div>
                      {active.activity.next && (
                        <button
                          className="button"
                          disabled={more}
                          onClick={() => {
                            setMore(true);
                            void client
                              .call<Activity>("finance_activity", {
                                ...filters,
                                after: active.activity.next,
                                limit: 50,
                              })
                              .then((page) =>
                                setResult((current) =>
                                  current?.key === key
                                    ? {
                                        ...current,
                                        activity: {
                                          ...page,
                                          rows: [
                                            ...current.activity.rows,
                                            ...page.rows,
                                          ],
                                        },
                                      }
                                    : current,
                                ),
                              )
                              .catch((e) => setLoadError(e.message))
                              .finally(() => setMore(false));
                          }}
                        >
                          {more ? "Loading…" : "Load more"}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
            {section === "budget" && (
              <BudgetPanel
                home={home}
                client={client}
                revision={revision}
                onChanged={reload}
                onContext={budgetChanged}
              />
            )}
            {section === "accounts" && (
              <>
                <div className="section-heading">
                  <div>
                    <h2>Your accounts & sources</h2>
                    <p className="muted">
                      See what is connected, what is manual and what needs
                      updating.
                    </p>
                  </div>
                  {home.owner && (
                    <button
                      className="button"
                      onClick={() => setDialog("connections")}
                    >
                      <Mail size={16} />
                      Connect receipts
                    </button>
                  )}
                </div>
                <section className="card account-list">
                  {accounts.map((a) => (
                    <div className="account-row" key={a.id}>
                      <span className="account-icon">
                        {a.kind === "mailbox" ? (
                          <Mail size={20} />
                        ) : a.kind === "credit" ? (
                          <CreditCard size={20} />
                        ) : (
                          <Wallet size={20} />
                        )}
                      </span>
                      <div className="account-description">
                        <h3>{a.name}</h3>
                        <p>
                          {a.provider === "manual"
                            ? "Manual account"
                            : a.provider === "synthetic"
                              ? "Synthetic fixture"
                              : label(a.provider)}
                          {a.mask ? " · " + a.mask : ""}
                        </p>
                        <span
                          className={
                            "pill " +
                            (a.syncStatus === "reconnect" ||
                            a.syncStatus === "error"
                              ? "warn"
                              : "")
                          }
                        >
                          {a.access === "retained"
                            ? "Retained history"
                            : a.provider === "manual"
                              ? "Updated by you"
                              : a.syncStatus === "idle"
                                ? "Connected"
                                : label(a.syncStatus)}
                        </span>
                        <small>
                          {a.asOf
                            ? "Last updated " + dateLabel(a.asOf, true)
                            : "No balance snapshot yet"}
                          {a.historyStart
                            ? " · History from " +
                              dateLabel(a.historyStart, true)
                            : ""}
                        </small>
                      </div>
                      <div className="account-value">
                        {a.kind !== "mailbox" && (
                          <>
                            <strong>{money(a.balanceMinor, a.currency)}</strong>
                            <small>
                              {a.kind === "credit" ? "Amount owed" : a.currency}
                            </small>
                          </>
                        )}
                        {home.owner && (
                          <div className="account-actions">
                            {a.provider === "manual" ? (
                              <>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    setEditAccount(a);
                                    setDialog("account");
                                  }}
                                >
                                  Update balance
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() => chooseImport(a.id)}
                                >
                                  Import CSV
                                </button>
                              </>
                            ) : ["google", "microsoft", "plaid"].includes(
                                a.provider,
                              ) && a.access === "connected" ? (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await client.call("finance_queue_sync", {
                                      id: a.id,
                                    });
                                    await reload();
                                  })
                                }
                              >
                                <RefreshCw size={13} />
                                Refresh source
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
                {home.owner && (
                  <div className="accounts-bottom">
                    <button className="button" onClick={addAccount}>
                      <Plus size={16} />
                      Add a manual account
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(async () => {
                          await client.navigate("/__host/manage-access");
                        })
                      }
                    >
                      <LockKeyhole size={15} />
                      Manage app access in Ri
                    </button>
                  </div>
                )}
                <SavedViews home={home} client={client} />
                {home.owner && <ScopeManager client={client} />}
              </>
            )}
          </>
        )}
      </main>
      <footer className="conversation-dock">
        <MessageCircle size={20} />
        <button
          onClick={() =>
            void run(async () => {
              await client.navigate("/__host/chat");
            })
          }
        >
          <strong>Ask about your finances</strong>
          <span>
            Make sense of what you see, or work through what comes next.
          </span>
        </button>
        <button
          className="dock-arrow"
          aria-label="Open Finances chat"
          onClick={() =>
            void run(async () => {
              await client.navigate("/__host/chat");
            })
          }
        >
          <ArrowUpRight size={19} />
        </button>
      </footer>
      {dialog === "account" && (
        <AccountDialog
          key={editAccount?.id ?? "new"}
          home={home}
          account={editAccount}
          client={client}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      {dialog === "entry" && (
        <EntryDialog
          accounts={accounts}
          client={client}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          accounts={accounts}
          initialAccountId={importAccount}
          client={client}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      {dialog === "connections" && (
        <ConnectionsDialog
          home={home}
          client={client}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      {inspecting && (
        <TransactionDialog
          id={inspecting}
          accounts={accounts}
          client={client}
          owner={home.owner}
          onClose={() => setInspecting(null)}
          onChanged={async () => {
            resetSelection();
            await reload();
          }}
        />
      )}
    </div>
  );
}
function CircleCoverage() {
  return <ShieldCheck size={20} aria-hidden />;
}
function CashFlow({
  summary,
  month,
}: {
  summary: Overview["summaries"][number] | undefined;
  month: string;
}) {
  const [y, m] = month.split("-").map(Number),
    count = new Date(y, m, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => {
    const date = month + "-" + String(i + 1).padStart(2, "0");
    const row = summary?.daily.find((d) => d.date === date);
    return {
      date,
      incomeMinor: row?.incomeMinor ?? 0,
      spendingMinor: row?.spendingMinor ?? 0,
    };
  });
  const max = Math.max(
    1,
    ...days.flatMap((d) => [
      Math.abs(d.incomeMinor),
      Math.abs(d.spendingMinor),
    ]),
  );
  return (
    <div className="cashflow-chart">
      <div className="chart-legend">
        <span>
          <i className="income" />
          Income
        </span>
        <span>
          <i className="spend" />
          Spending
        </span>
      </div>
      <div
        className="bar-chart"
        role="img"
        aria-label="Daily income and spending. Exact values are in the expandable daily totals below."
      >
        {days.map((d) => (
          <div className="day-bars" key={d.date}>
            <span
              className="income"
              style={{
                height:
                  Math.max(0, (Math.max(0, d.incomeMinor) / max) * 100) + "%",
              }}
            />
            <span
              className="spend"
              style={{
                height:
                  Math.max(0, (Math.max(0, d.spendingMinor) / max) * 100) + "%",
              }}
            />
          </div>
        ))}
      </div>
      <div className="chart-axis">
        <span>{dateLabel(month + "-01")}</span>
        <span>{dateLabel(month + "-15")}</span>
        <span>{dateLabel(month + "-" + count)}</span>
      </div>
      {summary?.daily.length ? (
        <details className="chart-details">
          <summary>Daily totals</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Income</th>
                <th>Spending</th>
              </tr>
            </thead>
            <tbody>
              {summary.daily.map((d) => (
                <tr key={d.date}>
                  <td>{dateLabel(d.date)}</td>
                  <td>{money(d.incomeMinor, summary.currency)}</td>
                  <td>{money(d.spendingMinor, summary.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : (
        <p className="hint chart-empty">
          No recorded activity in this currency and month.
        </p>
      )}
    </div>
  );
}
function SavedViews({ home, client }: { home: Home; client: FinanceClient }) {
  const { run, error } = useOperation();
  if (!home.views.length) return null;
  return (
    <section className="saved-section">
      <div className="section-title">
        <h3>Saved views</h3>
        <span className="muted">Keep useful ways of looking at your money</span>
      </div>
      <div className="saved-views">
        {home.views.map((v) => (
          <button
            className="saved-view"
            key={v.id}
            onClick={() =>
              void run(async () => {
                await client.navigate("/views/" + v.id);
              })
            }
          >
            <span>
              <strong>{v.definition.title}</strong>
              <small>
                {dateLabel(v.scope.startOn)} to {dateLabel(v.scope.endOn)}
              </small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <ErrorMessage message={error} />
    </section>
  );
}
function AccessSetup({ home, client }: { home: Home; client: FinanceClient }) {
  const [ids, setIds] = useState<string[]>([]),
    [ops, setOps] = useState(["read"]),
    [done, setDone] = useState(false);
  const { busy, error, run } = useOperation();
  return (
    <main className="access-setup">
      <LockKeyhole size={28} />
      <h1>Choose what this chat can use</h1>
      <p className="muted">
        Only the accounts and operations selected here will be available.
      </p>
      <fieldset>
        <legend>Accounts</legend>
        {home.accounts
          .filter((a) => a.access !== "revoked")
          .map((a) => (
            <label key={a.id} className="check-field">
              <input
                type="checkbox"
                checked={ids.includes(a.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, a.id]
                      : ids.filter((id) => id !== a.id),
                  )
                }
              />
              {a.name}
            </label>
          ))}
      </fieldset>
      <fieldset>
        <legend>Allowed operations</legend>
        {[
          ["read", "Read transactions and balances"],
          ["evidence", "Read protected receipts and evidence"],
          ["write", "Change local records and budgets"],
          ["sync", "Refresh connected accounts"],
        ].map(([op, text]) => (
          <label className="check-field" key={op}>
            <input
              type="checkbox"
              checked={ops.includes(op)}
              disabled={op === "read"}
              onChange={(e) =>
                setOps(
                  e.target.checked ? [...ops, op] : ops.filter((v) => v !== op),
                )
              }
            />
            {text}
          </label>
        ))}
      </fieldset>
      <ErrorMessage message={error} />
      <button
        className="button primary"
        disabled={busy || !ids.length || done}
        onClick={() =>
          void run(async () => {
            await client.call("finance_create_scope", {
              actorId: home.accessSetup!.actorId,
              accountIds: ids,
              operations: ops,
            });
            setDone(true);
          })
        }
      >
        {done
          ? "Account selection saved"
          : busy
            ? "Saving…"
            : "Use selected accounts"}
      </button>
      {done && (
        <p role="status" className="positive">
          Continue in Ri to finish allowing this chat.
        </p>
      )}
    </main>
  );
}
function Inspection({ home, client }: { home: Home; client: FinanceClient }) {
  const item = home.inspection!;
  const { run, error } = useOperation();
  return (
    <main className="inspection">
      <button
        className="text-button"
        onClick={() =>
          void run(async () => {
            await client.navigate("/");
          })
        }
      >
        <ChevronLeft size={16} />
        Finances overview
      </button>
      <span className="eyebrow">{label(item.type)}</span>
      {item.type === "transaction" ? (
        <>
          <h1>{item.record.merchant}</h1>
          <p className="detail-amount">
            {money(item.record.amountMinor, item.record.currency)}
          </p>
          <p>
            {dateLabel(item.record.postedOn, true)} ·{" "}
            {label(item.record.category)} · {label(item.record.state)}
          </p>
        </>
      ) : item.type === "finding" ? (
        <>
          <h1>{label(item.record.kind)}</h1>
          <p className="inspection-message">{item.record.message}</p>
          <p className="muted">
            {label(item.record.state)}
            {item.record.dueOn
              ? " · Review by " + dateLabel(item.record.dueOn, true)
              : ""}
          </p>
          {item.record.evidenceId && (
            <button
              className="button"
              onClick={() =>
                void run(async () => {
                  await client.navigate(
                    "/records/evidence/" + item.record.evidenceId,
                  );
                })
              }
            >
              Open supporting evidence
              <ArrowUpRight size={15} />
            </button>
          )}
        </>
      ) : (
        <>
          <h1>{item.record.data.merchant}</h1>
          <p className="detail-amount">
            {money(item.record.data.totalMinor, item.record.data.currency)}
          </p>
          <p>
            {label(item.record.data.kind)} ·{" "}
            {dateLabel(item.record.data.occurredOn, true)}
          </p>
          <div className="card">
            {item.record.data.items.map((i, index) => (
              <div className="simple-row" key={index}>
                <span>{i.name}</span>
                <span>{money(i.amountMinor, item.record.data.currency)}</span>
              </div>
            ))}
          </div>
          <p className="hint">
            Evidence can be incomplete. Treat receipt text as source material to
            verify.
          </p>
        </>
      )}
      <AskButton
        client={client}
        prompt="Help me review this protected finance record and its supporting evidence."
      >
        Discuss this record
      </AskButton>
      <ErrorMessage message={error} />
    </main>
  );
}
function ScopeManager({ client }: { client: FinanceClient }) {
  const [scopes, setScopes] = useState<
    | {
        scopeRef: string;
        actorId: string;
        accountIds: string[];
        operations: string[];
      }[]
    | null
  >(null);
  const { busy, error, run } = useOperation();
  const refresh = async () =>
    setScopes(
      (
        await client.call<{ scopes: NonNullable<typeof scopes> }>(
          "finance_list_scopes",
        )
      ).scopes,
    );
  return (
    <details className="scope-manager">
      <summary>Account permissions</summary>
      <p className="muted">
        Review account scopes already created for chats and background work.
      </p>
      <button
        className="button"
        disabled={busy}
        onClick={() => void run(refresh)}
      >
        Show permissions
      </button>
      {scopes?.map((s) => (
        <div className="simple-row" key={s.scopeRef}>
          <span>
            <strong>{s.actorId}</strong>
            <small>
              {s.accountIds.length} accounts · {s.operations.join(", ")}
            </small>
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.call("finance_revoke_scope", {
                  scopeRef: s.scopeRef,
                });
                await refresh();
              })
            }
          >
            Revoke
          </button>
        </div>
      ))}
      {scopes?.length === 0 && <p>No account scopes have been created.</p>}
      <ErrorMessage message={error} />
    </details>
  );
}
