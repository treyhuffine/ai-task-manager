/**
 * Last reasoning effort the user chose, per provider.
 *
 * Effort only means something relative to a provider — Codex's ladder and
 * Claude's aren't the same scale, and "I run Codex hot but Claude at medium" is
 * a normal way to work. One value would get clobbered every time you switched.
 *
 * Deliberately **global per provider**, not per workspace. Unlike the model
 * (which is genuinely repo-shaped — this repo wants Opus, that one doesn't),
 * effort is a working-style preference that travels with the person. Scoping it
 * per workspace would mean re-teaching every repo the same thing.
 *
 * Shared by every surface that can change effort — the launcher and the
 * in-execution composer both read and write here, so switching providers in one
 * place is remembered in the other. Before this existed each surface had its
 * own answer: the launcher remembered, and a provider switch inside a session
 * silently reset you to the model's default.
 *
 * This is a *preference*, not a *setting*: it records what you last picked.
 * `agent_harness_settings.defaultEffort` is the separate, explicitly-configured
 * default and is never written from here.
 */

import type { EffortLevel } from '@/db/types';

const KEY = 'flow.agent.effort.v1';

const VALID: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

type EffortMap = Record<string, EffortLevel>;

function readMap(): EffortMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Filter on read: a value persisted by an older build (or hand-edited)
    // must not flow into a dispatch as an invalid effort.
    const out: EffortMap = {};
    for (const [harness, effort] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof effort === 'string' && VALID.has(effort)) out[harness] = effort as EffortLevel;
    }
    return out;
  } catch {
    return {};
  }
}

/** Every remembered provider→effort pair. */
export function readProviderEfforts(): EffortMap {
  return readMap();
}

/** The remembered effort for one provider, or null if it's never been set. */
export function readProviderEffort(harness: string | null | undefined): EffortLevel | null {
  if (!harness) return null;
  return readMap()[harness] ?? null;
}

/**
 * Record the effort chosen for a provider.
 *
 * Callers should pass what the user actually selected, not a resolved
 * fallback — writing back a model's default would overwrite a real preference
 * with a coincidence.
 */
export function writeProviderEffort(harness: string | null | undefined, effort: EffortLevel | null): void {
  if (!harness || !effort || typeof window === 'undefined') return;
  if (!VALID.has(effort)) return;
  try {
    const map = readMap();
    map[harness] = effort;
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — remembering is a nicety, not a requirement */
  }
}
