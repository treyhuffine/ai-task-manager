'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { authFetch } from '@/lib/api/client';
import { StepYou } from './step-you';
import { StepAreas } from './step-areas';
import { StepAgent } from './step-agent';
import { StepImport } from './step-import';
import { StepLaunch } from './step-launch';
import { STEPS, type WizardState, type StepId } from './types';

const INITIAL_STATE: WizardState = {
  name: '',
  description: '',
  areas: [
    { name: 'Work', emoji: '💼', image_url: null },
    { name: 'Personal', emoji: '🏡', image_url: null },
  ],
  agentHarness: 'claude',
  agentModel: '',
  agentAuth: { phase: 'idle', acceptsApiKeyBilling: false },
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

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  const canProceed = (() => {
    switch (current) {
      case 'you':
        return state.name.trim().length > 0;
      case 'areas':
        return state.areas.length > 0;
      case 'agent': {
        if (!state.agentHarness) return false;
        const a = state.agentAuth;
        // Still checking or hit an error → don't gate forward; they can retry.
        // The only hard block is "only API keys, no subscription, and they
        // haven't acknowledged metered billing yet."
        if (a.phase !== 'ready' || !a.report) return true;
        const { hasSubscription, hasApiKey } = a.report;
        if (!hasSubscription && hasApiKey && !a.acceptsApiKeyBilling) return false;
        if (!hasSubscription && !hasApiKey) return false;
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
      const existingRes = await authFetch('/api/areas?status=all');
      const existing: Array<{ name: string }> = existingRes.ok ? await existingRes.json() : [];
      const existingNames = new Set(existing.map((a) => a.name.toLowerCase()));

      for (let i = 0; i < state.areas.length; i++) {
        const a = state.areas[i];
        if (existingNames.has(a.name.toLowerCase())) continue;
        const res = await authFetch('/api/areas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: a.name,
            emoji: a.emoji,
            image_url: a.image_url,
            sort_order: i,
          }),
        });
        if (!res.ok) {
          throw new Error(`Failed to create area "${a.name}"`);
        }
      }

      // 2. Save user state + mark onboarded
      const res = await authFetch('/api/user-state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: state.name.trim(),
          description: state.description.trim(),
          default_agent_harness: state.agentHarness,
          default_agent_model: state.agentModel || null,
          onboarded_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
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
