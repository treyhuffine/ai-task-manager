import { z } from 'zod';
import { archiveSkill, getSkillView, saveSkill } from '@/lib/skills/manage';
import { saveSkillShape } from '@/lib/skills/params';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

type Context = { params: Promise<{ ref: string }> };

/**
 * One skill, by ref (`ri:<name>`, `global:<name>`, `project:<workspaceId>:<name>`).
 *   GET    → the skill: SKILL.md, its fields, checks, files, where it lives.
 *   PUT    { newName?, description?, body?, content?, files?, baseHash? } →
 *          { skill, renamedFrom }. A stale `baseHash` answers 409 with the
 *          current skill.
 *   DELETE → moves it to the archive and archives its chats.
 */
export async function GET(_request: Request, { params }: Context) {
  const { ref } = await params;
  try {
    const skill = await getSkillView(ref);
    if (!skill) return Response.json({ error: "There's no such skill.", code: 'not_found' }, { status: 404 });
    return Response.json({ skill });
  } catch (err) {
    return skillErrorResponse(err, `GET /api/skills/${ref}`);
  }
}

export async function PUT(request: Request, { params }: Context) {
  const { ref } = await params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object(saveSkillShape).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid change.' }, { status: 400 });
  try {
    return Response.json(await saveSkill(ref, parsed.data));
  } catch (err) {
    return skillErrorResponse(err, `PUT /api/skills/${ref}`);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const { ref } = await params;
  try {
    return Response.json(await archiveSkill(ref));
  } catch (err) {
    return skillErrorResponse(err, `DELETE /api/skills/${ref}`);
  }
}
