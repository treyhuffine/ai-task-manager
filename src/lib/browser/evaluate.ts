/**
 * `evaluate`: run agent-written JS in the current tab.
 *
 * Trust is the login scope (docs/browser-capability-proposal.md §6): evaluate
 * runs on any page the profile can reach, for any caller, with what the profile
 * is signed into. Around the script, a guard on the tab's requests keeps two
 * promises that block nothing a legitimate script needs:
 *
 *   - The private-network floor. Navigation already refuses localhost, private
 *     addresses and metadata endpoints (confine.ts). A fetch from the script
 *     can't reach them either.
 *   - Cookie placeholders. Page JS can't read HttpOnly cookies, but sites like
 *     Medium need one echoed into a header (`x-xsrf-token`). The script writes
 *     `{{cookie:<name>}}` in a request header or body, and the guard fills it
 *     from the profile's cookie jar as the request leaves, only for a request to
 *     the tab's own origin, and only with a cookie the browser would send there
 *     anyway. The value never enters page JS, the result, the model, the
 *     transcript or the audit, so agent-written code can't send it elsewhere.
 *
 * The guard stays on from just before the script until the act settles, which
 * covers the requests the script awaits and the ones it fires and forgets.
 */

import type { BrowserContext, CDPSession, Page, Route, Request } from 'playwright-core';
import { ActionError } from '@/lib/orchestrator/types';
import { applyCap } from './cap';
import { isRequestAllowed } from './confine';
import { redactSecrets } from './redact';

/** Matches `{{cookie:<name>}}`. Cookie names hold no spaces or braces. */
const PLACEHOLDER_RE = /\{\{cookie:([^{}\s]+)\}\}/g;

/** Eval results bigger than this are spilled to a file. */
export const EVAL_MAX_CHARS = 20_000;

/** What happened to the script's requests, for the agent. Names and origins only, never values. */
export interface EvalRequests {
  /** Placeholders filled, by cookie name. */
  cookiesFilled?: string[];
  /** Placeholders naming a cookie the browser would not send to that URL. Sent unfilled. */
  cookiesMissing?: string[];
  /** Origins that got a placeholder unfilled, because they aren't the tab's own origin. */
  notFilled?: string[];
  /** Requests refused by the private-network floor. */
  refused?: string[];
}

/** Every `{{cookie:name}}` name in a string. */
export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

/**
 * Fill placeholders from a cookie lookup. Unknown names stay as written (the
 * request then fails at the site, which is the honest outcome).
 */
export function fillPlaceholders(
  text: string,
  lookup: (name: string) => string | undefined,
  onFill: (name: string, value: string) => void,
  onMissing: (name: string) => void,
): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) => {
    const value = lookup(name);
    if (value === undefined) {
      onMissing(name);
      return whole;
    }
    onFill(name, value);
    return value;
  });
}

/** Replace every occurrence of the filled cookie values in a JSON-shaped value. */
export function scrubValue(value: unknown, secrets: ReadonlyMap<string, string>): unknown {
  const scrubString = (s: string): string => {
    let out = s;
    for (const [secret, name] of secrets) {
      if (secret) out = out.split(secret).join(`[redacted:cookie:${name}]`);
    }
    return redactSecrets(out);
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return scrubString(v);
    if (depth > 50 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, depth + 1);
    return out;
  };
  return walk(value, 0);
}

/** The origin a URL belongs to, or null for opaque ones (about:blank, data:). */
export function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** A short form of a URL for reporting: origin plus path, no query (it can carry tokens). */
function reportUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

/**
 * The request guard around one evaluate. Arm it before the script runs and
 * disarm it after the act settles.
 */
export class EvaluateGuard {
  /** Filled cookie value → cookie name, to scrub from anything returned. */
  readonly filledValues = new Map<string, string>();
  private readonly filled = new Set<string>();
  private readonly missing = new Set<string>();
  private readonly notFilled = new Set<string>();
  private readonly refused: string[] = [];
  private cdp: CDPSession | null = null;
  private armed = false;

