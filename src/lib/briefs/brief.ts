import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { NoteRecord, TaskRecord } from '@/db/types';
import { getWorkDir } from '@/lib/config/paths';
import { backgroundModelFor, resolveBackgroundHarness, runHarnessJson } from '@/lib/harness/one-shot';
import { renderBriefPrompt, BRIEF_SYSTEM_PROMPT } from './prompt';
import {
  BRIEF_JSON_SHAPE,
  BRIEF_VERSION,
  briefContentSchema,
  normalizeBriefContent,
  type BriefEntityType,
  type BriefState,
  type EntityBrief,
} from './types';

/**
 * Entity briefs: generate, cache, and report freshness.
 *
 * Storage is a JSON file per entity under `<work>/briefs/<type>/<id>.json`.
 * `.work/` is the app's regenerable scratch (never synced, safe to delete),
 * which is exactly what a derived cache is. This keeps the agent-first UI
 * trial free of schema: reverting it is `rm -rf .work/briefs`. If briefs
 * outlive the trial (list views showing one-liners, invalidation inside the
 * write transaction), promote them to a table then.
 *
 * Freshness is a content hash, so a brief can never drift: it either matches
 * the document or it is reported stale. Generation is deduped per entity so
 * two opens do not spawn two harness calls.
 */

/** Below this many content characters the document is its own brief. */
export const BRIEF_MIN_CHARS = 500;

const BRIEF_TIMEOUT_SEC = 120;

export type BriefEntity = TaskRecord | NoteRecord;

/** The content a brief describes. Live properties (status, dates) are excluded on purpose. */
export function briefContentParts(entityType: BriefEntityType, entity: BriefEntity): string[] {
  const parts = [entity.title ?? '', entity.body ?? ''];
  if (entityType === 'task') {
    const task = entity as TaskRecord;
    parts.push(task.description ?? '', task.outcome ?? '', task.userContext ?? '');
  }
  return parts;
}

/**
 * Whitespace-insensitive: the rich editor re-serializes markdown when it
 * mounts (blank lines, trailing spaces), and that must not read as "the
 * document changed" to the brief.
 */
export function briefContentHash(entityType: BriefEntityType, entity: BriefEntity): string {
  const h = createHash('sha256');
  for (const part of briefContentParts(entityType, entity)) {
    h.update(part.replace(/\s+/g, ' ').trim());
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 32);
}

/** Total content length, used for the inline (no model) short-circuit. */
export function briefContentLength(entityType: BriefEntityType, entity: BriefEntity): number {
  return briefContentParts(entityType, entity).reduce((n, p) => n + p.trim().length, 0);
}

export function needsBrief(entityType: BriefEntityType, entity: BriefEntity): boolean {
  return briefContentLength(entityType, entity) >= BRIEF_MIN_CHARS;
}

// ─── Cache ────────────────────────────────────────────────────────

export function briefCacheDir(): string {
  return path.join(getWorkDir(), 'briefs');
}

function briefPath(entityType: BriefEntityType, entityId: string): string {
  // Ids are UUIDs, but never trust a path segment blindly.
  const safeId = entityId.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(briefCacheDir(), entityType, `${safeId}.json`);
}

export function readBriefCache(entityType: BriefEntityType, entityId: string): EntityBrief | null {
  try {
    const raw = fs.readFileSync(briefPath(entityType, entityId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<EntityBrief>;
    if (parsed.version !== BRIEF_VERSION || typeof parsed.contentHash !== 'string') return null;
    const content = briefContentSchema.safeParse(parsed);
    if (!content.success) return null;
    return { ...(parsed as EntityBrief), ...normalizeBriefContent(content.data) };
  } catch {
    return null;
  }
}

export function writeBriefCache(brief: EntityBrief): void {
  const file = briefPath(brief.entityType, brief.entityId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic: a reader never sees a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(brief, null, 2));
  fs.renameSync(tmp, file);
}

export function deleteBriefCache(entityType: BriefEntityType, entityId: string): void {
  try {
    fs.rmSync(briefPath(entityType, entityId), { force: true });
  } catch {
    /* best-effort */
  }
}

// ─── State ────────────────────────────────────────────────────────

export function getBriefState(entityType: BriefEntityType, entity: BriefEntity): BriefState {
  const contentHash = briefContentHash(entityType, entity);
  if (!needsBrief(entityType, entity)) {
    return { status: 'inline', brief: null, contentHash };
  }
  const cached = readBriefCache(entityType, entity.id);
  if (!cached) return { status: 'missing', brief: null, contentHash };
  return {
    status: cached.contentHash === contentHash ? 'fresh' : 'stale',
    brief: cached,
    contentHash,
  };
}

// ─── Generation ───────────────────────────────────────────────────

const inFlight = new Map<string, Promise<EntityBrief>>();

/** Whether a generation for this entity is currently running. */
export function isBriefGenerating(entityType: BriefEntityType, entityId: string): boolean {
  return inFlight.has(`${entityType}:${entityId}`);
}

/**
 * Generate (or reuse an in-flight generation of) the brief for the entity's
 * CURRENT content and cache it. Callers that only want the cached state
 * should use `getBriefState`; this always spends a model call unless one is
 * already running for the same entity.
 */
export async function generateBrief(
  entityType: BriefEntityType,
  entity: BriefEntity,
): Promise<EntityBrief> {
  const key = `${entityType}:${entity.id}`;
  const running = inFlight.get(key);
  if (running) return running;

  const contentHash = briefContentHash(entityType, entity);
  const work = (async () => {
    // Provenance: the harness + model the helper will resolve for this tier.
    const provider = resolveBackgroundHarness();
    const model = backgroundModelFor(provider, 'standard') ?? null;
    const raw = await runHarnessJson({
      label: 'entity-brief',
      system: BRIEF_SYSTEM_PROMPT,
      prompt: renderBriefPrompt(entityType, entity),
      schema: briefContentSchema,
      shape: BRIEF_JSON_SHAPE,
      tier: 'standard',
      timeoutSec: BRIEF_TIMEOUT_SEC,
    });
    const content = normalizeBriefContent(raw);
    const brief: EntityBrief = {
      version: BRIEF_VERSION,
      entityType,
      entityId: entity.id,
      contentHash,
      generatedAt: new Date().toISOString(),
      provider,
      model,
      ...content,
    };
    writeBriefCache(brief);
    return brief;
  })();

  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Ensure a usable state for the entity: inline documents and fresh caches
 * return immediately; anything else generates. This is the POST path.
 */
export async function ensureBrief(entityType: BriefEntityType, entity: BriefEntity): Promise<BriefState> {
  const state = getBriefState(entityType, entity);
  if (state.status === 'inline' || state.status === 'fresh') return state;
  const brief = await generateBrief(entityType, entity);
  return { status: 'fresh', brief, contentHash: brief.contentHash };
}
