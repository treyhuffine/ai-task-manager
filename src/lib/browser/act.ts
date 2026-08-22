/**
 * Act on the current page. One interaction per call (or a batch), flat `kind`
 * discriminator.
 *
 * Targeting: `ref` is an aria-ref id from a snapshot read (`e12`), resolved
 * statelessly against the live DOM. A `mark` id from a screenshot read (`m3`)
 * is resolved through the session's stored set-of-marks to a viewport click.
 *
 * Every act reports the resulting page state, downloads, dialogs, new tabs, and
 * a blocked signal, so the agent always sees the consequence of what it did.
 */

import type { Locator, Page } from 'playwright-core';
import { attachmentPath } from '@/lib/attachments/save';
import type { Attachment } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { pageState, detectBlocked, type BlockedSignal } from './read';
import {
  drainNewDownloads,
  settleDownloads,
  getActivePage,
  type BrowserSession,
  type DialogRecord,
} from './runtime';

export type ActKind =
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'select'
  | 'scroll'
  | 'wait'
  | 'upload'
  | 'evaluate'
  | 'back'
  | 'forward'
  | 'reload';

export type WaitFor = 'load' | 'domcontentloaded' | 'networkidle';

export interface ActInput {
  kind: ActKind;
  /** aria-ref (e12) or set-of-marks id (m3). */
  ref?: string;
  /** text for `type`. */
  text?: string;
  /** press Enter after typing. */
  submit?: boolean;
  /** key for `press` (e.g. Enter, Control+A). */
  key?: string;
  /** option values for `select`. */
  values?: string[];
  /** Flow attachment fileName for `upload`. */
  attachmentFile?: string;
  /** milliseconds for `wait`/scroll delta, or timeout for a selector/state wait. */
  ms?: number;
  /** CSS selector for `wait` (wait until it appears). */
  selector?: string;
  /** load state for `wait`. */
  waitFor?: WaitFor;
  /** JS expression for `evaluate` (trusted local callers only). */
  fn?: string;
  /** Accept (vs dismiss) a JS dialog this action triggers. */
  acceptDialog?: boolean;
  /** Text to answer a prompt dialog with, when accepting. */
  dialogText?: string;
}

export interface ActResult {
  ok: true;
  kind: ActKind;
  navigated: boolean;
  pageState: Awaited<ReturnType<typeof pageState>>;
  downloads: Attachment[];
  /** A JS dialog the action triggered (already handled per acceptDialog). */
  dialog?: DialogRecord;
  /** A tab the action opened. The active tab auto-switches to it. */
  newTab?: { index: number; url: string; title: string };
  /** A login or challenge wall detected on the resulting page. */
  blocked?: BlockedSignal;
  /** Return value of an `evaluate` action. */
  evalResult?: unknown;
}

function isMark(ref: string): boolean {
  return /^m\d+$/.test(ref);
}

function requireRef(input: ActInput): string {
  if (!input.ref) {
    throw new ActionError('invalid_params', `The '${input.kind}' action needs a ref from a prior read.`);
  }
  return input.ref;
}

/** Resolve an aria-ref to a Playwright locator. */
function locatorForRef(page: Page, ref: string): Locator {
  return page.locator(`aria-ref=${ref}`);
}

/** Run a locator action, mapping "element not found / detached" to a stale-ref hint. */
async function withStaleRefGuard<T>(ref: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/aria-ref|not found|no element|detached|resolve|Timeout/i.test(message)) {
      throw new ActionError(
        'invalid_params',
        `Ref ${ref} did not resolve. The page likely changed. Re-read to get fresh refs.`,
      );
    }
    throw err;
  }
}

