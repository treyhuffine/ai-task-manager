/**
 * In-process session registry for the agent browser.
 *
 * Actions are separate calls, but within one Flow server (or one CLI process)
 * they share this module singleton. A session caches the CDP connection and the
 * per-session state that has to survive between calls: the active tab,
 * idempotency results, the last set-of-marks map, captured downloads, dialog
 * policy, and an idle-close timer.
 *
 * The browser process itself is not owned here (see session.ts). We cache the
 * connection, track tabs, and transparently reconnect if it drops.
 */

import type { Page } from 'playwright-core';
import type { Attachment } from '@/db/types';
import { saveAttachment } from '@/lib/attachments/save';
import { ActionError } from '@/lib/orchestrator/types';
import { getIdleCloseMs } from './config';
import type { AgentBrowser, OpenOptions } from './session';
import { openOrConnect, closeBrowser } from './session';
import type { Mark } from './read';

export interface DialogRecord {
  type: string;
  message: string;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface BrowserSession {
  id: string;
  profile?: string;
  agent: AgentBrowser;
  /** The tab reads and acts operate on. */
  activePage: Page;
  /** Idempotency: applied act keys mapped to their recorded result. */
  appliedKeys: Map<string, unknown>;
  /** The last screenshot read's set-of-marks, for mark-based acting. */
  marks: Map<string, Mark>;
  /** Downloads captured into Flow attachments, in order. */
  capturedDownloads: Attachment[];
  reportedDownloads: number;
  downloadsStarted: number;
  downloadsSettled: number;
  /** How the next dialog is handled while an act runs. Reset after each act. */
  dialogPolicy: 'accept' | 'dismiss';
  dialogPromptText?: string;
  dialogs: DialogRecord[];
  dialogsSeen: number;
  /** Auto-close-on-idle timer. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Pages we have already wired download + dialog handlers onto. */
  attached: WeakSet<Page>;
}

const sessions = new Map<string, BrowserSession>();

function sessionKey(opts: OpenOptions & { session?: string }): string {
  // A profile is the browser identity (its own cookie jar). It is the primary
  // key; `session` is a legacy alias. Default profile is `agent`.
  return opts.profile ?? opts.session ?? 'agent';
}

/**
 * Wire download + dialog handlers onto a page. Attached to every tab (current
 * and future via the context 'page' event) so capture works no matter which
 * tab is active. Idempotent per page.
 */
function attachPageHandlers(session: BrowserSession, page: Page): void {
  if (session.attached.has(page)) return;
  session.attached.add(page);

  page.on('download', async (download) => {
    session.downloadsStarted++;
    try {
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const att = await saveAttachment({
        data: Buffer.concat(chunks),
        originalName: download.suggestedFilename() || 'download',
      });
      session.capturedDownloads.push(att);
    } catch {
      // A failed capture must not break the run.
    } finally {
      session.downloadsSettled++;
    }
  });

  page.on('dialog', async (dialog) => {
    const type = dialog.type();
    session.dialogs.push({ type, message: dialog.message() });
    session.dialogsSeen++;
    try {
      // Never let a beforeunload block navigation.
      if (type === 'beforeunload') {
        await dialog.accept();
        return;
      }
      if (session.dialogPolicy === 'accept') await dialog.accept(session.dialogPromptText);
      else await dialog.dismiss();
    } catch {
      // dialog already handled / page gone
    }
  });
}

/** How long a cached session's CDP channel gets to answer before we treat it as
 * dead and reconnect. Only ever paid in full on a wedged/half-dead transport. */
const LIVENESS_PING_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * True if `probe` resolves within `ms`; false if it rejects or does not settle
 * in time. A late rejection is swallowed so it never surfaces as unhandled.
 * Exported for tests.
 */
export async function respondsWithin(probe: Promise<unknown>, ms: number): Promise<boolean> {
  probe.catch(() => {});
  try {
    await withTimeout(probe, ms);
    return true;
  } catch {
    return false;
  }
}

async function isLive(session: BrowserSession): Promise<boolean> {
  if (!session.agent.browser.isConnected()) return false;
  const hasOpenTab =
    !session.activePage.isClosed() || session.agent.context.pages().some((p) => !p.isClosed());
  if (!hasOpenTab) return false;
  // isConnected() only reflects what the transport object believes; it lags a
  // browser that has died or wedged. Confirm the CDP channel actually answers
  // under a short deadline before handing the cached session back, otherwise the
  // next read/act call gets dispatched into a half-dead transport and hangs.
  return respondsWithin(session.agent.context.cookies(), LIVENESS_PING_MS);
}

/** Get or create a live session, reconnecting if the browser was closed. */
export async function getSession(
  opts: OpenOptions & { session?: string } = {},
): Promise<BrowserSession> {
  const key = sessionKey(opts);
  const existing = sessions.get(key);
  if (existing && (await isLive(existing))) {
    touchSession(existing);
    return existing;
  }

  const agent = await openOrConnect(opts);
  const session: BrowserSession =
    existing ??
    ({
      id: key,
      profile: opts.profile,
      agent,
      activePage: agent.page,
      appliedKeys: new Map(),
      marks: new Map(),
      capturedDownloads: [],
      reportedDownloads: 0,
      downloadsStarted: 0,
      downloadsSettled: 0,
      dialogPolicy: 'dismiss',
      dialogs: [],
      dialogsSeen: 0,
      attached: new WeakSet<Page>(),
    } satisfies BrowserSession);

  // On reconnect, rebind to the fresh browser.
  session.agent = agent;
  session.activePage = agent.page;
  session.attached = new WeakSet<Page>();

  for (const p of agent.context.pages()) attachPageHandlers(session, p);
  agent.context.on('page', (p) => attachPageHandlers(session, p));

  sessions.set(key, session);
  touchSession(session);
  return session;
}

/** The live active tab, opening one if every tab was closed. */
export async function getActivePage(session: BrowserSession): Promise<Page> {
  if (!session.activePage.isClosed()) return session.activePage;
  const live = session.agent.context.pages().find((p) => !p.isClosed());
  session.activePage = live ?? (await session.agent.context.newPage());
  return session.activePage;
}

/** Reset the idle-close timer. Called on every session use. */
export function touchSession(session: BrowserSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const idleMs = getIdleCloseMs();
  if (idleMs <= 0) {
    session.idleTimer = undefined;
    return;
  }
  session.idleTimer = setTimeout(() => {
    void closeIdle(session);
  }, idleMs);
  // Never let the idle timer hold the process open.
  session.idleTimer.unref?.();
}

async function closeIdle(session: BrowserSession): Promise<void> {
  sessions.delete(session.id);
  try {
    await closeBrowser(session.profile);
  } catch {
    // best-effort
  }
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

export async function listTabs(session: BrowserSession): Promise<TabInfo[]> {
  const pages = session.agent.context.pages();
  return Promise.all(
    pages.map(async (p, index) => ({
      index,
      url: p.url(),
      title: await p.title().catch(() => ''),
      active: p === session.activePage,
    })),
  );
}

export function selectTab(session: BrowserSession, index: number): void {
  const page = session.agent.context.pages()[index];
  if (!page || page.isClosed()) {
    throw new ActionError('invalid_params', `No open tab at index ${index}.`);
  }
  session.activePage = page;
}

export async function closeTab(session: BrowserSession, index: number): Promise<void> {
  const pages = session.agent.context.pages();
  const page = pages[index];
  if (!page) throw new ActionError('invalid_params', `No open tab at index ${index}.`);
  const wasActive = page === session.activePage;
  await page.close();
  if (wasActive) await getActivePage(session);
}

/** Open a new blank tab and make it active. Navigation is the caller's job. */
export async function openTab(session: BrowserSession): Promise<Page> {
  const page = await session.agent.context.newPage();
  session.activePage = page;
  return page;
}

// ─── Downloads + marks ──────────────────────────────────────────────────────

/** Downloads captured since the last time this was called for the session. */
export function drainNewDownloads(session: BrowserSession): Attachment[] {
  const fresh = session.capturedDownloads.slice(session.reportedDownloads);
  session.reportedDownloads = session.capturedDownloads.length;
  return fresh;
}

/**
 * Wait until every download that had started as of `targetStarted` has finished
 * saving, bounded by a timeout. Used by act after an interaction that kicked
 * off a download, so the download shows up in that action's result.
 */
export async function settleDownloads(
  session: BrowserSession,
  targetStarted: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (session.downloadsSettled < targetStarted && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Replace the stored set-of-marks after a screenshot read. */
export function setMarks(session: BrowserSession, marks: Mark[]): void {
  session.marks = new Map(marks.map((m) => [m.mark, m]));
}

/** Forget a session after its browser is closed. */
export function forgetSession(id = 'agent'): void {
  const session = sessions.get(id);
  if (session?.idleTimer) clearTimeout(session.idleTimer);
  sessions.delete(id);
}
