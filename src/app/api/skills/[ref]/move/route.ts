import { z } from 'zod';
import { moveSkill } from '@/lib/skills/manage';
import { locationFrom, moveSkillShape } from '@/lib/skills/params';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

type Context = { params: Promise<{ ref: string }> };

/**
 * Move a skill to Ri, global or a project, or copy it there with `copy`
 * (sharing a skill with a project's team): POST { to, workspaceId?, copy? }
 * → { skill } at its new place.
 */
export async function POST(request: Request, { params }: Context) {
  const { ref } = await params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object(moveSkillShape).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Say where it goes.' }, { status: 400 });
  try {
    const to = locationFrom(parsed.data.to, parsed.data.workspaceId);
    return Response.json({ skill: await moveSkill(ref, to, { copy: parsed.data.copy }) });
  } catch (err) {
    return skillErrorResponse(err, `POST /api/skills/${ref}/move`);
  }
}
