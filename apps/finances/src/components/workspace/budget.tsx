import { useEffect, useState } from "react";
import {
  ArrowRight,
  CircleHelp,
  Pencil,
  Plus,
  Undo2,
  Wallet,
} from "lucide-react";
import { currencyDigits, parseMoney } from "@/lib/finance/money";
import type { FinanceScenarioChanges } from "@/lib/finance/contracts";
import type { Budget, BudgetResult, FinanceClient, Home } from "./types";
import {
  AskButton,
  dateLabel,
  Empty,
  ErrorMessage,
  Form,
  Modal,
  money,
  MoneyInput,
  useOperation,
} from "./ui";

export function BudgetPanel({
  home,
  client,
  revision,
  onChanged,
  onContext,
}: {
  home: Home;
  client: FinanceClient;
  revision: number;
  onChanged: () => Promise<void>;
  onContext: (context: {
    budgetId?: string;
    budgetRevision?: number;
    changes?: FinanceScenarioChanges;
  }) => void;
}) {
  const [chosen, setChosen] = useState(""),
    [data, setData] = useState<BudgetResult | null>(null),
    [editing, setEditing] = useState(false),
    [proposing, setProposing] = useState(false);
  const { busy, error, run, setError } = useOperation();
  const id =
    chosen ||
    home.budgets.find((b) => b.state === "adopted")?.id ||
    home.budgets.at(0)?.id;
  useEffect(() => {
    let active = true;
    if (!id) return;
    void client
      .call<BudgetResult>("finance_budget", { id })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [client, id, revision, home.budgets, setError]);
  useEffect(() => {
    if (!editing && data && data.budget.id === id)
      onContext({ budgetId: id, budgetRevision: data.budget.revision });
  }, [data, id, onContext, editing]);
  const ready = data?.budget.id === id ? data : null;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Your plan, with room to adjust</h2>
          <p className="muted">
            See what is left, explore a change, then decide.
          </p>
        </div>
        {home.owner && (
          <button className="button" onClick={() => setProposing(true)}>
            <Plus size={16} />
            New plan
          </button>
        )}
      </div>
      <ErrorMessage message={error} />
      {!id ? (
        <Empty icon={<Wallet size={30} />} title="Give your money a plan">
          Build a proposal from your recorded history and take-home income. You
          review it before it becomes your budget.
          {home.owner && (
            <button
              className="button primary"
              onClick={() => setProposing(true)}
            >
              Create a budget
            </button>
          )}
        </Empty>
      ) : !ready ? (
        <p className="loading" role="status">
          Calculating your budget…
        </p>
      ) : (
        <>
          <div className="budget-toolbar">
            <label className="field inline">
              Budget
              <select
                value={id}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setEditing(false);
                  onContext({});
                }}
              >
                {home.budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.state}
                  </option>
                ))}
              </select>
            </label>
            <span
              className={
                "pill " + (ready.budget.state === "adopted" ? "good" : "")
              }
            >
              {ready.budget.state === "proposal"
                ? "Proposal, not yet adopted"
                : ready.budget.state === "adopted"
                  ? "Active plan"
                  : "Closed plan"}
            </span>
            <span className="muted">
              {dateLabel(ready.result.startOn)} to{" "}
              {dateLabel(
                new Date(Date.parse(ready.result.endOn) - 86400000)
                  .toISOString()
                  .slice(0, 10),
                true,
              )}
            </span>
          </div>
          <div className="metrics budget-metrics">
            <div>
              <span>Planned income</span>
              <strong>
                {money(ready.budget.plan.incomeMinor, ready.result.currency)}
              </strong>
              <small>
                {ready.budget.plan.incomeConfidence === "assumed"
                  ? "Assumed income"
                  : "Confirmed income"}
              </small>
            </div>
            <div>
              <span>Spent so far</span>
              <strong>
                {money(ready.result.postedMinor, ready.result.currency)}
              </strong>
              <small>
                {money(ready.result.pendingMinor, ready.result.currency)}{" "}
                pending
              </small>
            </div>
            <div>
              <span>Budget remaining</span>
              <strong
                className={
                  ready.result.remainingMinor < 0 ? "negative" : "positive"
                }
              >
                {money(ready.result.remainingMinor, ready.result.currency)}
              </strong>
              <small>Before pending activity and upcoming bills</small>
            </div>
          </div>
          <section className="card">
            <div className="card-heading">
              <div>
                <h3>Category plan</h3>
                <p>Posted spending against your current limits</p>
              </div>
              {home.owner && ready.budget.state !== "closed" && (
                <button className="button" onClick={() => setEditing(true)}>
                  <Pencil size={15} />
                  Adjust plan
                </button>
              )}
            </div>
            <div className="budget-categories">
              {ready.result.categories.map((c) => (
                <div key={c.id} className="budget-category">
                  <div>
                    <strong>{c.name}</strong>
                    <span>
                      {money(c.postedMinor, ready.result.currency)}{" "}
                      <span className="muted">
                        of{" "}
                        {money(
                          c.limitMinor + c.rolloverMinor,
                          ready.result.currency,
                        )}
                      </span>
                    </span>
                  </div>
                  <div className="progress-track">
                    <span
                      className={c.remainingMinor < 0 ? "over" : ""}
                      style={{
                        width:
                          Math.min(
                            100,
                            Math.max(
                              0,
                              (c.postedMinor /
                                Math.max(1, c.limitMinor + c.rolloverMinor)) *
                                100,
                            ),
                          ) + "%",
                      }}
                    />
                  </div>
                  <div className="hint">
                    <span>
                      {money(c.remainingMinor, ready.result.currency)} left
                    </span>
                    <span>
                      Forecast {money(c.forecastMinor, ready.result.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="card-footer">
              <AskButton
                client={client}
                prompt="Review this budget and its assumptions. Where should I adjust it? Propose changes for me to review."
              >
                Explore this plan with Ri
              </AskButton>
              {home.owner && (
                <div className="inline-actions">
                  {ready.budget.revision > 0 && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await client.call("finance_change_budget", {
                            id,
                            expectedRevision: ready.budget.revision,
                            mutationKey: crypto.randomUUID(),
                            undo: true,
                          });
                          await onChanged();
                        })
                      }
                    >
                      <Undo2 size={14} />
                      Undo last change
                    </button>
                  )}
                  {ready.budget.state === "proposal" && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await client.call("finance_change_budget", {
                            id,
                            expectedRevision: ready.budget.revision,
                            mutationKey: crypto.randomUUID(),
                            adopt: true,
                          });
                          await onChanged();
                        })
                      }
                    >
                      Use this budget
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
          <div className="two-column">
            <section className="card">
              <div className="card-heading">
                <h3>Coming up</h3>
                <span className="pill">
                  {ready.result.upcoming.length} items
                </span>
              </div>
              {ready.result.upcoming.length ? (
                ready.result.upcoming.slice(0, 10).map((o) => (
                  <div className="simple-row" key={o.id}>
                    <span>
                      <strong>{o.merchant ?? o.category}</strong>
                      <small>
                        {dateLabel(o.dueOn)} · {o.source}
                      </small>
                    </span>
                    <strong>
                      {money(o.amountMinor, ready.result.currency)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="card-empty">
                  No upcoming obligations in this budget period.
                </p>
              )}
            </section>
            <section className="card">
              <div className="card-heading">
                <h3>Cash estimate</h3>
                <CircleHelp size={17} />
              </div>
              <div className="card-content">
                <p className="large-number">
                  {money(
                    ready.result.cash.estimatedMinor,
                    ready.result.currency,
                  )}
                </p>
                <p className="muted">
                  After known commitments and expected income. This is an
                  estimate based on the accounts and assumptions in this plan.
                </p>
                {ready.result.cash.reasons.map((r, i) => (
                  <p className="hint" key={i}>
                    {r}
                  </p>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
      {editing && ready && (
        <BudgetEdit
          data={ready}
          client={client}
          onClose={() => {
            setEditing(false);
            onContext({
              budgetId: ready.budget.id,
              budgetRevision: ready.budget.revision,
            });
          }}
          onDone={onChanged}
          onContext={onContext}
        />
      )}
      {proposing && (
        <BudgetProposal
          home={home}
          client={client}
          onClose={() => setProposing(false)}
          onDone={async (id) => {
            setChosen(id);
            await onChanged();
          }}
        />
      )}
    </>
  );
}

function BudgetEdit({
  data,
  client,
  onClose,
  onDone,
  onContext,
}: {
  data: BudgetResult;
  client: FinanceClient;
  onClose: () => void;
  onDone: () => Promise<void>;
  onContext: (context: {
    budgetId: string;
    budgetRevision: number;
    changes?: FinanceScenarioChanges;
  }) => void;
}) {
  const [base] = useState(data);
  const currency = base.budget.plan.currency,
    text = (n: number) =>
      (n / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
  const [income, setIncome] = useState(text(base.budget.plan.incomeMinor)),
    [limits, setLimits] = useState(
      Object.fromEntries(
        base.budget.plan.categories.map((c) => [c.id, text(c.limitMinor)]),
      ),
    ),
    [goals, setGoals] = useState(
      Object.fromEntries(
        base.budget.plan.goals.map((g) => [g.id, text(g.contributionMinor)]),
      ),
    );
  const [preview, setPreview] = useState<{
      result: BudgetResult;
      changes: FinanceScenarioChanges;
    } | null>(null),
    [key] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useOperation();
  const stale = base.budget.revision !== data.budget.revision;
  const clear = () => {
    setPreview(null);
    onContext({
      budgetId: base.budget.id,
      budgetRevision: base.budget.revision,
    });
  };
  return (
    <Modal title="Explore a budget change" onClose={onClose} busy={busy} wide>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const changes = {
              incomeMinor: parseMoney(income, currency),
              categoryLimits: Object.fromEntries(
                Object.entries(limits).map(([id, v]) => [
                  id,
                  parseMoney(v, currency),
                ]),
              ),
              goalContributions: Object.fromEntries(
                Object.entries(goals).map(([id, v]) => [
                  id,
                  parseMoney(v, currency),
                ]),
              ),
              obligationAmounts: {},
            };
            const result = await client.call<BudgetResult>("finance_scenario", {
              id: base.budget.id,
              changes,
            });
            if (result.budget.revision !== base.budget.revision)
              throw new Error(
                "This plan changed while you were editing. Close and reopen to review the current version.",
              );
            setPreview({ result, changes });
            onContext({
              budgetId: base.budget.id,
              budgetRevision: base.budget.revision,
              changes,
            });
          });
        }}
      >
        <div className="modal-body">
          <p className="muted">
            Try different amounts in {currency}. Your saved plan stays unchanged
            until you apply the preview.
          </p>
          <MoneyInput
            name="income"
            label="Planned take-home income"
            value={income}
            onChange={(v) => {
              setIncome(v);
              clear();
            }}
          />
          <div className="form-grid">
            {base.budget.plan.categories.map((c) => (
              <MoneyInput
                key={c.id}
                name={c.id}
                label={c.name}
                value={limits[c.id]}
                onChange={(v) => {
                  setLimits({ ...limits, [c.id]: v });
                  clear();
                }}
              />
            ))}
          </div>
          {base.budget.plan.goals.length > 0 && (
            <>
              <h3>Goal contributions</h3>
              <div className="form-grid">
                {base.budget.plan.goals.map((g) => (
                  <MoneyInput
                    key={g.id}
                    name={g.id}
                    label={g.name}
                    value={goals[g.id]}
                    onChange={(v) => {
                      setGoals({ ...goals, [g.id]: v });
                      clear();
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <ErrorMessage
            message={
              error ||
              (stale
                ? "This budget changed while you were editing. Your draft is preserved. Close and reopen to review the latest plan."
                : "")
            }
          />
          {preview && (
            <section className="preview-box">
              <span className="pill">Preview only</span>
              <h3>What changes</h3>
              {preview.changes.incomeMinor !== base.budget.plan.incomeMinor && (
                <div className="simple-row">
                  <strong>Planned income</strong>
                  <span>
                    {money(base.budget.plan.incomeMinor, currency)} →{" "}
                    {money(preview.changes.incomeMinor, currency)}
                  </span>
                </div>
              )}
              {base.budget.plan.goals
                .filter(
                  (g) =>
                    preview.changes.goalContributions[g.id] !==
                    g.contributionMinor,
                )
                .map((g) => (
                  <div className="simple-row" key={g.id}>
                    <strong>{g.name} contribution</strong>
                    <span>
                      {money(g.contributionMinor, currency)} →{" "}
                      {money(preview.changes.goalContributions[g.id], currency)}
                    </span>
                  </div>
                ))}
              {preview.result.result.categories
                .filter(
                  (c) =>
                    c.limitMinor !==
                    base.result.categories.find((b) => b.id === c.id)
                      ?.limitMinor,
                )
                .map((c) => (
                  <div className="simple-row" key={c.id}>
                    <strong>{c.name}</strong>
                    <span>
                      {money(
                        base.result.categories.find((b) => b.id === c.id)!
                          .limitMinor,
                        currency,
                      )}{" "}
                      → {money(c.limitMinor, currency)}
                    </span>
                  </div>
                ))}
              <div className="simple-row">
                <span>Unallocated income</span>
                <strong>
                  {money(preview.result.result.unallocatedMinor, currency)}
                </strong>
              </div>
              <div className="simple-row">
                <span>Forecast spending</span>
                <strong>
                  {money(preview.result.result.forecastMinor, currency)}
                </strong>
              </div>
              <AskButton
                client={client}
                prompt="Compare my staged budget changes with the saved plan. Explain tradeoffs without applying the changes."
              >
                Discuss this preview
              </AskButton>
            </section>
          )}
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {preview ? (
            <button
              type="button"
              className="button primary"
              disabled={busy || stale}
              onClick={() =>
                void run(async () => {
                  await client.call("finance_apply_budget_preview", {
                    id: base.budget.id,
                    expectedRevision: base.budget.revision,
                    changes: preview.changes,
                    mutationKey: key,
                  });
                  await onDone();
                  onClose();
                })
              }
            >
              {busy ? "Applying…" : "Apply reviewed changes"}
            </button>
          ) : (
            <button className="button primary" disabled={busy || stale}>
              {busy ? "Calculating…" : "Preview changes"}
            </button>
          )}
        </div>
      </Form>
    </Modal>
  );
}
function BudgetProposal({
  home,
  client,
  onClose,
  onDone,
}: {
  home: Home;
  client: FinanceClient;
  onClose: () => void;
  onDone: (id: string) => Promise<void>;
}) {
  const [income, setIncome] = useState(""),
    [key] = useState(() => crypto.randomUUID()),
    [selected, setSelected] = useState(
      home.accounts
        .filter(
          (a) => a.access !== "revoked" && ["cash", "credit"].includes(a.kind),
        )
        .map((a) => a.id),
    );
  const { busy, error, run } = useOperation();
  return (
    <Modal title="Create a budget proposal" onClose={onClose} busy={busy}>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await client.call<{ budget: Budget }>(
              "finance_propose_budget",
              {
                accountIds: selected,
                ...(income.trim()
                  ? {
                      incomeMinor: parseMoney(
                        income,
                        home.settings?.currency ?? "USD",
                      ),
                    }
                  : {}),
                startDay: 1,
                mutationKey: key,
              },
            );
            await onDone(result.budget.id);
            onClose();
          });
        }}
      >
        <div className="modal-body">
          <p className="muted">
            Start from recorded spending and recurring obligations. A proposal
            is saved for you to review, then explicitly adopt.
          </p>
          <MoneyInput
            name="income"
            label={
              "Monthly take-home income (" +
              (home.settings?.currency ?? "USD") +
              ")"
            }
            value={income}
            onChange={setIncome}
            required={false}
          />
          <p className="hint">
            Leave blank to estimate from available history. Review the
            assumption before adopting.
          </p>
          <fieldset>
            <legend>Accounts in this plan</legend>
            {home.accounts
              .filter(
                (a) =>
                  a.access !== "revoked" && ["cash", "credit"].includes(a.kind),
              )
              .map((a) => (
                <label key={a.id} className="check-field">
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, a.id]
                          : selected.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.name}
                </label>
              ))}
          </fieldset>
          <ErrorMessage message={error} />
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !selected.length}
          >
            {busy ? "Preparing…" : "Create proposal"}
          </button>
        </div>
      </Form>
    </Modal>
  );
}
