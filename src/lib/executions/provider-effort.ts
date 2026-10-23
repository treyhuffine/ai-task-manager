/**
 * Last reasoning effort the user chose, per provider.
 *
 * Effort only means something relative to a provider — Codex's ladder and
 * Claude's aren't the same scale, and "I run Codex hot but Claude at medium" is
 * a normal way to work. One value would get clobbered every time you switched.
 *
 * Global per provider within its Home and member, not per agent. Personal
 * preferences keep their existing key. Team documents never read that key. Unlike the model
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
import { homeStorageIdentity } from '@/lib/home/document-scope';
type HomeScope = Parameters<typeof homeStorageIdentity>[1];

const KEY = 'ri.agent.effort.v1';

const VALID: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

type EffortMap = Record<string, EffortLevel>;

/**
 * The stored map as text, the same text while nothing changes. A React reader
 * passes it to `useSyncExternalStore` and parses it with `parseProviderEfforts`.
 */
export function readProviderEffortsText(scope?: HomeScope): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(homeStorageIdentity(KEY, scope));
  } catch {
    return null;
  }
}

export function parseProviderEfforts(raw: string | null): EffortMap {
  if (!raw) return {};
  try {
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

function readMap(scope?: HomeScope): EffortMap {
  return parseProviderEfforts(readProviderEffortsText(scope));
}

/** Every remembered provider→effort pair. */
export function readProviderEfforts(scope?: HomeScope): EffortMap {
  return readMap(scope);
}

/** The remembered effort for one provider, or null if it's never been set. */
export function readProviderEffort(harness: string | null | undefined, scope?: HomeScope): EffortLevel | null {
  if (!harness) return null;
  return readMap(scope)[harness] ?? null;
}

/**
 * Record the effort chosen for a provider.
 *
 * Callers should pass what the user actually selected, not a resolved
 * fallback — writing back a model's default would overwrite a real preference
 * with a coincidence.
 */
export function writeProviderEffort(harness: string | null | undefined, effort: EffortLevel | null, scope?: HomeScope): void {
  if (!harness || !effort || typeof window === 'undefined') return;
  if (!VALID.has(effort)) return;
  try {
    const map = readMap(scope);
    map[harness] = effort;
    window.localStorage.setItem(homeStorageIdentity(KEY, scope), JSON.stringify(map));
  } catch {
    /* quota / private mode — remembering is a nicety, not a requirement */
  }
}
