import { suggestAbout, type ProjectSummary } from '@/lib/onboarding/about-suggestion';

/**
 * POST { userName?, projects: [{ name, titles }] } → { about }. A draft for
 * the main chat's first run. A failure answers with an empty draft rather
 * than an error: the step falls back to asking.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { userName?: unknown; projects?: unknown };
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
    return Response.json({ about: await suggestAbout({ userName, projects }) });
  } catch (err) {
    console.warn('[POST /api/onboarding/about-suggestion] no draft', err);
    return Response.json({ about: '' });
  }
}