  private readonly handler = async (route: Route, request: Request) => {
    try {
      await this.handle(route, request);
    } catch {
      // The request may be gone (the page navigated). Hand it on if we still can.
      await route.fallback().catch(() => {});
    }
  };

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    /** The tab's origin when the script started. Placeholders are filled for it alone. */
    readonly origin: string | null,
  ) {}

  async arm(): Promise<void> {
    await this.context.route('**/*', this.handler);
    this.armed = true;
    // A service worker would answer the tab's requests itself and its own fetch
    // isn't routed, so the guard would never see them. Bypass it for the window.
    try {
      this.cdp = await this.context.newCDPSession(this.page);
      await this.cdp.send('Network.enable');
      await this.cdp.send('Network.setBypassServiceWorker', { bypass: true });
    } catch {
      this.cdp = null;
    }
  }

  async disarm(): Promise<void> {
    if (this.armed) {
      this.armed = false;
      await this.context.unroute('**/*', this.handler).catch(() => {});
    }
    if (this.cdp) {
      const cdp = this.cdp;
      this.cdp = null;
      await cdp.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
      await cdp.detach().catch(() => {});
    }
  }

  private async handle(route: Route, request: Request): Promise<void> {
    const url = request.url();
    if (!isRequestAllowed(url)) {
      this.refused.push(reportUrl(url));
      await route.abort('blockedbyclient');
      return;
    }

    // `headers()` is what the page set (Playwright's documented base for an
    // override). The browser still attaches the cookie header itself.
    const headers = request.headers();
    const body = request.postData();
    const inHeaders = Object.values(headers).some((v) => v.includes('{{cookie:'));
    const inBody = !!body && body.includes('{{cookie:');
    if (!inHeaders && !inBody) {
      await route.fallback();
      return;
    }

    const target = originOf(url);
    if (!this.origin || target !== this.origin) {
      // Never fill toward another origin. The literal placeholder goes out,
      // useless to whoever receives it.
      this.notFilled.add(target ?? reportUrl(url));
      await route.fallback();
      return;
    }

    // Only cookies the browser itself would attach to this exact URL.
    const jar = await this.context.cookies(url);
    const lookup = (name: string) => jar.find((c) => c.name === name)?.value;
    const onFill = (name: string, value: string) => {
      this.filled.add(name);
      this.filledValues.set(value, name);
    };
    const onMissing = (name: string) => this.missing.add(name);
    const fill = (s: string) => fillPlaceholders(s, lookup, onFill, onMissing);

    const nextHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) nextHeaders[name] = fill(value);
    await route.fallback({
      headers: nextHeaders,
      ...(inBody && body ? { postData: fill(body) } : {}),
    });
  }

  /** What happened to the script's requests, or undefined when nothing notable did. */
  report(): EvalRequests | undefined {
    const out: EvalRequests = {
      ...(this.filled.size ? { cookiesFilled: [...this.filled] } : {}),
      ...(this.missing.size ? { cookiesMissing: [...this.missing] } : {}),
      ...(this.notFilled.size ? { notFilled: [...this.notFilled] } : {}),
      ...(this.refused.length ? { refused: [...new Set(this.refused)].slice(0, 20) } : {}),
    };
    return Object.keys(out).length ? out : undefined;
  }
}

export interface EvalOutcome {
  /** The script's value, scrubbed, or a truncated JSON preview when large. */
  value: unknown;
  /** Size of the full value as JSON. */
  resultChars: number;
  truncated?: boolean;
  spillPath?: string;
}

/** Run the script in the main frame. Errors become a clear ActionError. */
export async function runScript(page: Page, fn: string): Promise<unknown> {
  try {
    return await page.evaluate(fn);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ActionError('invalid_params', `The evaluate script failed: ${redactSecrets(message.split('\n')[0])}`);
  }
}

/** Scrub, measure and cap the value for the model, spilling a large one to a file. */
export function finishValue(value: unknown, guard: EvaluateGuard | null, session: string): EvalOutcome {
  const scrubbed = scrubValue(value, guard?.filledValues ?? new Map());
  let json: string;
  try {
    json = JSON.stringify(scrubbed) ?? '';
  } catch {
    json = String(scrubbed);
  }
  if (json.length <= EVAL_MAX_CHARS) return { value: scrubbed, resultChars: json.length };
  const capped = applyCap(json, EVAL_MAX_CHARS, session, 'eval', 'Return less, or read the file.');
  return { value: capped.content, resultChars: json.length, truncated: true, spillPath: capped.spillPath };
}
