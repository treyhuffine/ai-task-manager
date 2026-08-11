'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { terminalsApi } from '@/lib/api/terminals';
import { createInputQueue } from '@/lib/terminal/input-queue';
import { detectIsMac, resolveTerminalKey } from '@/lib/terminal/keymap';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

/**
 * How long the PTY is allowed to believe a stale size during a drag.
 *
 * `fit()` still runs every frame so the viewport reflows smoothly; only the
 * `resize` request is held back. Without this, dragging the panel divider
 * fires a request per frame and buries the shell in SIGWINCH, which makes
 * full-screen TUIs (vim, htop, an agent CLI) redraw continuously.
 */
const RESIZE_SETTLE_MS = 120;

interface ExecutionTerminalInstanceProps {
  sessionId: string;
  terminalId: string;
  active: boolean;
  onExit?: () => void;
}

/**
 * One xterm.js instance bound to a server-side PTY.
 *
 * The component intentionally mounts once per `terminalId` and stays
 * mounted while its tab is hidden — switching tabs uses CSS
 * `display: none`, not unmount, so scrollback survives. Output flows in
 * via SSE; keystrokes go out via POST. The fit addon adapts to the
 * container, and we re-fit whenever the tab becomes active because
 * `ResizeObserver` doesn't fire on `display:none → block` transitions.
 *
 * Keyed on `terminalId` alone, deliberately. The PTY is owned by the
 * execution, so hopping between chats on one execution leaves the same
 * terminal on screen — and `sessionId` is only an address for reaching
 * it, not part of its identity. Including it in the effect deps would
 * dispose and rebuild xterm on every chat switch, throwing away
 * scrollback for a PTY that never went anywhere. Terminal ids are
 * unique per execution, so a genuinely different execution brings
 * different ids and remounts naturally.
 */
