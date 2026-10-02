import { z } from 'zod';
import { newSkill, skillsOverview } from '@/lib/skills/manage';
import { createSkillShape, locationFrom } from '@/lib/skills/params';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

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
export async function GET() {
  try {
    return Response.json(await skillsOverview());
  } catch (err) {
    return skillErrorResponse(err, 'GET /api/skills');
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object(createSkillShape).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid skill.' }, { status: 400 });
  const { location, workspaceId, ...input } = parsed.data;
  try {
    return Response.json({ skill: await newSkill({ ...input, location: locationFrom(location, workspaceId) }) }, { status: 201 });
  } catch (err) {
    return skillErrorResponse(err, 'POST /api/skills');
  }
}
