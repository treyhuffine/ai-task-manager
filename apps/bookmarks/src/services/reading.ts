/**
 * Reading saved pages. One bounded step per call, from the host's schedule. A
 * record stays waiting until a step finishes it, so an interrupted step just
 * runs again. Saved text is for search and reference, never instructions.
 */
import { AppError } from "@ri/app-kit/contract";
import type { AppInvocation } from "@ri/app-kit/sdk";
import { readHtml, readPlainText } from "../domain/page.js";
import type { BookmarkRow, Bookmarks } from "./core.js";

export const PAGES_PER_STEP = 12;
const BUDGET_MS = 20_000;
const CONCURRENT = 4;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60 * 60_000, 6 * 60 * 60_000];

interface WebPage { outcome: string; status: number | null; contentType: string | null; text: string | null }
export interface StepResult { status: "idle" | "worked" | "not_allowed"; read: number; waiting: number; summary: string }

export function createReading(t: Bookmarks) {
  function apply(row: BookmarkRow, page: WebPage) {
    if (page.outcome === "read" && page.text !== null) {
      const content = /html|xml/i.test(page.contentType ?? "") ? readHtml(page.text) : readPlainText(page.text);
      if (content.text) return t.recordPage(row.id, { state: "read", title: content.title, excerpt: content.excerpt, text: content.text, attempts: row.pageAttempts + 1 });
      // Almost certainly a page drawn by scripts. The browser button can still save it.
      return t.recordPage(row.id, { state: "needs_browser", title: content.title, excerpt: content.excerpt, attempts: row.pageAttempts + 1 });
    }
    if (page.outcome === "not_text") return t.recordPage(row.id, { state: "no_text", attempts: row.pageAttempts + 1 });
    if (page.outcome === "blocked") return t.recordPage(row.id, { state: "needs_browser", attempts: row.pageAttempts + 1 });
    if (page.outcome === "invalid" || page.outcome === "too_many_redirects") return t.recordPage(row.id, { state: "failed", attempts: row.pageAttempts + 1 });
    if (page.outcome === "http_error" && (page.status === 404 || page.status === 410)) return t.recordPage(row.id, { state: "gone", attempts: row.pageAttempts + 1 });
    if (page.outcome === "http_error" && page.status !== null && page.status >= 400 && page.status < 500) return t.recordPage(row.id, { state: "needs_browser", attempts: row.pageAttempts + 1 });
    const attempts = row.pageAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) return t.recordPage(row.id, { state: "failed", attempts });
    return t.recordPage(row.id, { state: "waiting", attempts, nextAt: new Date(t.now().getTime() + BACKOFF_MS[attempts - 1]).toISOString() });
  }

  async function step(invocation: AppInvocation): Promise<StepResult> {
    const due = t.dueForReading(PAGES_PER_STEP);
    t.markStep();
    if (!due.length) return { status: "idle", read: 0, waiting: t.counts().waiting, summary: "Nothing is due to be read" };
    const stopAt = Date.now() + BUDGET_MS;
    const queue = [...due];
    let read = 0;
    let notAllowed = false;
    const worker = async () => {
      for (let row = queue.shift(); row && !notAllowed && Date.now() < stopAt && !invocation.signal.aborted; row = queue.shift()) {
        try {
          apply(row, await invocation.capability("read_web_page", { url: row.url }) as WebPage);
          read++;
        } catch (error) {
          const code = error instanceof AppError ? error.code : null;
          if (code === "forbidden" || code === "revoked") notAllowed = true;
          else if (code === "interrupted") return;
          else apply(row, { outcome: "unreachable", status: null, contentType: null, text: null });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENT }, worker));
    const waiting = t.counts().waiting;
    if (notAllowed) return { status: "not_allowed", read, waiting, summary: "Reading pages is not allowed. Turn it on in Sources" };
    return { status: "worked", read, waiting, summary: `Read ${read} ${read === 1 ? "page" : "pages"}, ${waiting} waiting` };
  }
  return { step, apply };
}
