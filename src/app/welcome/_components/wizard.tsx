'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { api } from '@/lib/api/client';
import { StepYou } from './step-you';
import { StepAreas } from './step-areas';
import { StepAgent } from './step-agent';
import { StepImport } from './step-import';
import { StepLaunch } from './step-launch';
import { STEPS, type WizardState, type StepId } from './types';
import { DEFAULT_AGENT_EFFORT, defaultModelFor } from '@/lib/agent-options';

const INITIAL_STATE: WizardState = {
  name: '',
  description: '',
  areas: [
    { name: 'Work', emoji: '💼', attachments: [] },
    { name: 'Personal', emoji: '🏡', attachments: [] },
  ],
  agentHarness: 'claude',
  agentModel: defaultModelFor('claude'),
  agentAuth: { phase: 'idle', acceptsApiKeyBilling: false, verify: { phase: 'idle' } },
  globalSkillEnabled: null,
  importSkipped: true,
};

export function Wizard() {
  const router = useRouter();
  const [current, setCurrent] = useState<StepId>('you');
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const index = STEPS.findIndex((s) => s.id === current);
  const step = STEPS[index];
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  const update = (
    patch: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>),
  ) =>
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));

  const canProceed = (() => {
    switch (current) {
      case 'you':
        return state.name.trim().length > 0;
      case 'areas':
        return state.areas.length > 0;
      case 'agent': {
        if (!state.agentHarness) return false;
        if (state.globalSkillEnabled === null) return false;
        const a = state.agentAuth;
        if (a.phase !== 'ready' || !a.report) return false;
        if (!a.report.binary.installed) return false;
        // The real test request is the ultimate truth — if it succeeded,
        // the agent works regardless of what detection reported.
        if (a.verify.phase !== 'ok') return false;
        // Billing consent gate: when detection sees only an API key (no
        // subscription or bedrock), require explicit acknowledgement of
        // metered billing before continuing. If detection missed auth
        // entirely but verify passed, we let them through — we can't tell
        // which billing mode they're on.
        const { hasSubscription, hasApiKey, hasBedrock } = a.report;
        if (!hasSubscription && !hasBedrock && hasApiKey && !a.acceptsApiKeyBilling) return false;
        return true;
      }
      default:
        return true;
    }
  })();

  const goNext = () => {
    if (!canProceed) return;
    const next = STEPS[index + 1];
    if (next) setCurrent(next.id);
  };

  const goBack = () => {
    const prev = STEPS[index - 1];
    if (prev) setCurrent(prev.id);
  };

  const launch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      // 1. Fetch existing areas so re-runs don't create duplicates by name.
      const existing = await api
        .get<Array<{ name: string }>>('/areas', { query: { status: 'all' } })
        .catch(() => [] as Array<{ name: string }>);
      const existingNames = new Set(existing.map((a) => a.name.toLowerCase()));

      for (let i = 0; i < state.areas.length; i++) {
        const a = state.areas[i];
        if (existingNames.has(a.name.toLowerCase())) continue;
        try {
          await api.post('/areas', {
            name: a.name,
            emoji: a.emoji,
            attachments: a.attachments,
            sortOrder: i,
          });
        } catch {
          throw new Error(`Failed to create area "${a.name}"`);
        }
      }

      // 2. Apply the explicit user-level skill choice. This also cleans old
      // app-owned project symlinks without touching unrelated skill entries.
      if (state.globalSkillEnabled === null) {
        throw new Error('Choose where agents can use task and note actions');
      }
      try {
        await api.put('/agent/skills/global', {
          enabled: state.globalSkillEnabled,
        });
      } catch {
        throw new Error('Failed to configure agent skill access');
      }

      // 3. Save user state + mark onboarded
      try {
        await api.patch('/user-state', {
          name: state.name.trim(),
          description: state.description.trim(),
          defaultAgentHarness: state.agentHarness,
          defaultAgentModel: state.agentModel,
          defaultAgentEffort: DEFAULT_AGENT_EFFORT,
          onboardedAt: new Date().toISOString(),
        });
      } catch {
        throw new Error('Failed to save setup');
      }

      router.replace('/');
      router.refresh();
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Something went wrong');
      setLaunching(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-10">
      <header className="mb-8 space-y-4">
        <div className="text-sm font-medium text-muted-foreground">Welcome to {APP_NAME}</div>
        <nav className="flex items-center gap-2 text-sm">
          {STEPS.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className={
                    active
                      ? 'font-medium text-foreground'
                      : done
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                  }
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="text-muted-foreground/40">·</span>}
              </div>
            );
          })}
        </nav>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="flex-1">
        {current === 'you' && <StepYou state={state} update={update} />}
        {current === 'areas' && <StepAreas state={state} update={update} />}
        {current === 'agent' && <StepAgent state={state} update={update} />}
        {current === 'import' && <StepImport />}
        {current === 'launch' && <StepLaunch state={state} />}
      </main>

      {launchError && (
        <div className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {launchError}
        </div>
      )}

      <footer className="mt-10 flex items-center justify-between">
        {!isFirst ? (
          <Button variant="ghost" onClick={goBack} disabled={launching}>
            <ArrowLeft className="size-4" /> Back
          </Button>
        ) : (
          <span />
        )}

        {isLast ? (
          <Button onClick={launch} disabled={launching}>
            {launching ? <Loader2 className="size-4 animate-spin" /> : null}
            {launching ? 'Launching…' : `Open ${APP_NAME}`}
          </Button>
        ) : (
          <Button onClick={goNext} disabled={!canProceed}>
            Next <ArrowRight className="size-4" />
          </Button>
        )}
      </footer>
      <span className="sr-only">Step: {step.label}</span>
    </div>
  );
}
