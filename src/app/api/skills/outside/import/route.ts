import { z } from 'zod';
import { importSkill } from '@/lib/skills/manage';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

/**
 * Bring a skill from ~/.claude/skills or ~/.agents/skills into the library:
 * POST { name } → { skill }. The original is archived and the library copy
 * linked back in its place, so it keeps working everywhere it did.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object({ name: z.string().min(1).max(255) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Send the name of the skill to import.' }, { status: 400 });
  try {
    return Response.json({ skill: await importSkill(parsed.data.name) }, { status: 201 });
  } catch (err) {
    return skillErrorResponse(err, 'POST /api/skills/outside/import');
  }
}
