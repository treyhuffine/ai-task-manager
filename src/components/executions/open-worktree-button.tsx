'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Folder,
  Terminal,
  Code,
  Copy,
  Check,
  Loader2,
  Info,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fsApi, type OpenTarget, type InstalledApp } from '@/lib/api/fs';
import { cn } from '@/lib/utils';

interface OpenWorktreeButtonProps {
  /** Absolute path of the worktree to open. Component is a no-op when null. */
  path: string | null;
}

/** localStorage key for the user's last-used target — drives the main button. */
const LAST_TARGET_KEY = 'flow.openWorktree.lastTarget';

/** Loopback hostnames that imply same-machine browser → server. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * True when the browser is connecting from a non-loopback hostname —
 * i.e. it's almost certainly running on a different machine than the
 * server. We can detect direct remote access (LAN IP, public hostname),
 * but SSH-tunneled access still presents as `localhost` and is a known
 * blind spot. The penalty for false negatives is low: the spawn just
 * runs on the wrong machine and the user notices nothing happened.
 */
function useIsRemoteHost(): boolean {
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname;
    setRemote(!LOOPBACK_HOSTS.has(host));
  }, []);
  return remote;
}

/**
 * Lucide fallback icon for a given target. Used when the server can't
 * extract a real `.app` icon (non-macOS, or the bundle didn't yield
 * one). Sized to 14px to read at the same metrics as a 64×64 PNG
 * scaled to ~16px.
 */
function FallbackIcon({ target }: { target: OpenTarget }) {
  const iconClass = 'text-muted-foreground';
  switch (target) {
    case 'finder':
      return <Folder size={14} className={iconClass} />;
    case 'terminal':
    case 'iterm':
      return <Terminal size={14} className={iconClass} />;
    default:
      return <Code size={14} className={iconClass} />;
  }
}

/**
 * Renders an app icon: real `.app` icon when the server gave us one,
 * lucide fallback otherwise. Constant 16×16 box so menu items align
 * regardless of icon source.
 */
function AppIcon({ app }: { app: { target: OpenTarget; iconDataUrl: string | null } }) {
  if (app.iconDataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={app.iconDataUrl}
        alt=""
        className="w-4 h-4 object-contain"
        draggable={false}
      />
    );
  }
  return (
    <span className="w-4 h-4 flex items-center justify-center">
      <FallbackIcon target={app.target} />
    </span>
  );
}

/**
 * Read the last-used target from localStorage. Returns null on SSR (no
 * window) or when the stored value isn't one of the apps we currently
 * see installed (handles the user uninstalling an app between sessions).
 */
function readLastTarget(installed: InstalledApp[]): OpenTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LAST_TARGET_KEY) as OpenTarget | null;
    if (!stored) return null;
    return installed.some((a) => a.target === stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeLastTarget(target: OpenTarget): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_TARGET_KEY, target);
  } catch {
    // localStorage can throw in private mode — non-fatal, the button
    // just won't remember next time.
  }
}

/**
 * Split-button: the main click runs the user's preferred open target
 * (defaults to Reveal in Finder for first-time users; remembers the
 * last-used target after that). The chevron drops a menu of every
 * installed editor/terminal plus Copy path.
 *
 * Apps shown in the menu are detected server-side: macOS scans
 * `/Applications` for known `.app` bundles (and extracts each app's
 * real icon from the bundle), Linux/Windows probe the CLI command via
 * `which`/`where`. Apps that aren't installed don't appear.
 */
