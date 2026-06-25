'use client';

import { cn } from '@/lib/utils';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import type { OrchestratorMode } from '@/hooks/use-orchestrator-chat';
import { AgentSettingsPanel } from '@/components/settings/agent-settings-panel';
import { BillingSection } from './billing-section';

const ORCHESTRATOR_MODES: { id: OrchestratorMode; label: string; description: string }[] = [
  { id: 'legacy', label: 'Classic', description: 'Built-in chat agent, no harness.' },
  { id: 'harness_skills', label: 'Skills', description: 'Harness session, actions via CLI + skills.' },
  { id: 'harness_mcp', label: 'MCP', description: 'Harness session, actions via MCP tools.' },
];

/**
 * Default agent provider/model (reuses AgentSettingsPanel) plus the
 * orchestrator brain used by the main chat. Both persist to user_state and
 * seed future sessions; switching mode here just sets the preference (it does
 * not start a new chat — that happens the next time you chat).
 */
export function ModelsSection() {
  const { data: userState } = useUserState();
  const update = useUpdateUserState();
  const mode: OrchestratorMode = userState?.orchestratorMode ?? 'legacy';

  return (
    <div className="space-y-7">
      <AgentSettingsPanel />

      <section className="space-y-3 text-[12px]">
        <header className="space-y-0.5">
          <h3 className="text-[13px] font-semibold text-foreground">Orchestrator mode</h3>
          <p className="text-[11px] text-muted-foreground/85">
            Which brain powers the main chat. Switching takes effect on your next chat.
          </p>
        </header>
        <div className="space-y-1.5">
          {ORCHESTRATOR_MODES.map((m) => {
            const selected = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  if (!selected) update.mutate({ orchestratorMode: m.id });
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                  selected ? 'border-primary/60 bg-primary/5' : 'border-border bg-card/40 hover:bg-muted/50',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                    selected ? 'border-primary' : 'border-muted-foreground/40',
                  )}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </span>
                <span className="flex flex-col">
                  <span className="text-[12px] font-medium text-foreground">{m.label}</span>
                  <span className="text-[11px] text-muted-foreground">{m.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3 text-[12px]">
        <header className="space-y-0.5">
          <h3 className="text-[13px] font-semibold text-foreground">Usage &amp; budget</h3>
          <p className="text-[11px] text-muted-foreground/85">
            What your agents have spent, and an optional monthly cap.
          </p>
        </header>
        <BillingSection />
      </section>
    </div>
  );
}
