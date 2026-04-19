import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Bot, Check, AlertCircle, Loader2, Sparkles, Code2 } from 'lucide-react';
import type { WizardState, AgentAdapter } from './types';

const ADAPTERS: Array<{
  id: AgentAdapter;
  name: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'claude', name: 'Claude Code', hint: 'Local Claude agent', icon: Sparkles },
  { id: 'codex', name: 'Codex', hint: 'Local Codex agent', icon: Code2 },
];

export function StepAgent({
  state,
  update,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}) {
  const [testing, setTesting] = useState(false);

  const runProbe = async () => {
    setTesting(true);
    update({ agentProbe: { status: 'running' } });
    try {
      const res = await fetch('/api/agent/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: state.agentAdapter }),
      });
      const body = await res.json();
      const status = (body.status ?? 'fail') as 'pass' | 'warn' | 'fail';
      const errorCheck = Array.isArray(body.checks)
        ? body.checks.find((c: { level: string }) => c.level === 'error')
        : null;
      const message = errorCheck?.message ?? (status === 'pass' ? 'All checks passed' : 'Probe finished');
      update({ agentProbe: { status, message } });
    } catch (err) {
      update({
        agentProbe: {
          status: 'fail',
          message: err instanceof Error ? err.message : 'Probe failed',
        },
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Bot className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Pick your agent</h2>
          <p className="text-sm text-muted-foreground">
            Flow runs agent tasks through one of these coding CLIs. Both use their own login.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Adapter</div>
        <div className="grid grid-cols-2 gap-2">
          {ADAPTERS.map((a) => {
            const selected = state.agentAdapter === a.id;
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() =>
                  update({ agentAdapter: a.id, agentProbe: { status: 'idle' } })
                }
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
                <span className="text-sm font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.hint}</span>
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
        </select>
        <p className="text-xs text-muted-foreground">
          Leave on Default to always use the adapter&apos;s latest recommended model.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Environment check</div>
            <div className="truncate text-xs text-muted-foreground">
              Verifies the adapter CLI is installed and authenticated.
            </div>
          </div>
          <Button type="button" variant="outline" onClick={runProbe} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : null}
            {testing ? 'Testing…' : 'Test now'}
          </Button>
        </div>

        {state.agentProbe.status !== 'idle' && state.agentProbe.status !== 'running' && (
          <div
            className={`mt-3 flex items-start gap-2 text-sm ${
              state.agentProbe.status === 'pass'
                ? 'text-emerald-400'
                : state.agentProbe.status === 'warn'
                  ? 'text-amber-400'
                  : 'text-destructive'
            }`}
          >
            {state.agentProbe.status === 'pass' ? (
              <Check className="mt-0.5 size-4" />
            ) : (
              <AlertCircle className="mt-0.5 size-4" />
            )}
            <span>{state.agentProbe.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