export function OpenWorktreeButton({ path }: OpenWorktreeButtonProps) {
  const [busy, setBusy] = useState<OpenTarget | 'copy' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [primaryTarget, setPrimaryTarget] = useState<OpenTarget>('finder');
  const isRemote = useIsRemoteHost();

  const { data: installedData } = useQuery({
    queryKey: ['fs', 'installed-apps'],
    queryFn: () => fsApi.installedApps(),
    staleTime: 5 * 60_000, // App install changes are rare.
    // No point detecting installed apps when we can't run them anyway.
    enabled: !isRemote,
  });
  const installed = useMemo(() => installedData?.apps ?? [], [installedData]);

  // Once we know what's installed, hydrate the primary target from
  // localStorage. Falls back to 'finder' (always present).
  useEffect(() => {
    if (!installed.length) return;
    const last = readLastTarget(installed);
    if (last) setPrimaryTarget(last);
  }, [installed]);

  const open = useCallback(
    async (target: OpenTarget, opts: { remember?: boolean } = { remember: true }) => {
      if (!path) return;
      setError(null);
      setBusy(target);
      try {
        const res = await fsApi.openIn(path, target);
        if (!res.ok) {
          const reasonMsg =
            res.reason === 'not_installed'
              ? "App isn't installed or its CLI command isn't on PATH"
              : res.reason === 'unsupported'
                ? 'Not supported on this platform'
                : res.message ?? 'Failed to open';
          setError(reasonMsg);
          setTimeout(() => setError(null), 3500);
          return;
        }
        if (opts.remember !== false) {
          writeLastTarget(target);
          setPrimaryTarget(target);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setTimeout(() => setError(null), 3500);
      } finally {
        setBusy(null);
      }
    },
    [path],
  );

  const copyPath = useCallback(() => {
    if (!path) return;
    setError(null);
    setBusy('copy');
    navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  }, [path]);

  if (!path) return null;

  // Remote browser → server: spawn would run on the wrong machine, so
  // we hide every "open in app" action and surface only Copy path with
  // a hint pointing the user at the host. Same shape as the local
  // split button so the header layout doesn't shift.
  if (isRemote) {
    return (
      <div className="relative inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={copyPath}
          disabled={busy === 'copy'}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium',
            'rounded-md border border-border bg-background',
            'text-foreground/80 hover:text-foreground hover:bg-muted/40',
            'transition-colors disabled:opacity-50',
          )}
          title="Copy worktree path"
        >
          {busy === 'copy' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : copied ? (
            <Check size={12} />
          ) : (
            <Copy size={12} />
          )}
          {copied ? 'Copied' : 'Copy path'}
        </button>
        <span
          className="flex items-center text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-help"
          title="You're viewing this from a remote browser. Open this URL on the host machine to launch apps there."
          aria-label="Remote viewer notice"
        >
          <Info size={12} />
        </span>
      </div>
    );
  }

  const primaryApp = installed.find((a) => a.target === primaryTarget);
  const primaryLabel = primaryApp?.label ?? 'Open';
  const isBusyPrimary = busy === primaryTarget;

  return (
    <div className="relative inline-flex items-stretch">
      <button
        type="button"
        onClick={() => open(primaryTarget)}
        disabled={isBusyPrimary}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium',
          'rounded-l-md border border-r-0 border-border bg-background',
          'text-foreground/80 hover:text-foreground hover:bg-muted/40',
          'transition-colors disabled:opacity-50',
        )}
        title={primaryLabel}
      >
        {isBusyPrimary ? (
          <Loader2 size={12} className="animate-spin" />
        ) : primaryApp ? (
          <AppIcon app={primaryApp} />
        ) : (
          <FallbackIcon target={primaryTarget} />
        )}
        <span className="truncate max-w-[120px]">{shortLabel(primaryLabel)}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center justify-center px-1.5',
              'rounded-r-md border border-border bg-background',
              'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              'transition-colors',
            )}
            aria-label="More open options"
            title="More open options"
          >
            <ChevronDown size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px] w-auto">
          {installed.map((app) => (
            <DropdownMenuItem
              key={app.target}
              onClick={() => open(app.target)}
              disabled={busy === app.target}
              className="text-[12px]"
            >
              <AppIcon app={app} />
              <span className="flex-1">{app.label}</span>
              {busy === app.target && <Loader2 size={11} className="animate-spin opacity-70" />}
              {primaryTarget === app.target && (
                <Check size={11} className="opacity-50" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={copyPath} className="text-[12px]">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span className="flex-1">{copied ? 'Copied!' : 'Copy path'}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <div className="absolute right-0 top-full mt-1 z-50 px-2 py-1 rounded-md bg-destructive/10 border border-destructive/30 text-[10px] text-destructive whitespace-nowrap shadow-sm">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Trim the menu label to a short button form: "Open in VS Code" → "VS
 * Code", "Reveal in Finder" → "Finder". Keeps the main button compact
 * without losing the recognizable app name.
 */
function shortLabel(label: string): string {
  return label
    .replace(/^Open in\s+/i, '')
    .replace(/^Reveal in\s+/i, '');
}
