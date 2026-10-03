/**
 * What a chat gets beyond the usual skills, decided at home (the runner may
 * be on a device without the database). The usual skills are Ri's (attached
 * to every chat), the global ones and the chat folder's project ones (both
 * read by the harness on its own). Two chats differ (docs/skills.md):
 *
 *   - A skill's builder chat never gets the Ri skill it's writing, so the AI
 *     edits the file instead of following it.
 *   - A try chat gets the skill it tries even when the harness wouldn't find
 *     it on its own: a draft, which nothing reads until it's installed, or
 *     a project skill, since the try chat runs in Ri's home, not in that
 *     project.
 */

import { findSkill, parseSkillRef } from './locations';

export interface SessionSkillContext {
  /** For content chats: 'skill' (a builder) or 'skill-try' (a try), with the skill's ref. */
  surfaceKind: string | null;
  surfaceRef: string | null;
}

export interface SessionSkillPlan {
  /** Ri skills (by name) this chat must not get. */
  exclude: string[];
  /** Skill folders to attach on top of the usual ones. */
  extra: string[];
}

export function sessionSkillPlan(ctx: SessionSkillContext): SessionSkillPlan {
  const plan: SessionSkillPlan = { exclude: [], extra: [] };
  if (!ctx.surfaceRef || (ctx.surfaceKind !== 'skill' && ctx.surfaceKind !== 'skill-try')) return plan;
  const ref = parseSkillRef(ctx.surfaceRef);
  if (!ref) return plan;
  if (ctx.surfaceKind === 'skill' && ref.location.kind === 'ri') plan.exclude.push(ref.name);
  if (ctx.surfaceKind === 'skill-try' && (ref.location.kind === 'project' || ref.location.kind === 'draft')) {
    const skill = findSkill(ctx.surfaceRef);
    if (skill) plan.extra.push(skill.dir);
  }
  return plan;
}
