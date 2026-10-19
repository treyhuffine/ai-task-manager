import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { viewerProcedure, router } from '@/lib/trpc/init';
import { getApiKey } from '@/lib/db/queries';
import { readConnectedSettings, runSettingsTool, updateConnectedSettings } from './settings';

const serverId = z.string().min(1).max(200);
const value = z.union([z.string().max(10_000), z.number(), z.boolean()]);

/** The signed-in owner viewer, rechecked before and after the server's tools run, as `connectedAppsRouter` does. */
const p = viewerProcedure.use(async ({ctx, next}) => {
  const recheck = () => {
    ctx.authorize?.();
    const key = getApiKey(ctx.key!.apiKeyId);
    if (!key || key.role !== 'sign_in' || key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= Date.now())) throw new TRPCError({code: 'UNAUTHORIZED', message: 'This viewer is no longer signed in'});
  };
  recheck(); const result = await next(); recheck(); return result;
});

/** OpenAI's structured settings for one MCP server, on its connection page (`settings.ts`). */
export const mcpSettingsRouter = router({
  read: p.input(z.object({serverId}).strict()).query(({input}) => readConnectedSettings(input.serverId)),
  update: p.input(z.object({serverId, set: z.record(z.string().min(1).max(200), value).refine(set => Object.keys(set).length > 0 && Object.keys(set).length <= 100)}).strict())
    .mutation(({input}) => updateConnectedSettings(input.serverId, input.set)),
  runTool: p.input(z.object({serverId, tool: z.string().min(1).max(200)}).strict()).mutation(({input}) => runSettingsTool(input.serverId, input.tool)),
});
