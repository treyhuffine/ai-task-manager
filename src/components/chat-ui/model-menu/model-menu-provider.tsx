'use client';

import { useId, useState } from 'react';
import { useCommandState } from 'cmdk';
import { ChevronRight, Loader2 } from 'lucide-react';
import { CommandGroup } from '@/components/ui/command';
import {
  findProvider,
  type ModelOption,
  type ProviderId,
} from '@/lib/harness/options';
import { cn } from '@/lib/utils';
import { ModelMenuItem } from './model-menu';

/** Compact choices first, with each harness's remaining models one click away. */
export function ModelMenuProvider({
  harness,
  models,
  additionalModels,
  selectedModel,
  defaultModel,
  startsNewChat,
  disabled,
  pendingModel,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  harness: ProviderId;
  models: readonly ModelOption[];
  additionalModels: readonly ModelOption[];
  selectedModel?: string | null;
  defaultModel?: string | null;
  startsNewChat?: boolean;
  disabled?: boolean;
  pendingModel?: string | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onSelect: (model: ModelOption) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const search = useCommandState((state) => state.search.trim());
  const regionId = useId();
  const name = findProvider(harness)?.name ?? harness;
  const showAdditional = expanded || search.length > 0;
  return (
    <div>
      <CommandGroup
        heading={name}
        className="[&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px]"
      >
        {models.map((model) => (
          <ModelMenuItem
            key={model.id}
            harness={harness}
            model={model}
            selected={model.id === selectedModel}
            isDefault={model.id === defaultModel}
            startsNewChat={startsNewChat}
            disabled={disabled}
            onSelect={() => onSelect(model)}
          />
        ))}
        <div id={regionId}>
          {showAdditional &&
            additionalModels.map((model) => (
              <ModelMenuItem
                key={model.id}
                harness={harness}
                model={model}
                selected={model.id === selectedModel}
                isDefault={model.id === defaultModel}
                startsNewChat={startsNewChat}
                disabled={disabled}
                pending={pendingModel === model.id}
                onSelect={() => onSelect(model)}
              />
            ))}
        </div>
      </CommandGroup>
      {!search && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setExpanded((value) => !value)}
            className="mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              size={12}
              className={cn(
                'shrink-0 transition-transform',
                expanded && 'rotate-90',
              )}
            />
            <span>
              {expanded
                ? `Fewer ${name} models`
                : additionalModels.length
                  ? `More ${name} models`
                  : `All ${name} models`}
            </span>
            {loading ? (
              <Loader2 size={11} className="ml-auto animate-spin" />
            ) : (
              additionalModels.length > 0 && (
                <span className="ml-auto text-[10px] tabular-nums">
                  {additionalModels.length}
                </span>
              )
            )}
          </button>
          {expanded && !loading && error && (
            <div className="px-4 pb-2 text-[11px] text-muted-foreground">
              Could not load models.{' '}
              <button
                type="button"
                onClick={onRetry}
                className="underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          )}
          {expanded && !loading && !error && additionalModels.length === 0 && (
            <p className="px-4 pb-2 text-[11px] text-muted-foreground">
              All supported models are already shown.
            </p>
          )}
        </>
      )}
    </div>
  );
}
