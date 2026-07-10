import type { NextRequest } from 'next/server';
import {
  configureGlobalSkill,
  getGlobalSkillPreference,
} from '@/lib/agent-skills/shipped';
import { cleanupKnownProjectSkillLinks } from '@/lib/agent-skills/project-cleanup';

export const runtime = 'nodejs';

export function GET() {
  const preference = getGlobalSkillPreference();
  return Response.json({
    enabled: preference === true,
    configured: preference !== null,
  });
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return Response.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    const result = await configureGlobalSkill(body.enabled);
    const projectCleanup = await cleanupKnownProjectSkillLinks();

    if (result.enabled && result.install.errors > 0) {
      return Response.json(
        {
          error: 'The user-level skill could not be installed',
          result,
          projectCleanup,
        },
        { status: 500 },
      );
    }

    if (result.enabled && result.install.conflicts > 0) {
      return Response.json(
        {
          error: 'A user-level skill named orchestrator already exists and was left unchanged',
          result,
          projectCleanup,
        },
        { status: 409 },
      );
    }

    return Response.json({ ...result, projectCleanup });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
