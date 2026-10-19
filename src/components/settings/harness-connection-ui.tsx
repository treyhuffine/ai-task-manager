'use client';

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { isDarkBrandMark } from '@/components/integrations/integration-logo';
import { findProvider, type ProviderId } from '@/lib/harness/options';
import { harnessDefinition } from '@/lib/harness/registry';
import {
  useHarnessConnection,
  useRecheckHarnessConnection,
  type HarnessConnection,
} from '@/hooks/use-harness-connection';
import { cn } from '@/lib/utils';
import { HARNESS_LOGOS, type HarnessLogo } from './harness-logo-data';

/**
 * Shared building blocks for surfacing agent-provider connection state — the
 * subscription/API-key/login detection the onboarding wizard pioneered.
 * Reused by the settings selector (ProviderModelSelector) and the composer's
 * provider switcher so there's exactly one connect/check UI.
 */

/** The brand mark a harness is drawn with everywhere, chosen in its registry entry. */
export function harnessLogo(id: ProviderId): HarnessLogo {
  return HARNESS_LOGOS[harnessDefinition(id).icon];
}

/** A harness's real logo, in the current text color so it takes its surroundings' tint. */
export function HarnessIcon({ id, size = 16, className }: { id: ProviderId; size?: number; className?: string }) {
  const logo = harnessLogo(id);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      role="img"
      aria-label={logo.title}
      className={cn('shrink-0', className)}
    >
      <path d={logo.path} fillRule={logo.evenOdd ? 'evenodd' : undefined} clipRule={logo.evenOdd ? 'evenodd' : undefined} />
    </svg>
  );
}

/** The logo on a tile, in its brand color. Near-black marks take the text color so they show in dark mode. */
export function ProviderIcon({ id, size = 15 }: { id: ProviderId; size?: number }) {
  const { hex } = harnessLogo(id);
  const dark = isDarkBrandMark(hex);
  return (
    <span
      className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 ring-1 ring-inset ring-border/50',
        dark && 'text-foreground',
      )}
      style={dark ? undefined : { color: `#${hex}` }}
    >
      <HarnessIcon id={id} size={size} />
    </span>
  );
}

export function ConnectionBadge({ harness, className }: { harness: ProviderId; className?: string }) {
  const { connection, isLoading } = useHarnessConnection(harness);
  if (isLoading) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[10.5px] text-muted-foreground/70', className)}>
        <Loader2 size={11} className="animate-spin" /> Checking…
      </span>
    );
  }
  const meta = badgeMeta(connection);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium',
        meta.cls,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.text}
    </span>
  );
}

function badgeMeta(c: HarnessConnection): { text: string; cls: string; dot: string } {
  switch (c.status) {
    case 'subscription':
      return { text: 'Subscription', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'bedrock':
      return { text: 'Bedrock', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'api_key':
      return { text: 'API key', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' };
    case 'configured':
      return { text: 'Connected', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'not_installed':
      return { text: 'Not installed', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' };
    default:
      return { text: 'Not connected', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' };
  }
}

/**
 * Setup affordance shown when a provider isn't connected (or is connected
 * only via a metered API key). Shows the login/install command and a "Check
 * again" button that force-refreshes the auth read. Renders nothing when the
 * provider is cleanly connected via subscription/bedrock (pass
 * `showSignedIn` to surface the signed-in line instead).
 */
export function ConnectionPanel({
  harness,
  showSignedIn = false,
}: {
  harness: ProviderId;
  showSignedIn?: boolean;
}) {
  const provider = findProvider(harness)!;
  const { connection, isLoading } = useHarnessConnection(harness);
  const recheck = useRecheckHarnessConnection();

  if (isLoading) return null;

  if (connection.connected && !connection.metered) {
    if (showSignedIn && connection.email) {
      return (
        <p className="px-0.5 text-[11px] text-muted-foreground/80">
          Signed in as <span className="font-medium text-foreground/80">{connection.email}</span>
          {connection.subscriptionType ? `, ${connection.subscriptionType} plan` : ''}.
        </p>
      );
    }
    return null;
  }

  const notInstalled = connection.status === 'not_installed';
  const metered = connection.metered;
  // Empty for a harness where a bare environment variable is not a way in
  // (OpenCode, Antigravity). The live report still names one when it is.
  const apiKeyVar = connection.apiKeyVar ?? provider.apiKeyVar;

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border p-3 text-[11.5px]',
        metered ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-card/40',
      )}
    >
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <AlertTriangle size={13} className="text-amber-500" />
        {notInstalled
          ? `${provider.name} isn't installed`
          : metered
            ? `${provider.name}: using a metered API key`
            : `No subscription detected for ${provider.name}`}
      </div>
      <p className="text-muted-foreground/85">
        {notInstalled ? (
          <>Install the CLI, then check again:</>
        ) : harness === 'opencode' ? (
          <>Connect at least one upstream provider below, then check again.</>
        ) : metered && !provider.apiKeyVar ? (
          // The variable only bills because the CLI's own settings opted into
          // it (Antigravity's `"modelProvider": "gemini"`), so signing in alone
          // would not change anything.
          <>
            {apiKeyVar} is set and {provider.name} is configured to use it, so turns bill the API
            directly. Change that in {provider.name}&apos;s own settings to use your subscription instead.
          </>
        ) : metered ? (
          <>
            {apiKeyVar} is set, so turns bill the API directly. Run{' '}
            <span className="font-mono text-foreground/80">{provider.loginCmd}</span> to use your subscription
            instead.
          </>
        ) : apiKeyVar ? (
          <>
            Sign in to use your subscription, then check again. Or set{' '}
            <span className="font-mono text-foreground/80">{apiKeyVar}</span> to bill the API.
          </>
        ) : (
          <>Sign in to use your subscription, then check again.</>
        )}
      </p>
      <code className="block rounded bg-muted/70 px-2 py-1 font-mono text-[11px] text-foreground/90">
        {notInstalled ? provider.installHint : provider.loginCmd}
      </code>
      <button
        type="button"
        onClick={() => recheck.mutate(harness)}
        disabled={recheck.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
      >
        {recheck.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Check again
      </button>
    </div>
  );
}
