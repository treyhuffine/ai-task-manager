import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { skillErrorResponse } from '@/lib/skills/http';
import { archiveSkill, getSkillView, saveSkill } from '@/lib/skills/manage';
import { saveSkillShape } from '@/lib/skills/params';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

/**
 * One skill, by ref (`ri:<name>`, `global:<name>`, `project:<workspaceId>:<name>`).
 *   GET    → the skill: SKILL.md, its fields, checks, files, where it lives.
 *   PUT    { newName?, description?, body?, content?, files?, baseHash? } →
 *          { skill, renamedFrom }. A stale `baseHash` answers 409 with the
 *          current skill.
 *   DELETE → moves it to the archive and archives its chats.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { ref } = rpcInput.params;
  try {
    const skill = await getSkillView(ref);
    if (!skill) return reply({ error: "There's no such skill.", code: 'not_found' }, { status: 404 });
    return reply({ skill });
  } catch (err) {
    return failureResponse(skillErrorResponse(err, `GET /api/skills/${ref}`));
  }
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const { ref } = rpcInput.params;
  const body = rpcInput.body;
  const parsed = z.object(saveSkillShape).safeParse(body);
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? 'Invalid change.' }, { status: 400 });
  try {
    return reply(await saveSkill(ref, parsed.data));
  } catch (err) {
    return failureResponse(skillErrorResponse(err, `PUT /api/skills/${ref}`));
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { ref } = rpcInput.params;
  try {
    return reply(await archiveSkill(ref));
  } catch (err) {
    return failureResponse(skillErrorResponse(err, `DELETE /api/skills/${ref}`));
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "ref": rpcZ.string().min(1) }).strict() }).strict();
export const PUTInput = rpcZ.object({ params: rpcZ.object({ "ref": rpcZ.string().min(1) }).strict(), body: legacySchema(z.object(saveSkillShape)) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "ref": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
