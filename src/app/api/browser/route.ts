/**
 * Agent browser settings + control for the Settings panel.
 *
 *   GET    → status snapshot (enabled, open, config, detected browsers, audit)
 *   PATCH  { enabled?, chromiumPath? } → update config, return the new snapshot
 *   POST   { action: 'open' | 'stop', url? } → open a headed window (login) or
 *          close the browser (kill switch)
 *
 * The heavy lifting is the orchestrator actions, reused here so the panel and
 * the agent share one code path. Config writes go through writeAuthConfig.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';
import { writeAuthConfig } from '@/lib/auth/config-file';

export const runtime = 'nodejs';

async function statusSnapshot() {
  const env = await runAction('browser_status', {}, { remote: false });
  return env;
}

export async function GET() {
  const env = await statusSnapshot();
  if (!env.ok) {
    return NextResponse.json({ error: env.error?.message ?? 'failed' }, { status: 500 });
  }
  return NextResponse.json(env.result);
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    chromiumPath?: string | null;
    defaultProfile?: string | null;
  };
  if (body.defaultProfile && !/^[a-zA-Z0-9_-]{1,64}$/.test(body.defaultProfile)) {
    return NextResponse.json(
      { error: 'Invalid profile name. Use letters, digits, underscore, or hyphen (max 64).' },
      { status: 400 },
    );
  }
  const patch: Record<string, unknown> = {};
  if ('enabled' in body) patch.browserEnabled = body.enabled;
  if ('chromiumPath' in body) patch.browserChromiumPath = body.chromiumPath || null;
  if ('defaultProfile' in body) patch.browserDefaultProfile = body.defaultProfile || null;
  writeAuthConfig(patch);

  const env = await statusSnapshot();
  return NextResponse.json(env.ok ? env.result : { error: env.error?.message ?? 'failed' }, {
    status: env.ok ? 200 : 500,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; url?: string };

  if (body.action === 'open') {
    const env = await runAction('browser_open', { url: body.url, headless: false }, { remote: false });
    return NextResponse.json(env.ok ? env.result : { error: env.error?.message ?? 'failed' }, {
      status: env.ok ? 200 : 500,
    });
  }

  if (body.action === 'stop') {
    const env = await runAction('browser_close', {}, { remote: false });
    return NextResponse.json(env.ok ? env.result : { error: env.error?.message ?? 'failed' }, {
      status: env.ok ? 200 : 500,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
}
