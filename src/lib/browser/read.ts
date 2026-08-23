/**
 * The read ladder. One page, three ways to see it, tried in order for a plain
 * read and selectable explicitly:
 *
 *   snapshot   - accessibility tree with stable aria-ref ids. The default.
 *   text       - readability-extracted article body. The founding Medium job.
 *   screenshot - set-of-marks image for canvas / shadow DOM / anything the
 *                tree cannot express.
 *
 * Reads are bounded (max_chars, with spill to scratch) and secret-redacted at
 * the boundary. A blocked-page detector surfaces login and challenge walls so
 * the agent can hand back to the human instead of spinning.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Page } from 'playwright-core';
import { ensureBrowserWorkDir } from '@/lib/config/paths';
import { saveAttachment } from '@/lib/attachments/save';
import type { Attachment } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { redactSecrets } from './redact';

export type ReadMode = 'snapshot' | 'text' | 'screenshot' | 'pdf';

export interface Mark {
  mark: string;
  role: string;
  name: string;
  x: number;
  y: number;
}

export interface BlockedSignal {
  kind: 'login' | 'challenge';
  message: string;
}

export interface ReadResult {
  url: string;
  title: string;
  mode: ReadMode;
  /** Model-facing content (snapshot tree or article text). Empty for screenshot. */
  content: string;
  /** Number of ref-bearing elements (snapshot mode). */
  refCount?: number;
  /** Set-of-marks map (screenshot mode). */
  marks?: Mark[];
  /** Base64 PNG (screenshot mode). Goes to the agent vision call, not the transcript. */
  image?: string;
  imageMimeType?: string;
  truncated?: boolean;
  /** Where the full untruncated content was spilled, when truncated. */
  spillPath?: string;
  /** The saved artifact (pdf mode): the page filed as a Flow attachment. */
  attachment?: Attachment;
  /** Present when a login or challenge wall is detected. */
  blocked?: BlockedSignal;
}

const DEFAULT_MAX_CHARS = 40_000;

export interface ReadOptions {
  mode?: ReadMode;
  selector?: string;
  maxChars?: number;
  efficient?: boolean;
  fullPage?: boolean;
  /** Session id, used to name spill files. */
  session?: string;
}

/** Full accessibility snapshot with aria-ref ids (`[ref=e12]`). */
async function snapshotTree(page: Page, efficient: boolean): Promise<{ text: string; refCount: number }> {
  const root = page.locator('body');
  const raw = await root.ariaSnapshot({ mode: 'ai' });
  const refCount = (raw.match(/\[ref=/g) ?? []).length;
  if (!efficient) return { text: raw, refCount };
  return { text: toEfficient(raw), refCount };
}

/**
 * Efficient tier: keep interactive and named-content lines (everything the
 * agent can act on or navigate by), drop long non-interactive prose. Lines
 * carrying a `[ref=` are the actionable set in ai mode; headings give
 * structure.
 */
function toEfficient(snapshot: string): string {
  const keep = /\[ref=|^\s*-\s*(heading|link|button|textbox|combobox|listbox|checkbox|radio|tab|menuitem|searchbox|switch|slider|option)\b/;
  return snapshot
    .split('\n')
    .filter((line) => keep.test(line))
    .join('\n');
}

/** Readability over the rendered HTML, with a live-innerText fallback. */
async function extractText(page: Page, selector?: string): Promise<string> {
  try {
    const html = await page.content();
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    const body = article?.textContent?.trim() ?? '';
    if (body.length > 200) {
      const head = [article?.title, article?.byline].filter(Boolean).join(' — ');
      return head ? `${head}\n\n${body}` : body;
    }
  } catch {
    // fall through to innerText
  }
  const sel = selector ?? 'main, article, [role="main"]';
  return page.evaluate((s) => {
    const el = (document.querySelector(s) as HTMLElement | null) ?? document.body;
    return el?.innerText ?? '';
  }, sel);
}

/** Set-of-marks: overlay numbered boxes on interactive elements, screenshot. */
async function setOfMarks(page: Page, fullPage: boolean): Promise<{ image: string; marks: Mark[] }> {
  const marks = await page.evaluate(() => {
    const SEL =
      'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=switch], [contenteditable="true"], [onclick]';
    const els = Array.from(document.querySelectorAll(SEL));
    const out: Array<{ mark: string; role: string; name: string; x: number; y: number }> = [];
    let i = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) continue;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const mark = `m${++i}`;
      const box = document.createElement('div');
      box.className = '__flow_som__';
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid #ff2d55;z-index:2147483646;pointer-events:none;box-sizing:border-box;`;
      const label = document.createElement('div');
      label.className = '__flow_som__';
      label.textContent = mark;
      label.style.cssText = `position:fixed;left:${r.left}px;top:${Math.max(0, r.top - 14)}px;background:#ff2d55;color:#fff;font:11px/1.2 ui-monospace,monospace;padding:0 3px;z-index:2147483647;pointer-events:none;`;
      document.body.appendChild(box);
      document.body.appendChild(label);
      const name = (
        el.getAttribute('aria-label') ||
        (el as HTMLElement).innerText ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        ''
      )
        .trim()
        .slice(0, 80);
      out.push({
        mark,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      });
    }
    return out;
  });
  const buf = await page.screenshot({ type: 'png', fullPage });
  await page.evaluate(() => {
    document.querySelectorAll('.__flow_som__').forEach((n) => n.remove());
  });
  return { image: buf.toString('base64'), marks };
}

