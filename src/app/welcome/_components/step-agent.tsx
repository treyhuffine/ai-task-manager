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
  Package,
} from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { modelsForProvider } from '@/lib/agent-options';
import { api, ApiError } from '@/lib/api/client';
import type {
  WizardState,
  WizardUpdate,
  AgentHarness,
  AgentAuthReport,
  AgentVerifyState,
} from './types';
import type { AgentVerifyResponse } from '@/app/api/agent/verify/route';

const HARNESSES: Array<{
  id: AgentHarness;
  name: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  loginCmd: string;
  envHint: string;
  installHint: string;
}> = [
  {
    id: 'claude',
    name: 'Claude Code',
    hint: 'Local Claude agent',
    icon: Sparkles,
    loginCmd: 'claude login',
    envHint: 'ANTHROPIC_API_KEY',
    installHint: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    name: 'Codex',
    hint: 'Local Codex agent',
    icon: Code2,
    loginCmd: 'codex login',
    envHint: 'OPENAI_API_KEY',
    installHint: 'npm install -g @openai/codex',
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
  update: WizardUpdate;
}) {
  const harness = HARNESS_BY_ID[state.agentHarness];
  // Track the harness each in-flight request is for so a fast switch can't
  // let a stale response overwrite fresh state.
  const authInFlight = useRef<AgentHarness | null>(null);
  const verifyInFlight = useRef<AgentHarness | null>(null);

  // Auth and verify fire in parallel — verify is the slow one (real LLM
  // round-trip, ~2-10s) and auth is fast (CLI status subcommand). Running
  // serial meant auth's latency stacked on top of verify's. Each writes only
  // its own slice of agentAuth via functional updates so the results compose.
  const runAuthOnly = useCallback(
    async (target: AgentHarness, options: { fresh?: boolean } = {}) => {
      try {
        const report = await api.post<AgentAuthReport>('/agent/auth', {
          harness: target,
          fresh: options.fresh === true,
        });
        if (authInFlight.current !== target) return;
        update((s) => ({ agentAuth: { ...s.agentAuth, phase: 'ready', report } }));
      } catch (err) {
        if (authInFlight.current !== target) return;
        const message =
          err instanceof ApiError
            ? (err.body as { error?: string } | null)?.error ?? `Check failed (${err.status})`
            : err instanceof Error
            ? err.message
            : 'Check failed';
        update((s) => ({
          agentAuth: { ...s.agentAuth, phase: 'error', error: message },
        }));
      }
    },
    [update],
  );

  const runVerifyOnly = useCallback(
    async (target: AgentHarness) => {
      try {
        const result = await api.post<AgentVerifyResponse>('/agent/verify', {
          harness: target,
        });
        if (verifyInFlight.current !== target) return;
        update((s) => ({
          agentAuth: {
            ...s.agentAuth,
            verify: {
              phase: result.ok ? 'ok' : 'failed',
              result,
              error: result.ok ? undefined : result.errorMessage ?? 'Agent did not respond',
            },
          },
        }));
      } catch (err) {
        if (verifyInFlight.current !== target) return;
        const message =
          err instanceof ApiError
            ? (err.body as { error?: string } | null)?.error ?? `Verify failed (${err.status})`
            : err instanceof Error
            ? err.message
            : 'Verify failed';
        update((s) => ({
          agentAuth: {
            ...s.agentAuth,
            verify: { phase: 'failed', error: message },
          },
        }));
      }
    },
    [update],
  );

  const runCheck = useCallback(
    (target: AgentHarness, options: { fresh?: boolean } = {}) => {
      authInFlight.current = target;
      verifyInFlight.current = target;
      // Reset both slices together so the UI shows a clean "checking + verifying"
      // state without a stale report bleeding through from the previous harness.
      update({
        agentAuth: {
          phase: 'checking',
          acceptsApiKeyBilling: false,
          verify: { phase: 'running' },
        },
      });
      void runAuthOnly(target, options);
      void runVerifyOnly(target);
    },
    [update, runAuthOnly, runVerifyOnly],
  );

  // Auto-check when the selected harness changes (including first mount).
  useEffect(() => {
    runCheck(state.agentHarness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.agentHarness]);

  const selectHarness = (id: AgentHarness) => {
    if (id === state.agentHarness) return;
    // Reset the model — the prior pick belongs to a different catalog.
    update({ agentHarness: id, agentModel: null });
  };

  const acceptApiKey = (checked: boolean) => {
    update((s) => ({
      agentAuth: { ...s.agentAuth, acceptsApiKeyBilling: checked },
    }));
  };

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

      <AuthStatus
        state={state}
        harness={harness}
        onRecheck={() => void runCheck(state.agentHarness, { fresh: true })}
        onAccept={acceptApiKey}
      />

      {state.agentAuth.report?.binary.installed && (
        <ModelChoice
          harness={state.agentHarness}
          selected={state.agentModel}
          onSelect={(id) => update({ agentModel: id })}
        />
      )}
    </div>
  );
}

// ── Default-model picker ────────────────────────────────────────────────

