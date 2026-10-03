import { suggestAreas } from '@/lib/onboarding/area-suggestions';

/**
 * POST { about, projects? } → { areas: [{ name, emoji }] }. Suggestions for
 * the main chat's first run. A failure answers with no suggestions rather
 * than an error: the step has presets either way.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { about?: unknown; projects?: unknown };
  const about = typeof body.about === 'string' ? body.about.slice(0, 2000) : '';
  const projects = Array.isArray(body.projects)
    ? body.projects.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 80))
    : [];
  if (!about.trim() && projects.length === 0) return Response.json({ areas: [] });
  try {
    return Response.json({ areas: await suggestAreas({ about, projects }) });
  } catch (err) {
    console.warn('[POST /api/onboarding/area-suggestions] no suggestions', err);
    return Response.json({ areas: [] });
  }
}