/** Conservative login / challenge wall detection for graceful handback. */
/**
 * A transient bot-verification interstitial (Cloudflare "Just a moment", and
 * friends). These auto-clear for a real signed-in browser after a beat, so we
 * wait them out before reading rather than returning the challenge page.
 */
export async function isInterstitial(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const title = (document.title || '').toLowerCase();
      const url = location.href;
      if (/just a moment|attention required|checking your browser|verifying you are human/.test(title)) return true;
      if (/[?&]__cf_chl|\/cdn-cgi\/challenge|cf_chl_/.test(url)) return true;
      return !!document.querySelector(
        '#challenge-form, #cf-challenge-running, .cf-browser-verification, .cf-turnstile, iframe[src*="challenges.cloudflare.com"]',
      );
    });
  } catch {
    return false;
  }
}

/** Wait for a transient interstitial to clear (Cloudflare passes a real browser). */
export async function settleInterstitial(page: Page, timeoutMs = 15_000): Promise<void> {
  if (!(await isInterstitial(page))) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    if (!(await isInterstitial(page))) return;
  }
}

export async function detectBlocked(page: Page): Promise<BlockedSignal | undefined> {
  const url = page.url();
  // A challenge that has not cleared (settleInterstitial already gave it time).
  if (await isInterstitial(page)) {
    return {
      kind: 'challenge',
      message: 'A bot-verification interstitial (e.g. Cloudflare) is still on this page. Wait and retry the read, or hand back to the user.',
    };
  }
  const signals = await page.evaluate(() => {
    // Only an on-screen element blocks. Invisible/decorative widgets (Google's
    // site-wide reCAPTCHA v3 badge and its 0-sized iframe, a hidden sign-in
    // modal) must not read as a wall when the real content is present. The
    // predicate is inlined at each call site so it stays a plain anonymous
    // arrow (no bundler name-keeping helpers leak into the page context).
    const hasPassword = Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
    });
    // Match the interactive challenge frames (the checkbox anchor and the popup
    // bframe), not the invisible v3 scoring iframe, and require it to be shown.
    const captchaSel =
      'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com/captcha"], iframe[title*="challenge" i], [class*="captcha" i]:not(.grecaptcha-badge):not([class*="grecaptcha"]), [id*="captcha" i]';
    const captchaEl = Array.from(document.querySelectorAll(captchaSel)).some((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
    });
    const bodyText = (document.body?.innerText || '').slice(0, 4000).toLowerCase();
    const captchaText = /(are you a robot|verify you are human|complete the captcha|unusual traffic)/.test(bodyText);
    return { hasPassword, captcha: captchaEl || captchaText };
  });
  if (signals.captcha) {
    return { kind: 'challenge', message: 'A CAPTCHA or human-verification challenge is blocking this page.' };
  }
  if (signals.hasPassword || /\/(login|signin|sign-in|sign_in|auth|sso)(\/|\?|$)/i.test(url)) {
    return {
      kind: 'login',
      message: 'This page is asking for a login. The agent browser may not be signed into this site.',
    };
  }
  return undefined;
}

