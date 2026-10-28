import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { skillErrorResponse } from '@/lib/skills/http';
import { authorizeSkillOperation } from '@/lib/skills/home-policy';
import { getSkillFile } from '@/lib/skills/manage';
import { z as rpcZ } from 'zod/v4';

/**
 * One of a skill's supporting files, for the editor's Files list.
 *   GET ?path=scripts/run.py → { file: { path, size, text } }, `text` null
 *   when the file isn't text or is over the 1 MB a supporting file may be.
 * Writes go through the skill's PUT `files`.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const { ref } = rpcInput.params;
  try {
    authorizeSkillOperation(request.headers, false, ref);
    return reply({ file: getSkillFile(ref, rpcInput.query.path) });
  } catch (err) {
    return failureResponse(skillErrorResponse(err, `GET /api/skills/${ref}/file`));
  }
}

export const GETInput = rpcZ.object({
  params: rpcZ.object({ "ref": rpcZ.string().min(1) }).strict(),
  query: rpcZ.object({ "path": rpcZ.string().min(1).max(500) }).strict(),
}).strict();
