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

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Page } from 'playwright-core';
import { saveAttachment } from '@/lib/attachments/save';
import type { Attachment } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { handoffsEnabled } from '@/lib/work-results/capabilities';
import { applyCap } from './cap';
import { redactSecrets } from './redact';
import { baselineOf, captureSnapshot, type SnapshotBaseline } from './snapshot';

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
  /** The saved artifact (pdf mode): the page filed as a Ri attachment. */
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
  /** Called with a snapshot read's baseline, so the next act can say what is new. */
  onSnapshot?: (baseline: SnapshotBaseline) => void;
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
      box.className = '__ri_som__';
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid #ff2d55;z-index:2147483646;pointer-events:none;box-sizing:border-box;`;
      const label = document.createElement('div');
      label.className = '__ri_som__';
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
    document.querySelectorAll('.__ri_som__').forEach((n) => n.remove());
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
  if (await isHardBlock(page)) return false; // nothing to wait out
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

/**
 * A hard block: Cloudflare's "Sorry, you have been blocked" page. It shares the
 * "Attention Required!" title with a passable challenge, but it does not clear
 * on its own, and retrying can keep the block going.
 */
export async function isHardBlock(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || '').slice(0, 2000).toLowerCase();
      return /sorry, you have been blocked|you are unable to access/.test(text) && /cloudflare/.test(text + document.title.toLowerCase());
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
  if (await isHardBlock(page)) {
    return {
      kind: 'challenge',
      message:
        'The site\'s firewall (Cloudflare) has blocked this browser ("Sorry, you have been blocked"). It does not clear by waiting, and retrying can extend it. Stop using this site and hand back to the user.',
    };
  }
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
    // A real password field is wide but often only ~20-38px tall, so the size
    // floor only rules out collapsed honeypots. checkVisibility also catches a
    // field hidden through an ancestor (a transparent or display:none modal).
    const hasPassword = Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 10) return false;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        return false;
      }
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
    const base = (title || 'page').slice(0, 80).replace(/[^\w.-]+/g, '_') || 'page';
    const attachment = handoffsEnabled()
      ? await saveAttachment({ data: Buffer.from(image, 'base64'), originalName: `${base}.png`, mimeType: 'image/png' })
      : undefined;
    return { url, title, mode, content: '', marks, image, imageMimeType: 'image/png', blocked, ...(attachment ? { attachment } : {}) };
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

  const efficient = opts.efficient ?? true;
  const snap = await captureSnapshot(page, { efficient, selector: opts.selector });
  // A whole-page read is what the next act diffs against (both tiers carry
  // every ref line, so either works as the baseline).
  if (!opts.selector) opts.onSnapshot?.(baselineOf(snap, url));
  const capped = applyCap(snap.text, maxChars, session, 'snapshot');
  return { url, title, mode, refCount: snap.refCount, ...capped, blocked };
}