async function performRefAction(page: Page, input: ActInput): Promise<void> {
  const ref = requireRef(input);
  const loc = locatorForRef(page, ref);
  await withStaleRefGuard(ref, async () => {
    switch (input.kind) {
      case 'click':
        await loc.click();
        return;
      case 'type':
        await loc.fill(input.text ?? '');
        if (input.submit) await loc.press('Enter');
        return;
      case 'press':
        if (!input.key) throw new ActionError('invalid_params', "The 'press' action needs a key.");
        await loc.press(input.key);
        return;
      case 'hover':
        await loc.hover();
        return;
      case 'select':
        await loc.selectOption(input.values ?? []);
        return;
      case 'scroll':
        await loc.scrollIntoViewIfNeeded();
        return;
      case 'upload': {
        if (!input.attachmentFile) throw new ActionError('invalid_params', "The 'upload' action needs an attachment.");
        await loc.setInputFiles(attachmentPath(input.attachmentFile));
        return;
      }
      default:
        throw new ActionError('invalid_params', `The '${input.kind}' action does not target a ref.`);
    }
  });
}

async function performMarkAction(page: Page, session: BrowserSession, input: ActInput): Promise<void> {
  const ref = requireRef(input);
  const mark = session.marks.get(ref);
  if (!mark) {
    throw new ActionError(
      'invalid_params',
      `Mark ${ref} is unknown. Take a fresh screenshot read to refresh the marks.`,
    );
  }
  switch (input.kind) {
    case 'click':
      await page.mouse.click(mark.x, mark.y);
      return;
    case 'hover':
      await page.mouse.move(mark.x, mark.y);
      return;
    case 'type':
      await page.mouse.click(mark.x, mark.y);
      await page.keyboard.type(input.text ?? '');
      if (input.submit) await page.keyboard.press('Enter');
      return;
    default:
      throw new ActionError('invalid_params', `Mark targeting supports click, hover, and type, not '${input.kind}'.`);
  }
}

/** The core dispatch, shared by single acts and batches. Returns an eval value. */
async function applyAction(page: Page, session: BrowserSession, input: ActInput): Promise<{ evalResult?: unknown }> {
  switch (input.kind) {
    case 'wait':
      if (input.selector) {
        await page.waitForSelector(input.selector, { timeout: input.ms ?? 15_000 });
      } else if (input.waitFor) {
        await page.waitForLoadState(input.waitFor, { timeout: input.ms ?? 15_000 });
      } else {
        await page.waitForTimeout(Math.max(0, Math.min(input.ms ?? 500, 30_000)));
      }
      return {};
    case 'evaluate': {
      if (!input.fn) throw new ActionError('invalid_params', "The 'evaluate' action needs fn (a JS expression).");
      const evalResult = await page.evaluate(input.fn);
      return { evalResult };
    }
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      return {};
    case 'forward':
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
      return {};
    case 'reload':
      await page.reload({ waitUntil: 'domcontentloaded' });
      return {};
    case 'scroll':
      if (input.ref) {
        await performRefAction(page, input);
      } else {
        await page.mouse.wheel(0, input.ms ?? 600);
      }
      return {};
    default:
      if (input.ref && isMark(input.ref)) {
        await performMarkAction(page, session, input);
      } else {
        await performRefAction(page, input);
      }
      return {};
  }
}

/** Everything to observe after an action or batch: new tab, downloads, dialog. */
async function settleAfter(
  session: BrowserSession,
  urlBefore: string,
  startedBefore: number,
  dialogsBefore: number,
  pagesBefore: number,
): Promise<Pick<ActResult, 'navigated' | 'pageState' | 'downloads' | 'dialog' | 'newTab' | 'blocked'>> {
  const context = session.agent.context;
  const active0 = await getActivePage(session);
  await active0.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});

  let newTab: ActResult['newTab'];
  const pagesNow = context.pages();
  if (pagesNow.length > pagesBefore) {
    const opened = pagesNow[pagesNow.length - 1];
    await opened.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
    session.activePage = opened;
    newTab = { index: pagesNow.length - 1, url: opened.url(), title: await opened.title().catch(() => '') };
  }

  if (session.downloadsStarted > startedBefore) {
    await settleDownloads(session, session.downloadsStarted);
  }

  const dialog = session.dialogsSeen > dialogsBefore ? session.dialogs[session.dialogs.length - 1] : undefined;
  const active = await getActivePage(session);
  const blocked = await detectBlocked(active);

  return {
    navigated: active.url() !== urlBefore || !!newTab,
    pageState: await pageState(active),
    downloads: drainNewDownloads(session),
    ...(dialog ? { dialog } : {}),
    ...(newTab ? { newTab } : {}),
    ...(blocked ? { blocked } : {}),
  };
}

