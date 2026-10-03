/**
 * Act on the current page. One interaction per call (or a batch), flat `kind`
 * discriminator.
 *
 * Targeting: `ref` is an aria-ref id from a snapshot read (`e12`), resolved
 * statelessly against the live DOM. A `mark` id from a screenshot read (`m3`)
 * is resolved through the session's stored set-of-marks to a viewport click.
 *
 * Acts behave like a person at the keyboard. `type` sends real key events per
 * character by default, so autocompletes, rich editors and contenteditables
 * react as they do for a human (a `fill` only sets the value and fires one
 * input event, which most suggestion widgets never see). After the act the page
 * gets to settle (settle.ts), so suggestions that load after a debounce are in
 * the result.
 *
 * Every act reports the resulting page state, downloads, dialogs, new tabs, and
 * a blocked signal, so the agent always sees the consequence of what it did.
 * The page state leads with what appeared since the agent's last look, and on a
 * big page it is only the changes (snapshot.ts).
 */

import type { Locator, Page } from 'playwright-core';
import { attachmentPath } from '@/lib/attachments/save';
import type { Attachment } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { detectBlocked, settleInterstitial, type BlockedSignal } from './read';
import {
  drainNewDownloads,
  settleDownloads,
  getActivePage,
  baselineFor,
  rememberBaseline,
  type BrowserSession,
  type DialogRecord,
} from './runtime';
import { baselineOf, buildPageView, captureSnapshot, type PageState } from './snapshot';
import {
  ActivityTracker,
  armMutationClock,
  settlePage,
  SETTLE_DEFAULT,
  SETTLE_STEP,
  SETTLE_TYPING,
  type SettleTiming,
} from './settle';
import { EvaluateGuard, finishValue, originOf, runScript, type EvalRequests } from './evaluate';

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

/** How `type` enters text: real key events, or setting the value at once. */
export type Typing = 'keys' | 'fill';

export interface ActInput {
  kind: ActKind;
  /** aria-ref (e12) or set-of-marks id (m3). */
  ref?: string;
  /** text for `type`. */
  text?: string;
  /** press Enter after typing. */
  submit?: boolean;
  /** For `type`: `keys` (default up to 1,000 chars) or `fill` (default above). */
  typing?: Typing;
  /** key for `press` (e.g. Enter, Control+A). */
  key?: string;
  /** option values for `select`. */
  values?: string[];
  /** Ri attachment fileName for `upload`. */
  attachmentFile?: string;
  /** milliseconds for `wait`/scroll delta, or timeout for a selector/state wait. */
  ms?: number;
  /** CSS selector for `wait` (wait until it appears). */
  selector?: string;
  /** load state for `wait`. */
  waitFor?: WaitFor;
  /** JS for `evaluate`, run in the main frame. `{{cookie:<name>}}` in a request it sends is filled server-side. */
  fn?: string;
  /** Accept (vs dismiss) a JS dialog this action triggers. */
  acceptDialog?: boolean;
  /** Text to answer a prompt dialog with, when accepting. */
  dialogText?: string;
}

/** What the audit trail records about one evaluate. */
export interface EvaluateRecord {
  fn: string;
  /** The tab's origin when the script started. */
  origin: string | null;
  resultChars?: number;
  requests?: EvalRequests;
  error?: string;
}

export interface ActOptions {
  /** Names spill files (the profile). */
  session?: string;
  /** Called once per evaluate, success or failure, for the audit trail. */
  onEvaluate?: (record: EvaluateRecord) => void;
}

export interface ActResult {
  ok: true;
  kind: ActKind;
  navigated: boolean;
  pageState: PageState;
  downloads: Attachment[];
  /** A JS dialog the action triggered (already handled per acceptDialog). */
  dialog?: DialogRecord;
  /** A tab the action opened. The active tab auto-switches to it. */
  newTab?: { index: number; url: string; title: string };
  /** A login or challenge wall detected on the resulting page. */
  blocked?: BlockedSignal;
  /** Return value of an `evaluate` action. A truncated JSON preview when large. */
  evalResult?: unknown;
  /** The tab's origin the script ran on. */
  evalOrigin?: string | null;
  /** Cookie placeholders filled or not, and requests refused, for an `evaluate`. */
  evalRequests?: EvalRequests;
  /** Set when the eval value was too large and spilled to evalSpillPath. */
  evalTruncated?: boolean;
  evalSpillPath?: string;
}