export function ExecutionTerminalInstance({
  sessionId,
  terminalId,
  active,
  onExit,
}: ExecutionTerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onExitRef = useRef(onExit);

  // Keep the latest onExit without retriggering the main effect — that
  // would dispose and recreate the terminal, losing scrollback.
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  // Same trick for the session address: reads stay current, but a chat
  // switch doesn't tear the terminal down. Any sibling chat's id routes
  // to the same execution-owned PTY, so the already-open SSE connection
  // stays valid even though its URL pins the id we mounted with.
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: '#0b0b0c',
        foreground: '#e6e6e6',
        cursor: '#e6e6e6',
        cursorAccent: '#0b0b0c',
        black: '#0b0b0c',
        red: '#ff6b6b',
        green: '#5eff7a',
        yellow: '#ffd866',
        blue: '#78dbff',
        magenta: '#ff7bd6',
        cyan: '#9aedfe',
        white: '#e6e6e6',
        brightBlack: '#5c5c5c',
        brightRed: '#ff8a8a',
        brightGreen: '#8effa1',
        brightYellow: '#ffe080',
        brightBlue: '#9ae5ff',
        brightMagenta: '#ff9ce3',
        brightCyan: '#b6f1ff',
        brightWhite: '#ffffff',
      },
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // GPU renderer. xterm ships only the DOM renderer in core, which is
    // what made this terminal feel sluggish next to VS Code — VS Code loads
    // this same addon. It has to be loaded *after* `open()` because
    // `activate()` reaches for the terminal's element.
    //
    // Both failure modes fall back to the DOM renderer rather than breaking
    // the terminal: `onContextLoss` fires when the GPU drops the context
    // (driver reset, tab backgrounded too long), and the constructor throws
    // outright where WebGL2 is unavailable.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try { webgl.dispose(); } catch { /* already gone */ }
      });
      term.loadAddon(webgl);
    } catch {
      // No WebGL2 — the DOM renderer stays active and everything works.
    }

    try { fit.fit(); } catch { /* container may be 0px before paint */ }

    termRef.current = term;
    fitRef.current = fit;

    const isMac = detectIsMac();

    // stdin. Serialised and self-batching — see `input-queue.ts` for why
    // one-POST-per-keystroke both reorders bytes and drowns a tunnel.
    const input = createInputQueue({
      send: (data) => terminalsApi.input(sessionIdRef.current, terminalId, data),
    });

    // Mac-style shortcuts inside the terminal. Browser-reserved keys
    // (Cmd+T, Cmd+W, Cmd+N) we can't override — those still hit the
    // browser. Everything else we can.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      // Line editing that xterm gets wrong or skips entirely: Cmd+Backspace
      // (deletes one character instead of the line), Cmd+arrow (dead), and
      // Option+arrow (emits a sequence no shell binds, so readline drops
      // `;3D` into the buffer as literal text). See `keymap.ts`.
      const remapped = resolveTerminalKey(event, isMac);
      if (remapped !== null) {
        input.push(remapped);
        // Returning false short-circuits xterm's own keydown path, which is
        // where `scrollOnUserInput` normally lives — so editing the line
        // while scrolled up would otherwise leave the prompt off-screen.
        term.scrollToBottom();
        event.preventDefault();
        return false;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return true;

      // Cmd+C: copy selection. With no selection, fall through so the key
      // keeps whatever meaning xterm gives it.
      if (event.key === 'c' && event.metaKey) {
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel).catch(() => { /* */ });
          event.preventDefault();
          return false;
        }
        return true;
      }

      // Cmd+V is deliberately NOT handled here. xterm already listens for
      // the native `paste` event on both its textarea and its root element,
      // and that path handles bracketed paste correctly. Intercepting the
      // keydown suppressed that event and forced paste through
      // `navigator.clipboard.readText()`, which needs a permission the
      // native path doesn't: it fails outright in Firefox, prompts every
      // time in Safari, and the failure was swallowed — which is what made
      // paste look broken. Letting the key through fixes it everywhere.

      // Cmd+K: clear the viewport (Terminal.app parity). Shadows the app's
      // global search only while the terminal has focus; both bindings are
      // declared together in `constants/commands.ts`.
      if (matchesHotkey(event, HOTKEYS.terminalClear) && event.metaKey) {
        term.clear();
        event.preventDefault();
        return false;
      }

      return true;
    });

    // SSE: stdout. EventSource auto-reconnects, and replays the last `id:`
    // it saw as `Last-Event-ID`, so the server can send only what we missed
    // instead of the whole buffer. A first connect has no cursor and gets
    // the full backlog, which is what makes a refresh land on a live screen.
    const es = new EventSource(terminalsApi.streamUrl(sessionIdRef.current, terminalId));

    // A reconnect that couldn't be resumed (first view, or we were away
    // long enough that the missed output aged out of the server's ring)
    // hands back a snapshot rather than a continuation. Reset first so it
    // replaces the screen instead of being appended to a stale copy of
    // itself — appending is what made scrollback appear twice.
    const onReady = (ev: MessageEvent<string>) => {
      try {
        const { resumed } = JSON.parse(ev.data) as { resumed?: boolean };
        if (!resumed) term.reset();
      } catch { /* */ }
    };

    const onData = (ev: MessageEvent<string>) => {
      try { term.write(JSON.parse(ev.data)); } catch { /* */ }
    };
    const onExitEvt = () => {
      term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      try { es.close(); } catch { /* */ }
      onExitRef.current?.();
    };
    es.addEventListener('ready', onReady as EventListener);
    es.addEventListener('data', onData as EventListener);
    es.addEventListener('exit', onExitEvt as EventListener);

    const dataDisp = term.onData((data) => input.push(data));

    // resize → tell the pty, once the drag settles. The viewport itself
    // still reflows every frame; this only rate-limits the SIGWINCH.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeDisp = term.onResize(({ cols, rows }) => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        void terminalsApi
          .resize(sessionIdRef.current, terminalId, { cols, rows })
          .catch(() => { /* terminal may have exited mid-drag */ });
      }, RESIZE_SETTLE_MS);
    });

    // refit when the container changes size (panel resize, viewport
    // resize, etc.), at most once per frame — a drag otherwise fires the
    // observer faster than layout can settle.
    let fitFrame: number | null = null;
    const ro = new ResizeObserver(() => {
      if (fitFrame !== null) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        try { fit.fit(); } catch { /* */ }
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      if (resizeTimer) clearTimeout(resizeTimer);
      input.dispose();
      dataDisp.dispose();
      resizeDisp.dispose();
      try { es.close(); } catch { /* */ }
      try { term.dispose(); } catch { /* */ }
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId is
    // read through a ref on purpose; see the note on this component.
  }, [terminalId]);

  // Re-fit + focus when this tab becomes active. Skipping the fit on
  // hidden→visible would leave the pty thinking we're still 80x24.
  //
  // Initial mount is *not* treated as a user-initiated activation —
  // when the user opens an execution, they want the chat composer
  // focused, not the terminal. We only grab focus on subsequent
  // active flips (i.e. the user clicked a different terminal tab).
  // The fit, on the other hand, still has to run on first activation
  // so the PTY learns its true dimensions.
  const hasActivatedRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    const isFirstActivation = !hasActivatedRef.current;
    hasActivatedRef.current = true;
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        if (!isFirstActivation) {
          termRef.current?.focus();
        }
      } catch { /* */ }
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full overflow-hidden bg-[#0b0b0c] px-2 py-1',
        !active && 'invisible pointer-events-none',
      )}
      // `invisible` keeps layout (so fit() works) while hiding visually.
      // Stacked tabs all sit at inset-0; only the active one is visible.
    />
  );
}
