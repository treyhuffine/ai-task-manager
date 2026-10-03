import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
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

import { writeAuthConfig } from '@/lib/auth/config-file';
import { runAction } from '@/lib/orchestrator/dispatch';

async function statusSnapshot() {
  const env = await runAction('browser_status', {}, { remote: false });
  return env;
}

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const env = await statusSnapshot();
  if (!env.ok) {
    return reply({ error: env.error?.message ?? 'failed' }, { status: 500 });
  }
  return reply(env.result);
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  const body = (rpcInput.body) as {
    enabled?: boolean;
    chromiumPath?: string | null;
    defaultProfile?: string | null;
  };
  if (body.defaultProfile && !/^[a-zA-Z0-9_-]{1,64}$/.test(body.defaultProfile)) {
    return reply(
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
  return reply(env.ok ? env.result : { error: env.error?.message ?? 'failed' }, {
    status: env.ok ? 200 : 500,
  });
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { action?: string; url?: string };

  if (body.action === 'open') {
    const env = await runAction('browser_open', { url: body.url, headless: false }, { remote: false });
    return reply(env.ok ? env.result : { error: env.error?.message ?? 'failed' }, {
      status: env.ok ? 200 : 500,
    });
  }

  if (body.action === 'stop') {
    const env = await runAction('browser_close', {}, { remote: false });
    return reply(env.ok ? env.result : { error: env.error?.message ?? 'failed' }, {
      status: env.ok ? 200 : 500,
    });
  }

  return reply({ error: `Unknown action: ${body.action}` }, { status: 400 });
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PATCHInput = rpcZ.object({ body: rpcZ.object({ "enabled": rpcZ.boolean().optional(), "chromiumPath": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "defaultProfile": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional() }).strict().default({}) }).strict();
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "action": rpcZ.string().optional(), "url": rpcZ.string().optional() }).strict().default({}) }).strict();
