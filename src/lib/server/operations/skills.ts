import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { skillErrorResponse } from '@/lib/skills/http';
import { newSkill, skillsOverview } from '@/lib/skills/manage';
import { createSkillShape, locationFrom } from '@/lib/skills/params';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

/**
 * Skills, wherever they live (docs/skills.md).
 *   GET  → { skills, projects, canWriteGlobal }: Ri's skills, the global
 *          ones, each project's and the drafts, plus the projects a skill
 *          can go in.
 *   POST { name?, intent?, description?, body?, location?, workspaceId? } →
 *          a new skill, a draft unless a location installs it. Named from
 *          `intent` when `name` is absent. With nothing at all, a blank
 *          draft nobody has used comes back instead of another.
 */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    return reply(await skillsOverview());
  } catch (err) {
    return failureResponse(skillErrorResponse(err, 'GET /api/skills'));
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = rpcInput.body;
  const parsed = z.object(createSkillShape).safeParse(body);
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? 'Invalid skill.' }, { status: 400 });
  const { location, workspaceId, ...input } = parsed.data;
  try {
    return reply({ skill: await newSkill({ ...input, location: locationFrom(location, workspaceId) }) }, { status: 201 });
  } catch (err) {
    return failureResponse(skillErrorResponse(err, 'POST /api/skills'));
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: legacySchema(z.object(createSkillShape)) }).strict();
