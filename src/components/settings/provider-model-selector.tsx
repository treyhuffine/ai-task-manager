'use client';

import { ModelList } from './model-list';
import type { ProviderId } from '@/lib/agent-options';

interface ProviderModelSelectorProps {
  /** Current provider (user_state.defaultAgentHarness vocabulary). */
  harness: ProviderId;
  /** Current default model id, or null = let the provider pick. */
  model: string | null;
  onChange: (next: { harness: ProviderId; model: string | null }) => void;
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
      onPick={(h, m) => onChange({ harness: h, model: m })}
      className={className}
    />
  );
}
