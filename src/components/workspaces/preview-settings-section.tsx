'use client';

import { ExternalLink } from 'lucide-react';
import { usePortlessStatus } from '@/hooks/use-portless-status';
import { cn } from '@/lib/utils';
import type { WorkspaceRecord } from '@/db/types';

type Mode = 'auto' | 'command' | 'portless';

interface PreviewSettingsSectionProps {
  ws: Pick<WorkspaceRecord, 'slug' | 'previewMode' | 'portlessHostname'>;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  previewCommand: string;
  onPreviewCommandChange: (v: string) => void;
  previewPort: string;
  onPreviewPortChange: (v: string) => void;
  portlessHostname: string;
  onPortlessHostnameChange: (v: string) => void;
}

/**
 * Preview section of the workspace settings sheet.
 *
 * Single-source-of-truth UI:
 *   - Mode dropdown (auto-detect / command / portless).
 *   - Command-mode fields (preview command, port override).
 *   - Portless-mode field (hostname override).
 *   - Hint banner: "install Portless" if not detected; "switch to
 *     Portless" if detected-but-not-used; nothing if already in Portless.
 *
 * The mode dropdown value `auto` corresponds to `previewMode = null`
 * in the database — the resolver picks at runtime.
 */
export function PreviewSettingsSection({
  ws, mode, onModeChange, previewCommand, onPreviewCommandChange,
  previewPort, onPreviewPortChange, portlessHostname, onPortlessHostnameChange,
}: PreviewSettingsSectionProps) {
  const portlessStatusQuery = usePortlessStatus();
  const portlessInstalled = portlessStatusQuery.data?.installed ?? false;
  const portlessRunning = portlessStatusQuery.data?.proxyRunning ?? false;
  const derivedHostname = ws.slug;

  // Effective mode for the helper text under the dropdown.
  const effective: 'command' | 'portless' =
    mode === 'command' ? 'command'
      : mode === 'portless' ? 'portless'
        : portlessRunning ? 'portless' : 'command';

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
          Mode
        </label>
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as Mode)}
          className="w-full appearance-none rounded-md border border-border bg-background py-2 pl-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="auto">Auto-detect</option>
          <option value="command">Command</option>
          <option value="portless">Portless</option>
        </select>
        <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
          {mode === 'auto' ? (
            <>
              Resolves at runtime →
              {' '}<span className="font-medium text-foreground">{effective === 'portless' ? 'Portless' : 'Command'}</span>
              {' '}({portlessRunning ? 'Portless detected' : 'Portless not detected'}).
            </>
          ) : mode === 'command' ? (
            <>Flow spawns and supervises your dev server.</>
          ) : (
            <>Flow reads the route from Portless. Run <code className="font-mono">portless run</code> in the worktree to start it.</>
          )}
        </p>
      </div>

      {effective === 'command' ? (
        <>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Command
            </label>
            <input
              value={previewCommand}
              onChange={(e) => onPreviewCommandChange(e.target.value)}
              placeholder="pnpm dev"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
              Anything that prints a <code className="font-mono">localhost:PORT</code> line — pnpm dev, flask run, cargo run, python -m http.server.
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              Port (optional)
            </label>
            <input
              value={previewPort}
              onChange={(e) => onPreviewPortChange(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="auto-detect"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
              Override auto-detection if your dev server doesn&apos;t print its port on startup.
            </p>
          </div>
        </>
      ) : (
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Hostname
          </label>
          <div className="flex items-stretch gap-0 rounded-md border border-border bg-background focus-within:ring-1 focus-within:ring-primary">
            <input
              value={portlessHostname}
              onChange={(e) => onPortlessHostnameChange(e.target.value)}
              placeholder={derivedHostname}
              className="flex-1 rounded-md bg-transparent px-3 py-2 font-mono text-xs focus:outline-none"
            />
            <span className="flex items-center pr-3 font-mono text-xs text-muted-foreground">
              .localhost
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
            Defaults to <code className="font-mono">{derivedHostname}</code> for the main worktree;
            {' '}each linked worktree prepends its branch name. Override if you registered a different
            {' '}portless name.
          </p>
        </div>
      )}

      {/* Hint banners — install or upgrade. Hidden when in Portless mode. */}
      {effective === 'command' && !portlessInstalled && (
        <HintBanner
          tone="neutral"
          title="Try Portless for free worktree URLs"
          body={
            <>
              Cleaner URLs (<code className="font-mono">myapp.localhost</code>), automatic worktree isolation,
              {' '}and Tailscale sharing. Install with <code className="font-mono">npm i -g portless</code>.
            </>
          }
          link={{ href: 'https://portless.sh', label: 'portless.sh' }}
        />
      )}
      {effective === 'command' && portlessInstalled && portlessRunning && mode !== 'portless' && (
        <HintBanner
          tone="accent"
          title="Portless is running on this machine"
          body={
            <>
              Switch this workspace to Portless mode for cleaner URLs and free worktree isolation.
            </>
          }
          action={{
            label: 'Switch to Portless',
            onClick: () => onModeChange('portless'),
          }}
        />
      )}
    </div>
  );
}

interface HintBannerProps {
  tone: 'neutral' | 'accent';
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
  action?: { label: string; onClick: () => void };
}

function HintBanner({ tone, title, body, link, action }: HintBannerProps) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5 text-[11px] leading-snug',
        tone === 'accent'
          ? 'border-amber-500/30 bg-amber-500/10'
          : 'border-border bg-muted/30',
      )}
    >
      <p className={cn('font-semibold', tone === 'accent' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
        {title}
      </p>
      <p className="mt-1 text-muted-foreground">{body}</p>
      {link && (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {link.label}
          <ExternalLink size={9} />
        </a>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
