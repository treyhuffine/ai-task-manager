import { suggestAreas } from '@/lib/onboarding/area-suggestions';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * POST { about, projects? } → { areas: [{ name, emoji }] }. Suggestions for
 * the main chat's first run. A failure answers with no suggestions rather
 * than an error: the step has presets either way.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { about?: unknown; projects?: unknown };
  const about = typeof body.about === 'string' ? body.about.slice(0, 2000) : '';
  const projects = Array.isArray(body.projects)
    ? body.projects.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 80))
    : [];
  if (!about.trim() && projects.length === 0) return reply({ areas: [] });
  try {
    return reply({ areas: await suggestAreas({ about, projects }) });
  } catch (err) {
    console.warn('[POST /api/onboarding/area-suggestions] no suggestions', err);
    return reply({ areas: [] });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "about": rpcZ.string().optional(), "projects": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
