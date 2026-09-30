import { z } from 'zod';
import { changeSkillReach } from '@/lib/skills/manage';
import { reachShape } from '@/lib/skills/params';
import type { SkillReach } from '@/lib/skills/reach';
import { readJson, skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

type Context = { params: Promise<{ name: string }> };

/**
 * Where a skill reaches: PUT { mode: everywhere | all | agents | off,
 * workspaceIds? } → { skill }. Restarts the live sessions the change touches.
 */
export async function PUT(request: Request, { params }: Context) {
  const { name } = await params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = z.object(reachShape).safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid reach.' }, { status: 400 });
  const { mode, workspaceIds } = parsed.data;
  const reach: SkillReach = mode === 'agents' ? { mode, workspaceIds: workspaceIds ?? [] } : { mode };
  try {
    return Response.json({ skill: await changeSkillReach(name, reach) });
  } catch (err) {
    return skillErrorResponse(err, `PUT /api/skills/${name}/reach`);
  }
}
