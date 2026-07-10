'use client';

import { ModelList } from './model-list';
import type { ModelOption, ProviderId } from '@/lib/agent-options';

interface ProviderModelSelectorProps {
  /** Current provider (user_state.defaultAgentHarness vocabulary). */
  harness: ProviderId;
  /** Current explicit default model id. */
  model: string;
  onChange: (next: { harness: ProviderId; model: ModelOption }) => void;
  className?: string;
}

/**
 * Default provider + model picker for settings. A flat, all-providers-at-once
 * list (see ModelList) — pick any model from any provider in one click and it
 * becomes both the default provider and model. Disconnected providers surface
 * their login/check panel inline.
 */
export function ProviderModelSelector({ harness, model, onChange, className }: ProviderModelSelectorProps) {
  return (
    <ModelList
      selected={{ harness, model }}
      onPick={(harness, model) => onChange({ harness, model })}
      className={className}
    />
  );
}
