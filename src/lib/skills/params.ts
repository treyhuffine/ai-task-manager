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

const TEXT_MAX = 2_000_000;

export const supportingFileParam = z.object({
  path: z.string().min(1).max(500).describe('Relative to the skill folder, like references/guide.md.'),
  content: z.string().max(TEXT_MAX).nullable().describe('The file text, or null to delete the file.'),
});

export const createSkillShape = {
  name: z.string().max(64).optional().describe('lowercase-with-hyphens. Omit to name it from `intent`.'),
  intent: z.string().max(5000).optional().describe('What the skill should do, in the user\'s words.'),
  description: z.string().max(10_000).optional(),
  body: z.string().max(TEXT_MAX).optional(),
};

export const saveSkillShape = {
  newName: z.string().max(64).optional().describe('Rename the skill (and its slash command).'),
  description: z.string().max(10_000).optional(),
  body: z.string().max(TEXT_MAX).optional().describe('The markdown after the frontmatter, replaced whole.'),
  content: z.string().max(TEXT_MAX).optional().describe('The whole SKILL.md. Wins over description and body.'),
  files: z.array(supportingFileParam).max(50).optional(),
  baseHash: z.string().max(64).nullable().optional().describe('The hash from your last read. A mismatch is refused.'),
};

export const reachShape = {
  mode: z.enum(['everywhere', 'all', 'agents', 'off']),
  workspaceIds: z.array(z.string().min(1)).max(500).optional().describe('For mode "agents": the agents (workspace ids).'),
};

export type ReachInput = z.infer<z.ZodObject<typeof reachShape>>;
