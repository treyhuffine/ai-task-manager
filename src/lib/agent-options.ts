/**
 * Per-harness model + effort options surfaced in the composer dropdowns.
 *
 * Kept tight on purpose. We list the models we're willing to run by
 * default; users can pick "Custom…" later (not implemented) to type any
 * provider id. Adding a model here is a one-line change.
 *
 * Effort levels mirror Claude's `--effort` flag (extended thinking
 * budget). Codex doesn't accept `--effort` in agentex — the dropdown
 * hides on Codex sessions to avoid promising behavior we can't deliver.
 */

import type { EffortLevel } from '@/db/types';

export type AgentHarness = 'claude_code' | 'codex';

export interface ModelOption {
  /** Provider id passed to agentex via `config.model`. */
  id: string;
  /** Display label in the composer dropdown. */
  label: string;
  /** Optional secondary line in the dropdown (e.g. "1M context"). */
  hint?: string;
}

export const MODEL_OPTIONS: Record<AgentHarness, ModelOption[]> = {
  claude_code: [
    { id: 'claude-opus-4-7', label: 'Opus 4.7', hint: '1M context · top quality' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: '1M context · balanced' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'fast + cheap' },
  ],
  codex: [
    { id: 'gpt-5.4', label: 'GPT-5.4', hint: 'top quality' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', hint: 'fast + cheap' },
  ],
};

export interface EffortOption {
  id: EffortLevel;
  /** Full label shown inside the dropdown row. */
  label: string;
  /** Short label shown on the composer chip. */
  shortLabel: string;
  hint: string;
}

// Mirrors Claude CLI's `--effort` choices: low, medium, high, xhigh, max.
// `xhigh` and `max` are the literal CLI tokens — we use them on the wire
// and display them with the same short labels other agent UIs use.
export const EFFORT_OPTIONS: EffortOption[] = [
  { id: 'low', label: 'Low', shortLabel: 'low', hint: 'Minimal thinking, fastest' },
  { id: 'medium', label: 'Medium', shortLabel: 'med', hint: 'Balanced default' },
  { id: 'high', label: 'High', shortLabel: 'high', hint: 'More thinking budget' },
  { id: 'xhigh', label: 'Extra high', shortLabel: 'xhigh', hint: 'Heavy thinking budget' },
  { id: 'max', label: 'Max', shortLabel: 'max', hint: 'Maximum thinking budget' },
];

/**
 * Resolve a provider model id to its option metadata. Returns null when
 * the id isn't in the catalog (e.g. user typed a custom one or running
 * an old session pinned to a removed model).
 */
export function findModelOption(harness: string, modelId: string | null): ModelOption | null {
  if (!modelId) return null;
  const list = MODEL_OPTIONS[harness as AgentHarness];
  if (!list) return null;
  return list.find((m) => m.id === modelId) ?? null;
}

export function harnessSupportsEffort(harness: string): boolean {
  return harness === 'claude_code';
}
