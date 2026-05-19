'use client';

import { useState } from 'react';
import { Play, Square, RotateCw, ExternalLink, ChevronDown, ChevronUp, Zap, RouteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PreviewHeaderProps {
  /** The URL the iframe is currently loading. May be relative (path
   *  proxy on Flow's origin) or absolute (direct embed of the dev
   *  server's native URL). */
  url: string;
  /** Whether the iframe currently embeds the dev server's native URL
   *  directly (full fidelity) or routes through Flow's proxy. */
  embedMode: 'direct' | 'proxy';
  /** Whether the iframe is currently showing content. */
  isLive: boolean;
  /** True while a Start mutation is in flight. */
  isStarting: boolean;
  /** True when the process is running but the iframe hasn't loaded yet. */
  isStarted: boolean;
  /** Whether the preview supports start/stop (Command mode does; Portless doesn't). */
  canControl: boolean;
  /** Whether logs strip is currently visible. */
  logsOpen: boolean;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onToggleLogs: () => void;
}

export function PreviewHeader({
  url,
  embedMode,
  isLive,
  isStarting,
  isStarted,
  canControl,
  logsOpen,
  onStart,
  onStop,
  onRefresh,
  onToggleLogs,
}: PreviewHeaderProps) {
  const [copied, setCopied] = useState(false);

  const displayUrl = displayableUrl(url);
  const copyableUrl = absoluteUrl(url);
  const newTabUrl = url; // anchors work fine for both relative and absolute

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyableUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="flex h-9 items-center gap-1.5 border-b border-border bg-background px-2">
      {canControl ? (
        isStarted || isStarting ? (
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
        )
      ) : null}

      <button
        type="button"
        onClick={onRefresh}
        disabled={!isLive}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        title="Reload"
      >
        <RotateCw size={13} />
      </button>

      {/* Mode chip — tells the user whether they're seeing full-fidelity
          direct embed (the dev server's native URL, e.g. via Portless/
          Tailscale) or the path-proxy fallback. Hover reveals what each
          mode means. Hidden when the iframe isn't actively showing
          anything (no point branding an empty pane). */}
      {isLive && (
        <span
          title={
            embedMode === 'direct'
              ? 'Direct embed — loading the dev server\'s native URL. Full fidelity.'
              : 'Proxy embed — routed through Flow. Complex apps may degrade (root-absolute paths, baked-in absolute URLs).'
          }
          className={cn(
            'flex h-7 items-center gap-1 rounded px-1.5 text-[10px] font-medium uppercase tracking-wide',
            embedMode === 'direct'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {embedMode === 'direct' ? <Zap size={10} /> : <RouteIcon size={10} />}
          {embedMode === 'direct' ? 'Direct' : 'Proxy'}
        </span>
      )}

      {/* URL strip — read-only, click to copy. */}
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Click to copy URL'}
        className={cn(
          'mx-1 flex h-7 flex-1 items-center truncate rounded bg-muted/50 px-2.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted',
          copied && 'text-foreground',
        )}
      >
        {copied ? 'Copied URL' : displayUrl}
      </button>

      <a
        href={newTabUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Open in new tab"
      >
        <ExternalLink size={13} />
      </a>

      {canControl && (
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
      )}
    </div>
  );
}

/**
 * Render-friendly form of the URL: absolute URLs pass through, relative
 * URLs (the path proxy) are shown verbatim so the user can see the
 * `/preview/<id>/` shape.
 */
function displayableUrl(url: string): string {
  return url;
}

/**
 * For copy-to-clipboard, we want the user to get something they can
 * paste into a browser address bar. Relative URLs need Flow's origin
 * prefixed; absolute URLs (direct embed) are already paste-ready.
 */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}
