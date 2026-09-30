import { z } from 'zod';
import { archiveSkill, getSkillView, saveSkill } from '@/lib/skills/manage';
import { saveSkillShape } from '@/lib/skills/params';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

type Context = { params: Promise<{ name: string }> };

/**
 * One library skill.
 *   GET    → the skill: SKILL.md, its fields, checks, files, reach.
 *   PUT    { newName?, description?, body?, content?, files?, baseHash? } →
 *          { skill, renamedFrom }. A stale `baseHash` answers 409 with the
 *          current skill.
 *   DELETE → moves it to the archive, takes down its links, archives its chats.
 */
export async function GET(_request: Request, { params }: Context) {
  const { name } = await params;
  try {
    const skill = await getSkillView(name);
    if (!skill) return Response.json({ error: `There's no skill named ${name}.`, code: 'not_found' }, { status: 404 });
    return Response.json({ skill });
  } catch (err) {
    return skillErrorResponse(err, `GET /api/skills/${name}`);
  }
}

export async function PUT(request: Request, { params }: Context) {
  const { name } = await params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object(saveSkillShape).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid change.' }, { status: 400 });
  try {
    return Response.json(await saveSkill(name, parsed.data));
  } catch (err) {
    return skillErrorResponse(err, `PUT /api/skills/${name}`);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const { name } = await params;
  try {
    return Response.json(await archiveSkill(name));
  } catch (err) {
    return skillErrorResponse(err, `DELETE /api/skills/${name}`);
  }
}
