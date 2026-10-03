'use client';

import { CursorCredentialPanel } from '@/components/settings/cursor-credential-panel';
import { HarnessPermissionNotice } from '@/components/settings/harness-permission-notice';
import { HarnessPicker } from '@/components/settings/harness-picker';
import { OpenCodeProviderPanel } from '@/components/settings/opencode-provider-panel';
import { Button } from '@/components/ui/button';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { apiErrorBody, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { defaultModelFor } from '@/lib/harness/options';
import { DEFAULT_HARNESS, HARNESS_IDS, KNOWN_HARNESS_IDS, harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import type { HarnessAuthResponse } from '@/lib/server/operations/harness/auth';
import type { HarnessVerifyResponse } from '@/lib/server/operations/harness/verify';
import { trpcClient } from '@/lib/trpc/client';
import {
	AlertCircle,
	AlertTriangle,
	Check,
	Loader2,
	Package,
	RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Setting up the harness Ri thinks with: pick a coding CLI, check its
 * sign-in, run one real request to prove it answers, pick a default model,
 * and (when only an API key is there) agree to metered billing. It was the
 * `/welcome` wizard's harness step. It now appears in the main chat's first
 * run, only when the background check (`use-harness-check.ts`) couldn't set
 * a harness up on its own (docs/main-chat-onboarding.md).
 */

/** Wire shape returned by /api/harness/auth. */
export type HarnessAuthReport = HarnessAuthResponse;

export interface HarnessVerifyState {
  phase: 'idle' | 'running' | 'ok' | 'failed' | 'skipped';
  result?: HarnessVerifyResponse;
  error?: string;
}

export interface HarnessAuthState {
  phase: 'idle' | 'checking' | 'ready' | 'error';
  report?: HarnessAuthReport;
  error?: string;
  /** The real round trip that follows the fast auth check. */
  verify: HarnessVerifyState;
  /** Agreement to metered API-key billing, needed when there's no subscription. */
  acceptsApiKeyBilling: boolean;
}

export interface HarnessSetupState {
  harness: HarnessId;
  /** Explicit default model id for the chosen harness. */
  model: string;
  harnessAuth: HarnessAuthState;
}

export type HarnessSetupUpdate = (
  patch: Partial<HarnessSetupState> | ((s: HarnessSetupState) => Partial<HarnessSetupState>),
) => void;

export function initialHarnessSetup(harness: HarnessId = DEFAULT_HARNESS): HarnessSetupState {
  return {
    harness,
    model: defaultModelFor(harness),
    harnessAuth: { phase: 'idle', acceptsApiKeyBilling: false, verify: { phase: 'idle' } },
  };
}

/**
 * Whether this setup can be saved: the CLI is installed, one real request
 * answered (the truth, whatever detection said), a model is picked, and a
 * key-only setup has agreed to metered billing.
 */
export function harnessSetupReady(state: HarnessSetupState): boolean {
  if (!state.harness || !state.model) return false;
  const a = state.harnessAuth;
  if (a.phase !== 'ready' || !a.report) return false;
  if (!a.report.binary.installed) return false;
  if (a.verify.phase !== 'ok') return false;
  const { hasSubscription, hasApiKey, hasBedrock } = a.report;
  if (!hasSubscription && !hasBedrock && hasApiKey && !a.acceptsApiKeyBilling) return false;
  return true;
}

/**
 * The onboarding card copy for each harness. Name, sign-in and install
 * commands and the icon come from the registry. `envHint` is the alternative
 * to signing in, or null where the harness has none worth suggesting.
 */
const HARNESS_COPY: Record<HarnessId, { hint: string; envHint: string | null }> = {
  claude: { hint: 'Claude models with your Anthropic account', envHint: 'ANTHROPIC_API_KEY' },
  codex: { hint: 'OpenAI models with your ChatGPT account', envHint: 'OPENAI_API_KEY' },
  cursor: { hint: 'Cursor models, including Grok when available', envHint: 'CURSOR_API_KEY' },
  opencode: { hint: 'Models from your OpenCode providers', envHint: 'Configure a provider below' },
  // Signing in through `agy` is the way in. An API key needs a settings
  // change in the CLI as well, so it is not offered as the easy alternative.
  antigravity: { hint: 'Gemini models with your Google account', envHint: null },
};

interface HarnessCard {
  id: HarnessId;
  name: string;
  hint: string;
  loginCmd: string;
  envHint: string | null;
  installHint: string;
}

const HARNESSES: HarnessCard[] = KNOWN_HARNESS_IDS.map((id) => {
  const definition = harnessDefinition(id);
  return {
    id,
    name: definition.name,
    ...HARNESS_COPY[id],
    loginCmd: definition.loginCommand ?? '',
    installHint: definition.installHint,
  };
});

const HARNESS_BY_ID = Object.fromEntries(HARNESSES.map((h) => [h.id, h])) as Record<HarnessId, HarnessCard>;

/** "Claude Code", "Codex", ... */
export function harnessName(id: HarnessId): string {
  return HARNESS_BY_ID[id]?.name ?? id;
}

export function HarnessSetup({
  state,
  update,
}: {
  state: HarnessSetupState;
  update: HarnessSetupUpdate;
}) {
  const harness = HARNESS_BY_ID[state.harness];
  // Track the harness each in-flight request is for so a fast switch can't
  // let a stale response overwrite fresh state.
  const authInFlight = useRef<HarnessId | null>(null);
  const verifyInFlight = useRef<HarnessId | null>(null);

  // Auth and verify fire in parallel — verify is the slow one (real LLM
  // round-trip, ~2-10s) and auth is fast (CLI status subcommand). Running
  // serial meant auth's latency stacked on top of verify's. Each writes only
  // its own slice of harnessAuth via functional updates so the results compose.
  const runAuthOnly = useCallback(
    async (target: HarnessId, options: { fresh?: boolean } = {}) => {
      try {
        const report = await trpcClient.harness.authPost.mutate({body: {
          harness: target,
          fresh: options.fresh === true,
        }});
        if (authInFlight.current !== target) return;
        update((s) => ({ harnessAuth: { ...s.harnessAuth, phase: 'ready', report } }));
      } catch (err) {
        if (authInFlight.current !== target) return;
        const message =
          apiErrorStatus(err) !== undefined
            ? (apiErrorBody(err) as { error?: string } | null)?.error ?? `Check failed (${apiErrorStatus(err)})`
            : err instanceof Error
            ? apiErrorText(err)
            : 'Check failed';
        update((s) => ({
          harnessAuth: { ...s.harnessAuth, phase: 'error', error: message },
        }));
      }
    },
    [update],
  );

  const runVerifyOnly = useCallback(
    async (target: HarnessId) => {
      try {
        const result = await trpcClient.harness.verifyPost.mutate({body: {
          harness: target,
        }});
        if (verifyInFlight.current !== target) return;
        update((s) => ({
          harnessAuth: {
            ...s.harnessAuth,
            verify: {
              phase: result.ok ? 'ok' : 'failed',
              result,
              error: result.ok ? undefined : result.errorMessage ?? 'Harness did not respond',
            },
          },
        }));
      } catch (err) {
        if (verifyInFlight.current !== target) return;
        const message =
          apiErrorStatus(err) !== undefined
            ? (apiErrorBody(err) as { error?: string } | null)?.error ?? `Verify failed (${apiErrorStatus(err)})`
            : err instanceof Error
            ? apiErrorText(err)
            : 'Verify failed';
        update((s) => ({
          harnessAuth: {
            ...s.harnessAuth,
            verify: { phase: 'failed', error: message },
          },
        }));
      }
    },
    [update],
  );

  const runCheck = useCallback(
    (target: HarnessId, options: { fresh?: boolean } = {}) => {
      authInFlight.current = target;
      verifyInFlight.current = target;
      // Reset both slices together so the UI shows a clean "checking + verifying"
      // state without a stale report bleeding through from the previous harness.
      update({
        harnessAuth: {
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
    runCheck(state.harness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.harness]);

  const selectHarness = (id: HarnessId) => {
    if (id === state.harness) return;
    // Pick an explicit model from the destination catalog. The prior pick
    // belongs to a different provider and must never cross the boundary.
    update({ harness: id, model: defaultModelFor(id) });
  };

  const acceptApiKey = (checked: boolean) => {
    update((s) => ({
      harnessAuth: { ...s.harnessAuth, acceptsApiKeyBilling: checked },
    }));
  };

  return (
    <div className="@container space-y-4">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Harness</div>
        <HarnessPicker
          harnesses={HARNESS_IDS.map((id) => HARNESS_BY_ID[id])}
          value={state.harness}
          onChange={selectHarness}
        />
      </div>

      <HarnessPermissionNotice harness={state.harness} />

      <AuthStatus
        state={state}
        harness={harness}
        onRecheck={() => void runCheck(state.harness, { fresh: true })}
        onAccept={acceptApiKey}
      />

      {state.harness === 'cursor' && <CursorCredentialPanel />}
      {state.harness === 'opencode' && <OpenCodeProviderPanel />}

      {state.harnessAuth.report?.binary.installed && (
        <ModelChoice
          harness={state.harness}
          selected={state.model}
          onSelect={(id) => update({ model: id })}
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
  harness: HarnessId;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { models: options, isLoading } = useHarnessModels(harness, { catalog: true });
  useEffect(() => {
    if (!selected && options[0]) onSelect(options[0].id);
  }, [onSelect, options, selected]);
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Default model</div>
      {isLoading && <div className="text-xs text-muted-foreground">Loading models…</div>}
      <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto @min-[400px]:grid-cols-2">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
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
      {!isLoading && options.length === 0 && (
        <p className="text-xs text-amber-500">Connect the provider, then recheck to load its models.</p>
      )}
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
  state: HarnessSetupState;
  harness: HarnessCard;
  onRecheck: () => void;
  onAccept: (checked: boolean) => void;
}) {
  const auth = state.harnessAuth;
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
  report: HarnessAuthReport;
  harness: HarnessCard;
  auth: HarnessAuthState;
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
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.loginCmd}</code>
          {harness.envHint ? (
            <>
              {' '}or set{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{harness.envHint}</code> in your
              environment.
            </>
          ) : (
            '.'
          )}
        </div>
      )}
    </div>
  );
}

function VerifyLine({
  verify,
  harnessName,
}: {
  verify: HarnessVerifyState;
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

function subscriptionReadyLine(identity: HarnessAuthReport['identity']): string {
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
  harness: HarnessId;
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
