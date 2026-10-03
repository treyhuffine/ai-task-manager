import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { skillErrorResponse } from '@/lib/skills/http';
import { commitSkill } from '@/lib/skills/manage';
import { z as rpcZ } from 'zod/v4';

/**
 * Commit a project skill in its repo, only that skill's files, on the branch
 * the folder has checked out: POST → { skill, commit: { sha, branch, message } }.
 * Never pushes.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { ref } = rpcInput.params;
  try {
    return reply(await commitSkill(ref));
  } catch (err) {
    return failureResponse(skillErrorResponse(err, `POST /api/skills/${ref}/commit`));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "ref": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
