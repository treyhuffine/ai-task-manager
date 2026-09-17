import { z } from 'zod';

/**
 * A brief is the agent's rendering of one document for the person who owns
 * it: what it is, what matters in it right now, what is still open, and what
 * the agent could do next. It is DERIVED from the entity's content and cached
 * by content hash, never edited by a human, and never a source of truth. The
 * body stays canonical; the brief is how you read it without reading it.
 */

export type BriefEntityType = 'task' | 'note';

export const BRIEF_VERSION = 1 as const;

/**
 * The model-authored part of a brief, validated on the way in. Shape only:
 * a bullet that runs long or a seventh point is not worth failing a
 * 30-second model call over, so lengths are clamped by `normalizeBriefContent`
 * after parsing instead of rejected here.
 */
export const briefContentSchema = z.object({
  /** One or two sentences: what this is and where it stands. */
  summary: z.string().trim().min(1),
  /** The few things worth knowing, most important first. */
  points: z.array(z.string()).optional(),
  /** Genuinely unresolved threads, questions, or decisions in the text. */
  open: z.array(z.string()).optional(),
  /** Things the user could ask the agent to do to THIS document, as commands. */
  suggestions: z.array(z.string()).optional(),
});

/** As parsed from the model: lists may be missing. */
export type BriefContent = z.infer<typeof briefContentSchema>;

/** As stored and rendered: every list present, trimmed, and capped. */
export interface NormalizedBriefContent {
  summary: string;
  points: string[];
  open: string[];
  suggestions: string[];
}

export const BRIEF_LIMITS = { points: 6, open: 5, suggestions: 4 } as const;

/** Drop empties, cap list lengths. Strings are never truncated mid-sentence. */
export function normalizeBriefContent(content: BriefContent): NormalizedBriefContent {
  const clean = (items: string[] | undefined, max: number) =>
    (items ?? []).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, max);
  return {
    summary: content.summary.trim(),
    points: clean(content.points, BRIEF_LIMITS.points),
    open: clean(content.open, BRIEF_LIMITS.open),
    suggestions: clean(content.suggestions, BRIEF_LIMITS.suggestions),
  };
}

/** Hand-written JSON shape shown to the model (kept next to the zod schema). */
export const BRIEF_JSON_SHAPE = `{
  "summary": "string, 1-2 sentences",
  "points": ["string", "..."],
  "open": ["string", "..."],
  "suggestions": ["string", "..."]
}`;

export interface EntityBrief extends NormalizedBriefContent {
  version: typeof BRIEF_VERSION;
  entityType: BriefEntityType;
  entityId: string;
  /** Hash of the content the brief describes. Mismatch = stale. */
  contentHash: string;
  generatedAt: string;
  provider: string;
  model: string | null;
}

/**
 * What the UI gets back for an entity:
 *
 *   - `inline`  — the document is short enough to be its own brief; no model
 *                 call is made and `brief` is null. Render the body.
 *   - `fresh`   — a cached brief matches the current content.
 *   - `stale`   — a cached brief exists but the content changed since.
 *   - `missing` — no brief has been generated for this content yet.
 */
export type BriefStatus = 'inline' | 'fresh' | 'stale' | 'missing';

export interface BriefState {
  status: BriefStatus;
  brief: EntityBrief | null;
  /** The current content hash, so a client can key "generated once" logic. */
  contentHash: string;
}
