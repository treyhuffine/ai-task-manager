'use client';

import { useState } from 'react';
import {
  Sparkles,
  Code2,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  PROVIDERS,
  findProvider,
  modelsForProvider,
  type ProviderId,
} from '@/lib/agent-options';
import {
  useAgentConnection,
  useRecheckAgentConnection,
  type AgentConnection,
} from '@/hooks/use-agent-connection';
import { cn } from '@/lib/utils';

interface ProviderModelSelectorProps {
  /** Current provider (user_state.defaultAgentHarness vocabulary). */
  harness: ProviderId;
  /** Current default model id, or null = let the provider pick. */
  model: string | null;
  onChange: (next: { harness: ProviderId; model: string | null }) => void;
  className?: string;
}

/**
 * Two-level provider + model picker. The default ("models") view shows the
 * current provider's connection state + its models; the "Change provider"
 * affordance drops to a provider list (with per-provider connection badges
 * and coming-soon rows) and a back button. When a provider isn't connected
 * it surfaces the same login/check flow as onboarding. Fully controlled —
 * the parent decides where the choice persists (onboarding state, user_state
 * defaults, …).
 */
export function ProviderModelSelector({ harness, model, onChange, className }: ProviderModelSelectorProps) {
  const [view, setView] = useState<'models' | 'providers'>('models');

  if (view === 'providers') {
    return (
      <ProvidersView
        current={harness}
        onBack={() => setView('models')}
        onPick={(id) => {
          // Switching provider resets the model to "provider picks" — the old
          // model id belongs to a different catalog.
          onChange({ harness: id, model: null });
          setView('models');
        }}
        className={className}
      />
    );
  }

  const provider = findProvider(harness) ?? PROVIDERS[0];
  const models = modelsForProvider(harness);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Current provider → tap to change */}
      <button
        type="button"
        onClick={() => setView('providers')}
        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card/40 p-3 text-left transition-colors hover:bg-muted/40"
      >
        <ProviderIcon id={provider.id} />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">{provider.name}</div>
          <div className="text-[11px] text-muted-foreground/80">Change provider</div>
        </div>
        <ConnectionBadge harness={harness} className="ml-auto" />
        <ChevronRight size={14} className="flex-shrink-0 text-muted-foreground/50" />
      </button>

      <ConnectionPanel harness={harness} />

      {/* Model list */}
      <div className="rounded-md border border-border bg-card/40 p-1">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Default model
        </div>
        <ModelRow
          active={model === null}
          label="Default"
          hint="Let the agent pick its best model."
          onClick={() => onChange({ harness, model: null })}
        />
        {models.map((m) => (
          <ModelRow
            key={m.id}
            active={model === m.id}
            label={m.label}
            hint={m.hint}
            onClick={() => onChange({ harness, model: m.id })}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Providers view ───────────────────────────────────────────

function ProvidersView({
  current,
  onBack,
  onPick,
  className,
}: {
  current: ProviderId;
  onBack: () => void;
  onPick: (id: ProviderId) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={13} /> Back
      </button>
      <div className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Choose a provider
      </div>
      {PROVIDERS.map((p) => (
        <ProviderRow key={p.id} id={p.id} selected={p.id === current} onSelect={() => onPick(p.id)} />
      ))}
    </div>
  );
}

function ProviderRow({ id, selected, onSelect }: { id: ProviderId; selected: boolean; onSelect: () => void }) {
  const provider = findProvider(id)!;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border p-3 text-left transition-colors',
        selected ? 'border-primary/50 bg-primary/5' : 'border-border bg-card/40 hover:bg-muted/40',
      )}
    >
      <ProviderIcon id={id} />
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-foreground">{provider.name}</div>
        <div className="text-[11px] text-muted-foreground/80">{provider.blurb}</div>
      </div>
      <ConnectionBadge harness={id} className="ml-auto" />
      {selected && <Check size={14} className="flex-shrink-0 text-primary" strokeWidth={3} />}
    </button>
  );
}

// ─── Connection status ────────────────────────────────────────

function ConnectionBadge({ harness, className }: { harness: ProviderId; className?: string }) {
  const { connection, isLoading } = useAgentConnection(harness);
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

function badgeMeta(c: AgentConnection): { text: string; cls: string; dot: string } {
  switch (c.status) {
    case 'subscription':
      return { text: 'Subscription', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'bedrock':
      return { text: 'Bedrock', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'api_key':
      return { text: 'API key', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' };
    case 'not_installed':
      return { text: 'Not installed', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' };
    default:
      return { text: 'Not connected', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' };
  }
}

/**
 * Setup affordance shown when the current provider isn't connected (or is
 * connected only via a metered API key). Mirrors the onboarding check: shows
 * the login/install command and a "Check again" button that force-refreshes
 * the auth read.
 */
function ConnectionPanel({ harness }: { harness: ProviderId }) {
  const provider = findProvider(harness)!;
  const { connection, isLoading } = useAgentConnection(harness);
  const recheck = useRecheckAgentConnection();

  if (isLoading) return null;

  // Connected via subscription/bedrock — nothing to prompt.
  if (connection.connected && !connection.metered) {
    if (connection.email) {
      return (
        <p className="px-0.5 text-[11px] text-muted-foreground/80">
          Signed in as <span className="font-medium text-foreground/80">{connection.email}</span>
          {connection.subscriptionType ? ` — ${connection.subscriptionType} plan` : ''}.
        </p>
      );
    }
    return null;
  }

  const notInstalled = connection.status === 'not_installed';
  const metered = connection.metered;

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
        ) : metered ? (
          <>
            {provider.apiKeyVar} is set, so turns bill the API directly. Run{' '}
            <span className="font-mono text-foreground/80">{provider.loginCmd}</span> to use your subscription
            instead.
          </>
        ) : (
          <>
            Sign in to use your subscription, then check again. Or set{' '}
            <span className="font-mono text-foreground/80">{provider.apiKeyVar}</span> to bill the API.
          </>
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

// ─── Bits ─────────────────────────────────────────────────────

function ProviderIcon({ id }: { id: ProviderId }) {
  const Icon = id === 'codex' ? Code2 : Sparkles;
  return (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
      <Icon size={15} className="text-primary" />
    </span>
  );
}

function ModelRow({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted/50',
      )}
    >
      <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {active && <Check size={12} className="text-primary" strokeWidth={3} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/80">{hint}</div>}
      </div>
    </button>
  );
}
