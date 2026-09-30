import { commitSkill } from '@/lib/skills/manage';
import { skillErrorResponse } from '@/lib/skills/http';

export const runtime = 'nodejs';

type Context = { params: Promise<{ ref: string }> };

/**
 * Commit a project skill in its repo, only that skill's files, on the branch
 * the folder has checked out: POST → { skill, commit: { sha, branch, message } }.
 * Never pushes.
 */
export async function POST(_request: Request, { params }: Context) {
  const { ref } = await params;
  try {
    return Response.json(await commitSkill(ref));
  } catch (err) {
    return skillErrorResponse(err, `POST /api/skills/${ref}/commit`);
  }
}
