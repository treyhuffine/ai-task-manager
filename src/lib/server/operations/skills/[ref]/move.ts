import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { skillErrorResponse } from '@/lib/skills/http';
import { moveSkill } from '@/lib/skills/manage';
import { locationFrom, moveSkillShape } from '@/lib/skills/params';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

/**
 * Install a draft in Ri, global or a project, move an installed skill, or
 * uninstall it back to the drafts (`to: "draft"`). `copy` keeps the
 * original (sharing a skill with a project's team).
 * POST { to, workspaceId?, copy? } → { skill } at its new place.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { ref } = rpcInput.params;
  const body = rpcInput.body;
  const parsed = z.object(moveSkillShape).safeParse(body);
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? 'Say where it goes.' }, { status: 400 });
  try {
    const to = locationFrom(parsed.data.to, parsed.data.workspaceId);
    return reply({ skill: await moveSkill(ref, to, { copy: parsed.data.copy }) });
  } catch (err) {
    return failureResponse(skillErrorResponse(err, `POST /api/skills/${ref}/move`));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "ref": rpcZ.string().min(1) }).strict(), body: legacySchema(z.object(moveSkillShape)) }).strict();