/** Longer text is filled at once: typing it key by key would take too long. */
export const FILL_OVER_CHARS = 1_000;

/** Per-key delay: human-paced for short text (what autocompletes expect), quick for longer. */
export function keyDelay(length: number): number {
  if (length <= 50) return 30;
  if (length <= 300) return 8;
  return 0;
}

/** The typing a `type` uses when the caller didn't choose. */
export function resolveTyping(text: string, typing?: Typing): Typing {
  return typing ?? (text.length > FILL_OVER_CHARS ? 'fill' : 'keys');
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
    if (err instanceof ActionError) throw err;
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

/**
 * Type into an element. `type` replaces the field's text either way. With
 * keys, the field is cleared first (when it is a field), then each character
 * goes in as keydown, keypress/input, keyup, the way a person types.
 */
async function typeInto(loc: Locator, text: string, typing?: Typing): Promise<void> {
  if (resolveTyping(text, typing) === 'fill') {
    await loc.fill(text);
    return;
  }
  const isField = await loc.evaluate(
    (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable,
  );
  // Something that takes keys without being a field (a custom widget) has nothing to clear.
  if (isField) await loc.clear();
  await loc.pressSequentially(text, { delay: keyDelay(text.length) });
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
        await typeInto(loc, input.text ?? '', input.typing);
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
    case 'type': {
      const text = input.text ?? '';
      await page.mouse.click(mark.x, mark.y);
      if (resolveTyping(text, input.typing) === 'fill') await page.keyboard.insertText(text);
      else await page.keyboard.type(text, { delay: keyDelay(text.length) });
      if (input.submit) await page.keyboard.press('Enter');
      return;
    }
    default:
      throw new ActionError('invalid_params', `Mark targeting supports click, hover, and type, not '${input.kind}'.`);
  }
}

/** Every kind but evaluate (which runs inside its request guard, see runEvaluateStep). */
async function applyAction(page: Page, session: BrowserSession, input: ActInput): Promise<void> {
  switch (input.kind) {
    case 'wait':
      if (input.selector) {
        await page.waitForSelector(input.selector, { timeout: input.ms ?? 15_000 });
      } else if (input.waitFor) {
        await page.waitForLoadState(input.waitFor, { timeout: input.ms ?? 15_000 });
      } else {
        await page.waitForTimeout(Math.max(0, Math.min(input.ms ?? 500, 30_000)));
      }
      return;
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      return;
    case 'forward':
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
      return;
    case 'reload':
      await page.reload({ waitUntil: 'domcontentloaded' });
      return;
    case 'scroll':
      if (input.ref) {
        await performRefAction(page, input);
      } else {
        await page.mouse.wheel(0, input.ms ?? 600);
      }
      return;
    case 'evaluate':
      throw new ActionError('invalid_params', 'evaluate runs through runEvaluateStep.');
    default:
      if (input.ref && isMark(input.ref)) {
        await performMarkAction(page, session, input);
      } else {
        await performRefAction(page, input);
      }
  }
}

/**
 * Start an evaluate: arm the request guard and run the script. The guard is
 * returned armed, so the caller disarms it after the act settles (requests the
 * script fires and forgets are still guarded).
 */
async function runEvaluateStep(
  session: BrowserSession,
  page: Page,
  input: ActInput,
  opts: ActOptions,
): Promise<{ guard: EvaluateGuard; value: unknown }> {
  if (!input.fn) throw new ActionError('invalid_params', "The 'evaluate' action needs fn (a JS expression).");
  const origin = originOf(page.url());
  const guard = new EvaluateGuard(session.agent.context, page, origin);
  await guard.arm();
  try {
    return { guard, value: await runScript(page, input.fn) };
  } catch (err) {
    await guard.disarm();
    opts.onEvaluate?.({
      fn: input.fn,
      origin,
      requests: guard.report(),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Finish an evaluate after the settle: disarm, scrub and cap the value, record it. */
async function finishEvaluateStep(
  input: ActInput,
  guard: EvaluateGuard,
  value: unknown,
  opts: ActOptions,
): Promise<Pick<ActResult, 'evalResult' | 'evalOrigin' | 'evalRequests' | 'evalTruncated' | 'evalSpillPath'>> {
  await guard.disarm();
  const outcome = finishValue(value, guard, opts.session ?? 'agent');
  const requests = guard.report();
  opts.onEvaluate?.({ fn: input.fn ?? '', origin: guard.origin, resultChars: outcome.resultChars, requests });
  return {
    ...(outcome.value !== undefined ? { evalResult: outcome.value } : {}),
    evalOrigin: guard.origin,
    ...(requests ? { evalRequests: requests } : {}),
    ...(outcome.truncated ? { evalTruncated: true, evalSpillPath: outcome.spillPath } : {}),
  };
}

/** How long to let the page settle after one act. */
function timingFor(kind: ActKind): SettleTiming {
  return kind === 'type' || kind === 'press' ? SETTLE_TYPING : SETTLE_DEFAULT;
}

interface Before {
  urlBefore: string;
  startedBefore: number;
  dialogsBefore: number;
  pagesBefore: number;
}

function snapshotBefore(session: BrowserSession, page: Page): Before {
  return {
    urlBefore: page.url(),
    startedBefore: session.downloadsStarted,
    dialogsBefore: session.dialogsSeen,
    pagesBefore: session.agent.context.pages().length,
  };
}

/** Everything to observe once the page has settled: new tab, downloads, dialog, page view. */
async function observe(
  session: BrowserSession,
  before: Before,
  ref: string | undefined,
  spillName: string,
): Promise<Pick<ActResult, 'navigated' | 'pageState' | 'downloads' | 'dialog' | 'newTab' | 'blocked'>> {
  const context = session.agent.context;
  const active0 = await getActivePage(session);
  await active0.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});

  let newTab: ActResult['newTab'];
  const pagesNow = context.pages();
  if (pagesNow.length > before.pagesBefore) {
    const opened = pagesNow[pagesNow.length - 1];
    await opened.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
    session.activePage = opened;
    newTab = { index: pagesNow.length - 1, url: opened.url(), title: await opened.title().catch(() => '') };
  }

  if (session.downloadsStarted > before.startedBefore) {
    await settleDownloads(session, session.downloadsStarted);
  }

  const dialog = session.dialogsSeen > before.dialogsBefore ? session.dialogs[session.dialogs.length - 1] : undefined;
  const active = await getActivePage(session);
  // If the act triggered a navigation into a bot interstitial, wait it out.
  await settleInterstitial(active);
  const blocked = await detectBlocked(active);

  const url = active.url();
  const snap = await captureSnapshot(active);
  const pageState = buildPageView({
    snap,
    url,
    title: await active.title().catch(() => ''),
    baseline: baselineFor(session, active),
    ref,
    session: spillName,
  });
  rememberBaseline(session, active, baselineOf(snap, url));

  return {
    navigated: url !== before.urlBefore || !!newTab,
    pageState,
    downloads: drainNewDownloads(session),
    ...(dialog ? { dialog } : {}),
    ...(newTab ? { newTab } : {}),
    ...(blocked ? { blocked } : {}),
  };
}

/** Perform one action, returning the new page state, downloads, dialogs, tabs. */
export async function performAct(session: BrowserSession, input: ActInput, opts: ActOptions = {}): Promise<ActResult> {
  const page = await getActivePage(session);
  const before = snapshotBefore(session, page);
  const tracker = new ActivityTracker(session.agent.context, () => session.activePage).start();
  await armMutationClock(page);

  // The dialog policy holds through the settle: a dialog the act causes may
  // open a beat later (after a fetch), and it is still this act's.
  session.dialogPolicy = input.acceptDialog ? 'accept' : 'dismiss';
  session.dialogPromptText = input.dialogText;
  let evaluated: { guard: EvaluateGuard; value: unknown } | undefined;
  try {
    if (input.kind === 'evaluate') {
      evaluated = await runEvaluateStep(session, page, input, opts);
    } else {
      await applyAction(page, session, input);
    }
    await settlePage(() => session.activePage, tracker, timingFor(input.kind));
    const evalFields = evaluated ? await finishEvaluateStep(input, evaluated.guard, evaluated.value, opts) : {};
    evaluated = undefined;
    const observed = await observe(session, before, input.ref, opts.session ?? 'agent');
    return { ok: true, kind: input.kind, ...observed, ...evalFields };
  } finally {
    tracker.stop();
    if (evaluated) await evaluated.guard.disarm();
    session.dialogPolicy = 'dismiss';
    session.dialogPromptText = undefined;
  }
}

export interface BatchStepResult {
  kind: ActKind;
  ok: boolean;
  error?: string;
  evalResult?: unknown;
  evalOrigin?: string | null;
  evalRequests?: EvalRequests;
  evalTruncated?: boolean;
  evalSpillPath?: string;
}

export interface BatchResult {
  ok: true;
  steps: BatchStepResult[];
  aborted?: { afterStep: number; reason: 'error' | 'navigation' };
  pageState: PageState;
  downloads: Attachment[];
  dialog?: DialogRecord;
  newTab?: ActResult['newTab'];
  blocked?: BlockedSignal;
}

/**
 * How long to settle after a batch step. Typing gets the full wait when what
 * follows could depend on what it loaded (a press or click on a suggestion) or
 * it ends the batch; a run of plain form fields moves on quickly.
 */
export function stepTiming(steps: ActInput[], i: number): SettleTiming {
  const step = steps[i];
  const next = steps[i + 1];
  if (step.kind === 'type' || step.kind === 'press') {
    return !next || next.kind !== 'type' ? SETTLE_TYPING : SETTLE_STEP;
  }
  return next ? SETTLE_STEP : SETTLE_DEFAULT;
}

/**
 * Run several acts in one call, one model round-trip. Stops when a step errors
 * or navigates (the agent's refs were for the pre-navigation DOM), reporting
 * which step and why. Returns the final page state once.
 */
export async function performBatch(
  session: BrowserSession,
  steps: ActInput[],
  opts: ActOptions = {},
): Promise<BatchResult> {
  const context = session.agent.context;
  const before = snapshotBefore(session, await getActivePage(session));
  const tracker = new ActivityTracker(context, () => session.activePage).start();

  const results: BatchStepResult[] = [];
  let aborted: BatchResult['aborted'];

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const page = await getActivePage(session);
      const stepUrlBefore = page.url();
      const stepPagesBefore = context.pages().length;
      await armMutationClock(page);

      session.dialogPolicy = step.acceptDialog ? 'accept' : 'dismiss';
      session.dialogPromptText = step.dialogText;
      let evaluated: { guard: EvaluateGuard; value: unknown } | undefined;
      try {
        if (step.kind === 'evaluate') evaluated = await runEvaluateStep(session, page, step, opts);
        else await applyAction(page, session, step);
        await settlePage(() => session.activePage, tracker, stepTiming(steps, i));
        const evalFields = evaluated ? await finishEvaluateStep(step, evaluated.guard, evaluated.value, opts) : {};
        evaluated = undefined;
        results.push({ kind: step.kind, ok: true, ...evalFields });
      } catch (err) {
        results.push({ kind: step.kind, ok: false, error: err instanceof Error ? err.message : String(err) });
        aborted = { afterStep: i, reason: 'error' };
        break;
      } finally {
        if (evaluated) await evaluated.guard.disarm();
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
  } finally {
    tracker.stop();
  }

  // A batch reports the final state, not per-step navigation. The view diffs
  // against the agent's last look, so a suggestion a step opened is listed first.
  const lastRef = [...steps.slice(0, results.length)].reverse().find((s) => s.ref)?.ref;
  const observed = await observe(session, before, lastRef, opts.session ?? 'agent');
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
