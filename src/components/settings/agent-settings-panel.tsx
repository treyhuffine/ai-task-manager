'use client';

import { Bot } from 'lucide-react';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { ProviderModelSelector } from './provider-model-selector';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import {
  explicitEffortForModel,
  explicitModelForProvider,
  providerHarnessKey,
  type ProviderId,
} from '@/lib/agent-options';

/**
 * Default agent provider + model, editable after onboarding. Writes through
 * to `user_state.defaultAgentHarness` / `defaultAgentModel`, which seed every
 * new chat/execution (still overridable per-session from the composer).
 */
export function AgentSettingsPanel() {
  const { data: userState, isLoading } = useUserState();
  const update = useUpdateUserState();

  const harness = (userState?.defaultAgentHarness ?? 'claude') as ProviderId;
  const model = explicitModelForProvider(harness, userState?.defaultAgentModel);

  return (
    <section className="space-y-3 text-[12px]">
      <header className="flex items-center gap-2 text-foreground">
        <Bot size={14} className="text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">AI agent</h3>
      </header>
      <p className="text-[11px] text-muted-foreground/85">
        The default provider + model new chats and executions start with. You can still override the
        model per session from the composer.
      </p>
      {isLoading ? (
        <SettingsSkeleton rows={3} />
      ) : (
        <ProviderModelSelector
          harness={harness}
          model={model.id}
          onChange={(next) => {
            const effort = explicitEffortForModel(
              providerHarnessKey(next.harness),
              next.model,
              userState?.defaultAgentEffort,
            );
            update.mutate({
              defaultAgentHarness: next.harness,
              defaultAgentModel: next.model.id,
              defaultAgentEffort: effort,
            });
          }}
        />
      )}
    </section>
  );
}
