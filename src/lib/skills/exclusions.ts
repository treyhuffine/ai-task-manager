/**
 * Which library skills one chat must not get. Kept apart from ./reach.ts so
 * the session spec can ask without loading the outside-Ri machinery.
 *
 * A skill with no scope row reaches every chat. A scoped one reaches only its
 * agents' chats (an empty list: none). On top of that, a try chat always gets
 * the skill it tries (that's the point, even while it's off), and a builder
 * chat never gets the skill it's writing, so the AI edits the file instead of
 * following it. See docs/skills.md.
 */

import type { SkillScopeRecord } from '@/db/types';
import { listSkillScopes } from '@/lib/db/queries';

export interface SessionSkillContext {
  /** The chat's agent (workspace), or null for the app's own chats. */
  workspaceId: string | null;
  /** For content chats: 'skill' (a builder) or 'skill-try' (a try), with the skill's name as ref. */
  surfaceKind: string | null;
  surfaceRef: string | null;
}

export function excludedSkills(
  scopes: readonly Pick<SkillScopeRecord, 'name' | 'workspaceIds'>[],
  ctx: SessionSkillContext,
): string[] {
  const out = new Set<string>();
  for (const scope of scopes) {
    if (!ctx.workspaceId || !scope.workspaceIds.includes(ctx.workspaceId)) out.add(scope.name);
  }
  if (ctx.surfaceKind === 'skill-try' && ctx.surfaceRef) out.delete(ctx.surfaceRef);
  if (ctx.surfaceKind === 'skill' && ctx.surfaceRef) out.add(ctx.surfaceRef);
  return [...out].sort();
}

/** `excludedSkills` against the live table, for the session spec. */
export function sessionSkillExclusions(ctx: SessionSkillContext): string[] {
  return excludedSkills(listSkillScopes(), ctx);
}
