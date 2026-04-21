import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Bot,
  Check,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Sparkles,
  Code2,
  RefreshCw,
} from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { authFetch } from '@/lib/api/client';
import type { WizardState, AgentHarness, AgentAuthReport } from './types';

const HARNESSES: Array<{
  id: AgentHarness;
  name: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  loginCmd: string;
  envHint: string;
}> = [
  {
    id: 'claude',
    name: 'Claude Code',
    hint: 'Local Claude agent',
    icon: Sparkles,
    loginCmd: 'claude login',
    envHint: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'codex',
    name: 'Codex',
    hint: 'Local Codex agent',
    icon: Code2,
    loginCmd: 'codex login',
    envHint: 'OPENAI_API_KEY',
  },
];

const HARNESS_BY_ID = Object.fromEntries(HARNESSES.map((h) => [h.id, h])) as Record<
  AgentHarness,
  (typeof HARNESSES)[number]
>;

export function StepAgent({
  state,
  update,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}) {
  const harness = HARNESS_BY_ID[state.agentHarness];
  // Track the harness the in-flight request is for, so a fast switch doesn't
  // let a stale response overwrite the fresh one.
  const inFlight = useRef<AgentHarness | null>(null);

  const runCheck = useCallback(
    async (target: AgentHarness) => {
      inFlight.current = target;
      update({
        agentAuth: { phase: 'checking', acceptsApiKeyBilling: false },
      });
      try {
        const res = await authFetch('/api/agent/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ harness: target }),
        });
        if (inFlight.current !== target) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          update({
            agentAuth: {
              phase: 'error',
              error: body.error ?? `Check failed (${res.status})`,
              acceptsApiKeyBilling: false,
            },
          });
          return;
        }
        const report = (await res.json()) as AgentAuthReport;
        update({
          agentAuth: { phase: 'ready', report, acceptsApiKeyBilling: false },
        });
      } catch (err) {
        if (inFlight.current !== target) return;
        update({
          agentAuth: {
            phase: 'error',
            error: err instanceof Error ? err.message : 'Check failed',
            acceptsApiKeyBilling: false,
          },
        });
      }
    },
    [update],
  );

  // Auto-check when the selected harness changes (including first mount).
  useEffect(() => {
    void runCheck(state.agentHarness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.agentHarness]);

  const selectHarness = (id: AgentHarness) => {
    if (id === state.agentHarness) return;
    // Reset model when switching since listModels differs per harness.
    update({ agentHarness: id, agentModel: '' });
  };

  const acceptApiKey = (checked: boolean) => {
    update({
      agentAuth: { ...state.agentAuth, acceptsApiKeyBilling: checked },
    });
  };

  const models = state.agentAuth.report?.models ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex shrink-0 size-10 items-center justify-center rounded-md bg-muted">
          <Bot className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Pick your agent</h2>
          <p className="text-sm text-muted-foreground">
            {APP_NAME} runs agent tasks through one of these coding CLIs. Both use their own login.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Agent</div>
        <div className="grid grid-cols-2 gap-2">
          {HARNESSES.map((h) => {
            const selected = state.agentHarness === h.id;
            const Icon = h.icon;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => selectHarness(h.id)}
                className={`relative flex flex-col items-center gap-2 rounded-lg border p-5 text-center transition-colors ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <span className="absolute top-2 right-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                  Recommended
                </span>
                <Icon className="size-6" />
                <span className="text-sm font-medium">{h.name}</span>
                <span className="text-xs text-muted-foreground">{h.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Model</div>
        <select
          className="h-10 w-full rounded-md border border-border bg-input/30 px-3 text-sm"
          value={state.agentModel}
          onChange={(e) => update({ agentModel: e.target.value })}
        >
          <option value="">Default</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Leave on Default to always use the agent&apos;s latest recommended model.
        </p>
      </div>

      <AuthStatus
        state={state}
        harness={harness}
        onRecheck={() => void runCheck(state.agentHarness)}
        onAccept={acceptApiKey}
      />
    </div>
  );
}

// ── Auth status card ────────────────────────────────────────────────────

function AuthStatus({
  state,
  harness,
  onRecheck,
  onAccept,
}: {
  state: WizardState;
  harness: (typeof HARNESSES)[number];
  onRecheck: () => void;
  onAccept: (checked: boolean) => void;
}) {
  const auth = state.agentAuth;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Authentication</div>
          <div className="truncate text-xs text-muted-foreground">
            Verifies the agent CLI is installed and authenticated.
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecheck}
          disabled={auth.phase === 'checking'}
        >
          {auth.phase === 'checking' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {auth.phase === 'checking' ? 'Checking…' : 'Recheck'}
        </Button>
      </div>

      {auth.phase === 'checking' && (
        <p className="mt-3 text-sm text-muted-foreground">Inspecting your environment…</p>
      )}

      {auth.phase === 'error' && (
        <div className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4" />
          <span>{auth.error ?? 'Check failed'}</span>
        </div>
      )}

      {auth.phase === 'ready' && auth.report && (
        <ReadyState report={auth.report} harness={harness} auth={auth} onAccept={onAccept} />
      )}
    </div>
  );
}

function ReadyState({
  report,
  harness,
  auth,
  onAccept,
}: {
  report: AgentAuthReport;
  harness: (typeof HARNESSES)[number];
  auth: WizardState['agentAuth'];
  onAccept: (checked: boolean) => void;
}) {
  const { hasSubscription, hasApiKey, apiKeyVar, keychainUnknown } = report;

  // State: subscription present (with or without API key).
  if (hasSubscription) {
    return (
      <>
        <div className="mt-3 flex items-start gap-2 text-sm text-emerald-400">
          <Check className="mt-0.5 size-4" />
          <span>Subscription active — ready to go</span>
        </div>
        {hasApiKey && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Both a subscription and an API key ({apiKeyVar}) are configured. Which one gets used
              depends on {harness.name}&apos;s own precedence rules — unset {apiKeyVar} to force
              the subscription.
            </span>
          </div>
        )}
      </>
    );
  }

  // State: no subscription, but API key present — explicit opt-in to proceed.
  if (hasApiKey) {
    return (
      <>
        <div className="mt-3 flex items-start gap-2 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 size-4" />
          <span>
            No active subscription. An API key ({apiKeyVar}) is configured — continuing will bill
            your {harness.name} API account directly (metered).
          </span>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={auth.acceptsApiKeyBilling}
            onChange={(e) => onAccept(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>Continue with API key billing (I don&apos;t have a subscription)</span>
        </label>
      </>
    );
  }

  // State: nothing detected.
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 size-4" />
        <span>No authentication found.</span>
      </div>
      <div className="text-muted-foreground">
        Sign in with{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.loginCmd}</code>, or set{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.envHint}</code> in your
        environment.
        {keychainUnknown && (
          <span className="mt-1 block text-xs">
            (Note: we can&apos;t silently read macOS keychain — if you&apos;ve already run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.loginCmd}</code>,
            continue anyway and it should work.)
          </span>
        )}
      </div>
    </div>
  );
}