/** Cap model-facing text, spilling the full content to scratch when over. */
function applyCap(content: string, maxChars: number, session: string, label: string): {
  content: string;
  truncated?: boolean;
  spillPath?: string;
} {
  if (content.length <= maxChars) return { content };
  const dir = path.join(ensureBrowserWorkDir(), 'spill');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safeSession = session.replace(/[^a-zA-Z0-9_-]/g, '_');
  const spillPath = path.join(dir, `${safeSession}-${label}-${Date.now()}.txt`);
  fs.writeFileSync(spillPath, content, { mode: 0o600 });
  const head = content.slice(0, maxChars);
  return {
    content: `${head}\n\n[truncated at ${maxChars} chars. Full content spilled to ${spillPath}. Re-read with a tighter selector or a larger max_chars.]`,
    truncated: true,
    spillPath,
  };
}

/** Read the current page through the chosen mode. */
export async function readPage(page: Page, opts: ReadOptions = {}): Promise<ReadResult> {
  const mode: ReadMode = opts.mode ?? 'snapshot';
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const session = opts.session ?? 'default';
  // Wait out a transient bot interstitial (Cloudflare) before reading, so we
  // return the real page and not the challenge screen.
  await settleInterstitial(page);
  const url = page.url();
  const title = await page.title().catch(() => '');
  const blocked = await detectBlocked(page);

  if (mode === 'screenshot') {
    const { image, marks } = await setOfMarks(page, opts.fullPage ?? false);
    return { url, title, mode, content: '', marks, image, imageMimeType: 'image/png', blocked };
  }

  if (mode === 'pdf') {
    let buf: Buffer;
    try {
      buf = await page.pdf({ printBackground: true });
    } catch (err) {
      throw new ActionError(
        'unsupported',
        `PDF export needs a headless browser. ${err instanceof Error ? err.message : String(err)}`,
        'Run the read on an unattended (headless) session.',
      );
    }
    const base = (title || 'page').slice(0, 80).replace(/[^\w.-]+/g, '_') || 'page';
    const attachment = await saveAttachment({ data: buf, originalName: `${base}.pdf`, mimeType: 'application/pdf' });
    return { url, title, mode, content: '', attachment, blocked };
  }

  if (mode === 'text') {
    const raw = redactSecrets(await extractText(page, opts.selector));
    const capped = applyCap(raw, maxChars, session, 'text');
    return { url, title, mode, ...capped, blocked };
  }

  const { text, refCount } = await snapshotTree(page, opts.efficient ?? true);
  const capped = applyCap(redactSecrets(text), maxChars, session, 'snapshot');
  return { url, title, mode, refCount, ...capped, blocked };
}

/**
 * A compact snapshot auto-attached after navigation so the agent never has to
 * round-trip to re-read. Always the efficient interactive tier.
 */
export async function pageState(page: Page): Promise<{ url: string; title: string; snapshot: string; refCount: number }> {
  const { text, refCount } = await snapshotTree(page, true);
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    snapshot: redactSecrets(text),
    refCount,
  };
}
