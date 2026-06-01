'use client';

import { useState } from 'react';
import { Play, Square, RotateCw, ExternalLink, ChevronDown, ChevronUp, Monitor, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PreviewHeaderProps {
  /** The absolute URL the iframe is loading (loopback or remote), or null. */
  url: string | null;
  /** local (loopback, same machine) vs remote (active provider URL). */
  mode: 'local' | 'remote';
  /** Label for the remote provider (e.g. "Beam") — shown in remote mode. */
  providerLabel: string;
  /** Whether the iframe is currently showing content. */
  isLive: boolean;
  /** True while a Start mutation is in flight. */
  isStarting: boolean;
  /** True when the server is up / coming up (so Start flips to Stop). */
  isStarted: boolean;
  /** Whether the logs strip is visible. */
  logsOpen: boolean;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onToggleLogs: () => void;
}

export function PreviewHeader({
  url,
  mode,
  providerLabel,
  isLive,
  isStarting,
  isStarted,
  logsOpen,
  onStart,
  onStop,
  onRefresh,
  onToggleLogs,
}: PreviewHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="flex h-9 items-center gap-1.5 border-b border-border bg-background px-2">
      {isStarted || isStarting ? (
        <button
          type="button"
          onClick={onStop}
          disabled={isStarting}
          className="flex h-7 items-center gap-1.5 rounded px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="Stop preview"
        >
          <Square size={12} className="fill-current" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={isStarting}
          className="flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
          title="Start preview"
        >
          <Play size={12} className="fill-current" />
          Start
        </button>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={!isLive}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        title="Reload"
      >
        <RotateCw size={13} />
      </button>

      {/* Reachability chip — local loopback vs the active remote provider. */}
      {isLive && (
        <span
          title={
            mode === 'local'
              ? 'Local — loopback to the dev server on this machine.'
              : `Remote — reached via ${providerLabel}.`
          }
          className={cn(
            'flex h-7 items-center gap-1 rounded px-1.5 text-[10px] font-medium uppercase tracking-wide',
            mode === 'local'
              ? 'text-sky-600 dark:text-sky-400'
              : 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {mode === 'local' ? <Monitor size={10} /> : <Globe size={10} />}
          {mode === 'local' ? 'Local' : providerLabel}
        </span>
      )}

      {/* URL strip — read-only, click to copy. */}
      <button
        type="button"
        onClick={handleCopy}
        disabled={!url}
        title={copied ? 'Copied!' : url ? 'Click to copy URL' : 'No URL yet'}
        className={cn(
          'mx-1 flex h-7 flex-1 items-center truncate rounded bg-muted/50 px-2.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50',
          copied && 'text-foreground',
        )}
      >
        {copied ? 'Copied URL' : url ?? '—'}
      </button>

      <a
        href={url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!url}
        onClick={(e) => { if (!url) e.preventDefault(); }}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
          !url && 'pointer-events-none opacity-30',
        )}
        title="Open in new tab"
      >
        <ExternalLink size={13} />
      </a>

      <button
        type="button"
        onClick={onToggleLogs}
        className={cn(
          'flex h-7 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground',
          logsOpen && 'bg-muted text-foreground',
        )}
        title={logsOpen ? 'Hide logs' : 'Show logs'}
      >
        {logsOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        Logs
      </button>
    </div>
  );
}
