/**
 * Input shapes for skill writes, shared by the API routes and the
 * orchestrator actions so both accept exactly the same thing. Raw Zod shapes,
 * the form actions take (the routes wrap them in `z.object`).
 *
 * Limits here only stop absurd input. The skill rules (name pattern,
 * description length) are checks the builder shows, not rejections, so a
 * draft can be saved mid-edit. Turning a skill on is what requires them.
 */

import { z } from 'zod';
import { SkillError } from './library';
import type { SkillLocation } from './locations';

const TEXT_MAX = 2_000_000;

export const supportingFileParam = z.object({
  path: z.string().min(1).max(500).describe('Relative to the skill folder, like references/guide.md.'),
  content: z.string().max(TEXT_MAX).nullable().describe('The file text, or null to delete the file.'),
});

const locationKind = z.enum(['ri', 'global', 'project']);

export const createSkillShape = {
  name: z.string().max(64).optional().describe('lowercase-with-hyphens. Omit to name it from `intent`.'),
  intent: z.string().max(5000).optional().describe('What the skill should do, in the user\'s words.'),
  description: z.string().max(10_000).optional(),
  body: z.string().max(TEXT_MAX).optional(),
  location: locationKind.optional().describe('Where it lives: "ri" (default), "global", or "project" (with workspaceId).'),
  workspaceId: z.string().optional().describe('For location "project": the agent whose folder it goes in.'),
};

export const saveSkillShape = {
  newName: z.string().max(64).optional().describe('Rename the skill (and its slash command).'),
  description: z.string().max(10_000).optional(),
  body: z.string().max(TEXT_MAX).optional().describe('The markdown after the frontmatter, replaced whole.'),
  content: z.string().max(TEXT_MAX).optional().describe('The whole SKILL.md. Wins over description and body.'),
  files: z.array(supportingFileParam).max(50).optional(),
  baseHash: z.string().max(64).nullable().optional().describe('The hash from your last read. A mismatch is refused.'),
};

export const moveSkillShape = {
  to: locationKind.describe('"ri", "global", or "project" (with workspaceId).'),
  workspaceId: z.string().optional().describe('For "project": the agent whose folder it goes in.'),
  copy: z.boolean().optional().describe('Copy it there and keep the original, the way to share a skill with a project.'),
};

/** A location from the `location`/`to` kind plus `workspaceId` inputs. */
export function locationFrom(kind: 'ri' | 'global' | 'project' | undefined, workspaceId?: string): SkillLocation {
  if (kind === 'global') return { kind: 'global' };
  if (kind === 'project') {
    if (!workspaceId) throw new SkillError('invalid', 'Say which agent\'s folder the skill goes in (workspaceId).');
    return { kind: 'project', workspaceId };
  }
  return { kind: 'ri' };
}
