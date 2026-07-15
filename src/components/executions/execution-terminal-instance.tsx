'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { terminalsApi } from '@/lib/api/terminals';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

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
    try { fit.fit(); } catch { /* container may be 0px before paint */ }

    termRef.current = term;
    fitRef.current = fit;

    // Mac-style shortcuts inside the terminal. Browser-reserved keys
    // (Cmd+T, Cmd+W, Cmd+N) we can't override — those still hit the
    // browser. Everything else we can.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return true;

      // Cmd+C: copy selection. With no selection, fall through to the
      // shell so Cmd+C still does whatever Ctrl+C would do (SIGINT
      // bubbles via Ctrl+C; Cmd+C alone is just a no-op then).
      if (event.key === 'c' && event.metaKey) {
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel).catch(() => { /* */ });
          event.preventDefault();
          return false;
        }
        return true;
      }

      // Cmd+V: paste from clipboard. xterm's `paste` handles bracketed
      // paste correctly so multi-line paste doesn't run line-by-line.
      if (event.key === 'v' && event.metaKey) {
        navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        }).catch(() => { /* */ });
        event.preventDefault();
        return false;
      }

      // Cmd+K: clear viewport (Terminal.app parity).
      if (event.key === 'k' && event.metaKey) {
        term.clear();
        event.preventDefault();
        return false;
      }

      return true;
    });

    // SSE: stdout. EventSource auto-reconnects; the server replays the
    // recent buffer on each connect so refreshes don't blank the screen.
    const es = new EventSource(terminalsApi.streamUrl(sessionIdRef.current, terminalId));

    const onData = (ev: MessageEvent<string>) => {
      try { term.write(JSON.parse(ev.data)); } catch { /* */ }
    };
    const onExitEvt = () => {
      term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      try { es.close(); } catch { /* */ }
      onExitRef.current?.();
    };
    es.addEventListener('data', onData as EventListener);
    es.addEventListener('exit', onExitEvt as EventListener);

    // stdin
    const dataDisp = term.onData((data) => {
      void terminalsApi.input(sessionIdRef.current, terminalId, data).catch(() => { /* */ });
    });

    // resize → tell the pty
    const resizeDisp = term.onResize(({ cols, rows }) => {
      void terminalsApi.resize(sessionIdRef.current, terminalId, { cols, rows }).catch(() => { /* */ });
    });

    // refit when the container changes size (panel resize, viewport
    // resize, etc.)
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* */ }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
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
