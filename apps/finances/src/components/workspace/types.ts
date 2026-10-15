import type { z } from "zod/v4";
import type { homeData } from "@/lib/local-app/schemas";
import type * as q from "@/lib/db/queries";

export type Home = z.infer<typeof homeData>;
export type Account = Home["accounts"][number];
export type Budget = Home["budgets"][number];
export type Transaction = ReturnType<typeof q.getFinanceTransaction>;
export type Overview = ReturnType<typeof q.financeOverview>;
export type Activity = ReturnType<typeof q.financeActivity>;
export type Detail = ReturnType<typeof q.financeTransactionDetail>;
export type BudgetResult = ReturnType<typeof q.calculateFinanceBudget>;
export type Section = "overview" | "transactions" | "budget" | "accounts";
export interface FinanceClient {
  call<T>(name: string, input?: Record<string, unknown>): Promise<T>;
  context(state: unknown): Promise<void>;
  navigate(path: string): Promise<unknown>;
  selectFile(): Promise<{
    name: string;
    mimeType: string;
    base64: string;
  } | null>;
  download(text: string, name: string, mime: string): Promise<void>;
}