/** Perform one action, returning the new page state, downloads, dialogs, tabs. */
export async function performAct(session: BrowserSession, input: ActInput): Promise<ActResult> {
  const page = await getActivePage(session);
  const urlBefore = page.url();
  const startedBefore = session.downloadsStarted;
  const dialogsBefore = session.dialogsSeen;
  const pagesBefore = session.agent.context.pages().length;

  session.dialogPolicy = input.acceptDialog ? 'accept' : 'dismiss';
  session.dialogPromptText = input.dialogText;
  let evalResult: unknown;
  try {
    ({ evalResult } = await applyAction(page, session, input));
  } finally {
    session.dialogPolicy = 'dismiss';
    session.dialogPromptText = undefined;
  }

  const observed = await settleAfter(session, urlBefore, startedBefore, dialogsBefore, pagesBefore);
  return {
    ok: true,
    kind: input.kind,
    ...observed,
    ...(evalResult !== undefined ? { evalResult } : {}),
  };
}

export interface BatchStepResult {
  kind: ActKind;
  ok: boolean;
  error?: string;
  evalResult?: unknown;
}

export interface BatchResult {
  ok: true;
  steps: BatchStepResult[];
  aborted?: { afterStep: number; reason: 'error' | 'navigation' };
  pageState: Awaited<ReturnType<typeof pageState>>;
  downloads: Attachment[];
  dialog?: DialogRecord;
  newTab?: ActResult['newTab'];
  blocked?: BlockedSignal;
}

/**
 * Run several acts in one call, one model round-trip. Stops when a step errors
 * or navigates (the agent's refs were for the pre-navigation DOM), reporting
 * which step and why. Returns the final page state once.
 */
export async function performBatch(session: BrowserSession, steps: ActInput[]): Promise<BatchResult> {
  const context = session.agent.context;
  const urlBefore = (await getActivePage(session)).url();
  const startedBefore = session.downloadsStarted;
  const dialogsBefore = session.dialogsSeen;
  const pagesBefore = context.pages().length;

  const results: BatchStepResult[] = [];
  let aborted: BatchResult['aborted'];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const page = await getActivePage(session);
    const stepUrlBefore = page.url();
    const stepPagesBefore = context.pages().length;

    session.dialogPolicy = step.acceptDialog ? 'accept' : 'dismiss';
    session.dialogPromptText = step.dialogText;
    try {
      const { evalResult } = await applyAction(page, session, step);
      results.push({ kind: step.kind, ok: true, ...(evalResult !== undefined ? { evalResult } : {}) });
    } catch (err) {
      results.push({ kind: step.kind, ok: false, error: err instanceof Error ? err.message : String(err) });
      aborted = { afterStep: i, reason: 'error' };
      break;
    } finally {
      session.dialogPolicy = 'dismiss';
      session.dialogPromptText = undefined;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
    const pagesNow = context.pages();
    if (pagesNow.length > stepPagesBefore) session.activePage = pagesNow[pagesNow.length - 1];
    const activeNow = await getActivePage(session);
    if (activeNow.url() !== stepUrlBefore) {
      aborted = { afterStep: i, reason: 'navigation' };
      break;
    }
  }

  // A batch reports the final state, not per-step navigation.
  const observed = await settleAfter(session, urlBefore, startedBefore, dialogsBefore, pagesBefore);
  return {
    ok: true,
    steps: results,
    ...(aborted ? { aborted } : {}),
    pageState: observed.pageState,
    downloads: observed.downloads,
    ...(observed.dialog ? { dialog: observed.dialog } : {}),
    ...(observed.newTab ? { newTab: observed.newTab } : {}),
    ...(observed.blocked ? { blocked: observed.blocked } : {}),
  };
}
