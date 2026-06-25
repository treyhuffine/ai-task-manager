/**
 * Temporary instrumentation for hunting render / effect storms. Drop calls
 * to `hot('tag')` in suspect spots; the tracker batches counts in 1s
 * windows and only logs when a tag exceeds the threshold. Quiet under
 * normal load, loud when something goes wrong.
 *
 * Two log paths, so we still get signal under a fully locked main thread:
 *   - Batched (setInterval, every 1s)        — normal case, grouped warning.
 *   - Inline panic (synchronous, in `hot()`) — fires the first time any tag
 *     crosses `PANIC` count between flushes. setInterval is a macrotask, so
 *     a true sync infinite loop or a render storm that saturates the main
 *     thread starves the batched flush. The inline branch logs from inside
 *     the runaway path itself, which is the only thing still running.
 *
 * Three ways to enable, in order of precedence:
 *   1. Console:    window.__HOT__ = true     (live toggle, no reload)
 *   2. CLI flag:   flow start --dev --hot    (sets NEXT_PUBLIC_HOT=1)
 *   3. Env var:    NEXT_PUBLIC_HOT=1 pnpm dev
 *
 * Setting `window.__HOT__ = false` explicitly overrides the env-var default,
 * so you can leave the flag on at startup and still mute the page when needed.
 *
 * Optional knobs (env or console):
 *   window.__HOT_THRESHOLD__ / NEXT_PUBLIC_HOT_THRESHOLD   batched warn at >N/s (default 20)
 *   window.__HOT_PANIC__     / NEXT_PUBLIC_HOT_PANIC       inline log at single-tag N (default 500)
 *
 * Removal: this whole subsystem is local to `src/lib/_debug/`. To rip out:
 *   git grep -l "_debug/hot-path" | xargs sed -i '' '/_debug\/hot-path/d;/hot(/d'
 *   rm -rf src/lib/_debug
 */

declare global {
  interface Window {
    __HOT__?: boolean;
    __HOT_THRESHOLD__?: number;
    __HOT_PANIC__?: number;
  }
}

const DEFAULT_PANIC = 500;
const DEFAULT_THRESHOLD = 20;

// Build-time inlined by Next for any `NEXT_PUBLIC_*` reference. Treat any
// truthy non-"0", non-"false" value as "on" so `=1`, `=true`, and `=on` all
// work — common ergonomics for boolean envs.
function envFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function envNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const ENV_ENABLED = envFlag(process.env.NEXT_PUBLIC_HOT);
const ENV_THRESHOLD = envNumber(process.env.NEXT_PUBLIC_HOT_THRESHOLD);
const ENV_PANIC = envNumber(process.env.NEXT_PUBLIC_HOT_PANIC);

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // Explicit window override wins both ways: `= true` forces on, `= false`
  // forces off. Anything else (undefined) falls back to the env default.
  if (typeof window.__HOT__ === 'boolean') return window.__HOT__;
  return ENV_ENABLED;
}

const counts = new Map<string, number>();
// Tags that have already panic-logged this flush window. Cleared on flush so
// each window can re-trigger. Prevents one runaway tag from blasting the
// console with N identical lines.
const panicLogged = new Set<string>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlush() {
  if (flushTimer) return;
  if (typeof window === 'undefined') return;
  flushTimer = setInterval(() => {
    panicLogged.clear();
    if (counts.size === 0) return;
    const threshold = window.__HOT_THRESHOLD__ ?? ENV_THRESHOLD ?? DEFAULT_THRESHOLD;
    const noisy: Array<[string, number]> = [];
    for (const [tag, n] of counts) {
      if (n >= threshold) noisy.push([tag, n]);
    }
    if (noisy.length > 0) {
      noisy.sort((a, b) => b[1] - a[1]);
      // Single grouped log per window so the console doesn't fill with N lines.
      // eslint-disable-next-line no-console
      console.warn(
        `[hot-path] ${noisy.length} tag(s) over ${threshold}/s:\n` +
          noisy.map(([t, n]) => `  ${n.toString().padStart(5)}× ${t}`).join('\n'),
      );
    }
    counts.clear();
  }, 1000);
}

/** Record a fire for `tag`. No-op unless enabled via env or `window.__HOT__`. */
export function hot(tag: string): void {
  if (!isEnabled()) return;
  ensureFlush();
  const n = (counts.get(tag) ?? 0) + 1;
  counts.set(tag, n);
  // Inline panic path. The batched flush is a setInterval macrotask; if the
  // main thread is locked, it never fires. Logging synchronously from the
  // call site is the only thing that gets the message out. One log per tag
  // per flush window — enough signal, won't fill the console.
  const panic = window.__HOT_PANIC__ ?? ENV_PANIC ?? DEFAULT_PANIC;
  if (n >= panic && !panicLogged.has(tag)) {
    panicLogged.add(tag);
    // eslint-disable-next-line no-console
    console.error(
      `[hot-path] PANIC ${tag}: ${n} fires since last flush, main thread likely starved`,
    );
  }
}
