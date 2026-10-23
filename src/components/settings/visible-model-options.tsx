'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModelMenuProvider } from '@/components/chat-ui/model-menu/model-menu-provider';
import { useExecutionRuntimeScope } from '@/components/home/execution-runtime-context';
import { useHarnessConnection } from '@/hooks/use-harness-connection';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { useSaveHarnessModels } from '@/hooks/use-harnesses';
import {
  PROVIDERS,
  type ModelOption,
  type ProviderId,
} from '@/lib/harness/options';

/** Connected harnesses, saved visible models and a supported-catalog expander for each. */
export function VisibleModelOptions({
  currentProvider,
  model,
  onPick,
  defaultSelection,
  currentProviderOnly = false,
  markProviderSwitches = true,
  disabled,
}: {
  currentProvider: ProviderId;
  model: string;
  onPick: (harness: ProviderId, model: ModelOption) => void;
  defaultSelection?: { harness: ProviderId; model: string | null } | null;
  currentProviderOnly?: boolean;
  markProviderSwitches?: boolean;
  disabled?: boolean;
}) {
  return PROVIDERS.filter(
    (provider) => !currentProviderOnly || provider.id === currentProvider,
  ).map((provider) => (
    <ProviderModels
      key={provider.id}
      harness={provider.id}
      currentProvider={currentProvider}
      selectedModel={model}
      onPick={onPick}
      defaultSelection={defaultSelection}
      disabled={disabled}
      markProviderSwitches={markProviderSwitches}
    />
  ));
}

function ProviderModels({
  harness,
  currentProvider,
  selectedModel,
  onPick,
  defaultSelection,
  disabled,
  markProviderSwitches,
}: {
  harness: ProviderId;
  currentProvider: ProviderId;
  selectedModel: string;
  onPick: (harness: ProviderId, model: ModelOption) => void;
  defaultSelection?: { harness: ProviderId; model: string | null } | null;
  disabled?: boolean;
  markProviderSwitches: boolean;
}) {
  const { models } = useHarnessModels(harness);
  const { canConfigureModels } = useExecutionRuntimeScope();
  const catalog = useHarnessModels(harness, { catalog: true });
  const { connection } = useHarnessConnection(harness);
  const save = useSaveHarnessModels();
  const queryClient = useQueryClient();
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  if (!connection.connected && harness !== currentProvider) return null;
  const rows = [
    ...models.filter((model) => model.custom),
    ...models.filter((model) => !model.custom),
  ];
  const visibleIds = new Set(models.map((model) => model.id));
  const additionalModels = canConfigureModels ? catalog.models.filter(
    (model) =>
      !visibleIds.has(model.id) && model.availability !== 'unavailable',
  ) : [];
  const pick = async (model: ModelOption) => {
    if (disabled || pendingModel || !connection.connected) return;
    if (visibleIds.has(model.id)) {
      onPick(harness, model);
      return;
    }
    if (!canConfigureModels) return;
    const settings = catalog.data;
    if (!settings) return;
    setPendingModel(model.id);
    try {
      await save.mutateAsync({
        harness,
        enabledModelIds: [
          ...new Set([
            ...(settings.enabledModelIds ?? models.map((row) => row.id)),
            model.id,
          ]),
        ],
        defaultModel: settings.defaultModel ?? model.id,
        defaultVariant: settings.defaultVariant ?? null,
        defaultEffort: settings.defaultEffort ?? null,
      });
      // The composer resolves a pick against the enabled list immediately.
      // Refresh it before handing off so it never falls back to another model.
      await queryClient.refetchQueries(
        { queryKey: ['agent-models', harness] },
        { throwOnError: true },
      );
      onPick(harness, model);
    } catch (error) {
      toast.error(`Could not select ${model.label}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingModel(null);
    }
  };
  return (
    <ModelMenuProvider
      harness={harness}
      models={rows}
      additionalModels={additionalModels}
      selectedModel={harness === currentProvider ? selectedModel : null}
      defaultModel={
        defaultSelection?.harness === harness ? defaultSelection.model : null
      }
      startsNewChat={markProviderSwitches && harness !== currentProvider}
      disabled={disabled || !connection.connected || pendingModel != null}
      pendingModel={pendingModel}
      loading={catalog.isLoading}
      error={catalog.isError}
      onRetry={() => {
        void catalog.refetch();
      }}
      onSelect={(model) => {
        void pick(model);
      }}
    />
  );
}
