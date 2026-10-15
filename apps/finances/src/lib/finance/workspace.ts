import * as q from "@/lib/db/queries";
import type { FinancePrincipal } from "@/lib/db/finance-queries";
import type { FinanceTransactionRecord } from "@/db/types";
import { dateOnly } from "./contracts";
import { sumMoney } from "./money";
import { OperationError } from "@/lib/server/operation";
import { exportFinanceCsv } from "./imports";

export type ActivityScope = {
  accountIds: string[];
  startOn: string;
  endOn: string;
  currency?: string;
  search?: string;
  category?: string;
  state?: "posted" | "pending";
};

/** Account/date indexed reads, at most 366 days and 50,000 records. All filters
 * use the effective records, including remembered merchant rules and corrections.
 * A limit failure is explicit, never a quietly truncated financial total. */
function records(p: FinancePrincipal, scope: ActivityScope) {
  dateOnly.parse(scope.startOn);
  dateOnly.parse(scope.endOn);
  const days = (Date.parse(scope.endOn) - Date.parse(scope.startOn)) / 86400000;
  if (days <= 0 || days > 366)
    throw new OperationError(400, {
      error: "dates",
      message: "Choose a period of 1 to 366 days.",
    });
  return q
    .financeTransactionsForCalculation(p, scope)
    .filter((t) => t.state !== "removed");
}

function activityRows(p: FinancePrincipal, scope: ActivityScope) {
  const search = scope.search?.trim().toLocaleLowerCase();
  return records(p, scope)
    .filter(
      (t) =>
        (!scope.currency || t.currency === scope.currency) &&
        (!scope.category || t.category === scope.category) &&
        (!scope.state || t.state === scope.state) &&
        (!search || t.merchant.toLocaleLowerCase().includes(search)),
    )
    .sort(
      (a, b) =>
        b.postedOn.localeCompare(a.postedOn) || b.id.localeCompare(a.id),
    );
}
export function financeActivity(
  p: FinancePrincipal,
  scope: ActivityScope & {
    limit?: number;
    after?: { date: string; id: string };
  },
) {
  const filtered = activityRows(p, scope);
  const remaining = scope.after
    ? filtered.filter(
        (t) =>
          t.postedOn < scope.after!.date ||
          (t.postedOn === scope.after!.date && t.id < scope.after!.id),
      )
    : filtered;
  const rows = remaining.slice(
    0,
    Math.min(200, Math.max(1, scope.limit ?? 50)),
  );
  const last = rows.at(-1);
  return {
    rows,
    total: filtered.length,
    next:
      remaining.length > rows.length && last
        ? { date: last.postedOn, id: last.id }
        : null,
  };
}
export function exportFinanceActivity(
  p: FinancePrincipal,
  scope: ActivityScope,
) {
  const rows = activityRows(p, scope),
    text = exportFinanceCsv(rows);
  if (Buffer.byteLength(text) > 512 * 1024)
    throw new OperationError(400, {
      error: "size",
      message: "Choose a shorter period or fewer accounts to export.",
    });
  q.recordFinanceCopy(p, scope.accountIds, "download");
  return { text, count: rows.length };
}

export function financeOverview(
  p: FinancePrincipal,
  scope: Pick<ActivityScope, "accountIds" | "startOn" | "endOn">,
) {
  const accounts = q.requireFinance(p, scope.accountIds);
  const transactions = records(p, scope);
  const financial = new Set(
    accounts
      .filter((a) => ["cash", "credit"].includes(a.kind))
      .map((a) => a.id),
  );
  const spending = (t: FinanceTransactionRecord) =>
    !["income", "transfer", "card_payment"].includes(t.kind);
  const currencies = [...new Set(accounts.map((a) => a.currency))].sort();
  const summaries = currencies.map((currency) => {
    const rows = transactions.filter(
      (t) => t.currency === currency && financial.has(t.accountId),
    );
    const posted = rows.filter((t) => t.state === "posted");
    const incomeMinor = sumMoney(
      posted.filter((t) => t.kind === "income").map((t) => -t.amountMinor),
    );
    const spendingMinor = sumMoney(
      posted.filter(spending).map((t) => t.amountMinor),
    );
    const categoryMap = new Map<string, number>();
    for (const t of posted.filter(spending))
      categoryMap.set(
        t.category,
        sumMoney([categoryMap.get(t.category) ?? 0, t.amountMinor]),
      );
    const days = new Map<string, { income: number[]; spending: number[] }>();
    for (const t of posted) {
      const day = days.get(t.postedOn) ?? { income: [], spending: [] };
      if (t.kind === "income") day.income.push(-t.amountMinor);
      else if (spending(t)) day.spending.push(t.amountMinor);
      days.set(t.postedOn, day);
    }
    const cash = accounts.filter(
      (a) => a.currency === currency && a.kind === "cash",
    );
    const credit = accounts.filter(
      (a) => a.currency === currency && a.kind === "credit",
    );
    return {
      currency,
      incomeMinor,
      spendingMinor,
      netMinor: sumMoney([incomeMinor, -spendingMinor]),
      pendingMinor: sumMoney(
        rows
          .filter((t) => t.state === "pending" && spending(t))
          .map((t) => t.amountMinor),
      ),
      cashMinor: cash.some((a) => a.balanceMinor !== null)
        ? sumMoney(cash.map((a) => a.balanceMinor ?? 0))
        : null,
      creditMinor: credit.some((a) => a.balanceMinor !== null)
        ? sumMoney(credit.map((a) => a.balanceMinor ?? 0))
        : null,
      unknownBalances: [...cash, ...credit].filter(
        (a) => a.balanceMinor === null,
      ).length,
      categories: [...categoryMap]
        .map(([category, amountMinor]) => ({ category, amountMinor }))
        .sort((a, b) => b.amountMinor - a.amountMinor),
      daily: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({
          date,
          incomeMinor: sumMoney(value.income),
          spendingMinor: sumMoney(value.spending),
        })),
      transactionCount: rows.length,
    };
  });
  return {
    startOn: scope.startOn,
    endOn: scope.endOn,
    summaries,
    // Do not repeat receipt-derived findings to a read-only transaction grant.
    findings: q
      .listFinanceFindings(p, scope.accountIds)
      .filter(
        (f) =>
          (f.state === "open" ||
            (f.state === "snoozed" &&
              !!f.snoozedUntil &&
              f.snoozedUntil < new Date().toISOString())) &&
          (!f.evidenceId ||
            (() => {
              try {
                q.getFinanceEvidence(p, f.evidenceId);
                return true;
              } catch (error) {
                if (error instanceof OperationError && error.status === 403)
                  return false;
                throw error;
              }
            })()),
      )
      .slice(0, 12),
    coverage: accounts
      .filter((a) => ["cash", "credit"].includes(a.kind))
      .map((a) => ({
        accountId: a.id,
        asOf: a.asOf,
        manual: ["manual", "synthetic"].includes(a.provider),
        incomplete:
          a.access !== "connected" ||
          ["stale", "reconnect", "error", "syncing"].includes(a.syncStatus) ||
          !a.historyStart ||
          a.historyStart > scope.startOn,
        stale: !a.asOf || Date.now() - Date.parse(a.asOf) > 48 * 3600000,
      })),
  };
}