function ModelChoice({
  harness,
  selected,
  onSelect,
}: {
  harness: AgentHarness;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const models = modelsForProvider(harness);
  const options: Array<{ id: string | null; label: string; hint?: string }> = [
    { id: null, label: 'Default', hint: 'Let the agent pick' },
    ...models,
  ];
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Default model</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id ?? 'default'}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <span className="text-sm font-medium">{opt.label}</span>
              {opt.hint && <span className="text-xs text-muted-foreground">{opt.hint}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Change this anytime in settings.</p>
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
  const busy = auth.phase === 'checking' || auth.verify.phase === 'running';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Authentication</div>
          <div className="truncate text-xs text-muted-foreground">
            Confirms the CLI is installed, authenticated, and responds to a request.
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRecheck} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {auth.phase === 'checking'
            ? 'Checking…'
            : auth.verify.phase === 'running'
              ? 'Verifying…'
              : 'Recheck'}
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
  // State: CLI binary not installed. Everything else is moot.
  if (!report.binary.installed) {
    return (
      <div className="mt-3 space-y-2 text-sm">
        <div className="flex items-start gap-2 text-destructive">
          <Package className="mt-0.5 size-4" />
          <span>{harness.name} CLI is not installed.</span>
        </div>
        {report.binary.error && (
          <div className="text-xs text-muted-foreground">{report.binary.error}</div>
        )}
        <div className="text-muted-foreground">
          Install:{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.installHint}</code>
        </div>
      </div>
    );
  }

  const { hasSubscription, hasApiKey, hasBedrock, apiKeyVar, identity } = report;

  // State: subscription present (with or without API key).
  if (hasSubscription) {
    return (
      <>
        <div className="mt-3 flex items-start gap-2 text-sm text-emerald-400">
          <Check className="mt-0.5 size-4" />
          <span>{subscriptionReadyLine(identity)}</span>
        </div>
        {hasApiKey && <SubPlusKeyNote harness={harness.id} apiKeyVar={apiKeyVar} />}
        <VerifyLine verify={auth.verify} harnessName={harness.name} />
      </>
    );
  }

  // State: Bedrock configured (no subscription). Bedrock is metered but
  // implicitly opted into via AWS — no acknowledgement needed.
  if (hasBedrock) {
    return (
      <>
        <div className="mt-3 flex items-start gap-2 text-sm text-emerald-400">
          <Check className="mt-0.5 size-4" />
          <span>Using AWS Bedrock</span>
        </div>
        <VerifyLine verify={auth.verify} harnessName={harness.name} />
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
            No active subscription. An API key ({apiKeyVar}) is configured. Continuing will bill
            your {harness.name} API account directly (metered).
          </span>
        </div>
        <VerifyLine verify={auth.verify} harnessName={harness.name} />
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

  // State: nothing detected — still run verify to see if it works anyway.
  // If the real round-trip succeeds we trust that over the detection miss.
  const verifyOk = auth.verify.phase === 'ok';
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div
        className={`flex items-start gap-2 ${verifyOk ? 'text-muted-foreground' : 'text-amber-400'}`}
      >
        <AlertCircle className="mt-0.5 size-4" />
        <span>
          {verifyOk
            ? "Didn't detect a known auth path, but a test request succeeded."
            : "Didn't detect an auth path, running a test request to confirm."}
        </span>
      </div>
      <VerifyLine verify={auth.verify} harnessName={harness.name} />
      {!verifyOk && (
        <div className="text-muted-foreground">
          If the test fails, sign in with{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.loginCmd}</code> or set{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.envHint}</code> in your
          environment.
        </div>
      )}
    </div>
  );
}

function VerifyLine({
  verify,
  harnessName,
}: {
  verify: AgentVerifyState;
  harnessName: string;
}) {
  if (verify.phase === 'idle' || verify.phase === 'skipped') return null;

  if (verify.phase === 'running') {
    return (
      <div className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
        <Loader2 className="mt-0.5 size-4 animate-spin" />
        <span>Verifying…</span>
      </div>
    );
  }

  if (verify.phase === 'ok') {
    return (
      <div className="mt-2 flex items-start gap-2 text-sm text-emerald-400">
        <Check className="mt-0.5 size-4" />
        <span>{harnessName} verified</span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4" />
      <span>Test request failed: {verify.error ?? 'unknown error'}</span>
    </div>
  );
}

function subscriptionReadyLine(identity: AgentAuthReport['identity']): string {
  if (!identity?.email && !identity?.subscriptionType) return 'Subscription active, ready to go';
  const parts: string[] = [];
  if (identity?.email) parts.push(`Signed in as ${identity.email}`);
  if (identity?.subscriptionType) parts.push(`${identity.subscriptionType} plan`);
  return parts.join(', ');
}

// When both a subscription and an API key are configured, CLI behavior
// differs by harness:
//   - Claude CLI: API key silently wins, billing at API rates (footgun).
//   - Codex CLI: prefers subscription when ~/.codex/auth.json exists
//     (openai/codex#2733, #3286), API key is ignored.
// We warn loudly for Claude and just note it for Codex.
function SubPlusKeyNote({
  harness,
  apiKeyVar,
}: {
  harness: AgentHarness;
  apiKeyVar: string | null;
}) {
  if (harness === 'claude') {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          Heads up: {apiKeyVar} will override your subscription for Claude Code. Continuing as-is
          bills at API rates. Unset {apiKeyVar} to use your subscription.
        </span>
      </div>
    );
  }
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      Your subscription will be used. {apiKeyVar} is also set but Codex prefers subscription when
      both are available.
    </div>
  );
}
