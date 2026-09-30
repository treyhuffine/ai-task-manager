import { z } from 'zod';
import { newSkill, skillsOverview } from '@/lib/skills/manage';
import { createSkillShape } from '@/lib/skills/params';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

/**
 * The skill library (docs/skills.md).
 *   GET  → { skills, outside, canReachOutside }: every library skill with its
 *          reach, plus the skills in ~/.claude/skills and ~/.agents/skills that
 *          Ri doesn't own. `?workspaceId=` adds `folderSkills`, the skills in
 *          that agent's own folder.
 *   POST { name?, intent?, description?, body? } → a new skill, off. Named
 *          from `intent` when `name` is absent.
 */
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get('workspaceId');
  try {
    return Response.json(await skillsOverview({ workspaceId }));
  } catch (err) {
    return skillErrorResponse(err, 'GET /api/skills');
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object(createSkillShape).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid skill.' }, { status: 400 });
  try {
    return Response.json({ skill: await newSkill(parsed.data) }, { status: 201 });
  } catch (err) {
    return skillErrorResponse(err, 'POST /api/skills');
  }
}
