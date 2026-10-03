import { suggestAbout, type ProjectSummary } from '@/lib/onboarding/about-suggestion';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * POST { userName?, projects: [{ name, titles }] } → { about }. A draft for
 * the main chat's first run. A failure answers with an empty draft rather
 * than an error: the step falls back to asking.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { userName?: unknown; projects?: unknown };
  const userName = typeof body.userName === 'string' && body.userName.trim() ? body.userName.trim().slice(0, 80) : null;
  const projects: ProjectSummary[] = Array.isArray(body.projects)
    ? body.projects
      .filter((p): p is { name: unknown; titles: unknown } => !!p && typeof p === 'object')
      .map((p) => ({
        name: typeof p.name === 'string' ? p.name.slice(0, 80) : '',
        titles: Array.isArray(p.titles) ? p.titles.filter((t): t is string => typeof t === 'string').slice(0, 6) : [],
      }))
      .filter((p) => p.name)
      .slice(0, 20)
    : [];
  try {
    return reply({ about: await suggestAbout({ userName, projects }) });
  } catch (err) {
    console.warn('[POST /api/onboarding/about-suggestion] no draft', err);
    return reply({ about: '' });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "userName": rpcZ.string().nullable().optional(), "projects": rpcZ.array(rpcZ.object({ name: rpcZ.string(), titles: rpcZ.array(rpcZ.string()) }).strict()).optional() }).strict().default({}) }).strict();
