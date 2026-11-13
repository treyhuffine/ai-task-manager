import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { viewerProcedure as p, router } from '@/lib/trpc/init';
import { getAppSource, getAppSourceForApp, listAppSources } from '@/lib/db/queries';
import { safeReturnPath } from '@/lib/integrations/oauth-return';
import {
  AppBuildError, appBuildSettings, applyChange, createApp, discardChange, getAppJob, installApp, latestAppJob,
  recordAppSource, setAppBuildSettings, startChange,
} from './builder';
import { addCatalogApp, listCatalogApps, updateCatalogApp } from './catalog';
import { appLogs, appStatus, restartApp } from './status';

/** New app and Change app (docs/personal-apps.md "Building and changing apps"). */
const id = z.string().min(1).max(200);

async function run<T>(operation: () => Promise<T> | T): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AppBuildError) {
      throw new TRPCError({ code: error.code === 'not_found' ? 'NOT_FOUND' : error.code === 'conflict' ? 'CONFLICT' : error.code === 'setup' ? 'PRECONDITION_FAILED' : 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
}

const withJob = <T extends { id: string }>(source: T) => ({ ...source, job: latestAppJob(source.id) });

export const appBuildsRouter = router({
  settings: p.query(() => appBuildSettings()),
  setSettings: p.input(z.object({ appsDir: z.string().max(1000).nullable().optional(), appKitCommand: z.string().max(500).nullable().optional() }).strict())
    .mutation(({ input }) => run(() => setAppBuildSettings(input))),
  list: p.query(() => listAppSources().map(withJob)),
  get: p.input(z.object({ id }).strict()).query(({ input }) => {
    const source = getAppSource(input.id);
    if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'That app isn’t in Ri anymore.' });
    return withJob(source);
  }),
  forApp: p.input(z.object({ personalAppId: id }).strict()).query(({ input }) => {
    const source = getAppSourceForApp(input.personalAppId);
    return source ? withJob(source) : null;
  }),
  create: p.input(z.object({ name: z.string().min(1).max(60) }).strict()).mutation(({ input }) => run(() => createApp(input))),
  recordSource: p.input(z.object({ personalAppId: id, name: z.string().min(1).max(60), folder: z.string().max(1000).nullable().optional(), gitUrl: z.string().max(1000).nullable().optional(), notes: z.string().max(4000).nullable().optional() }).strict())
    .mutation(({ input }) => run(() => recordAppSource(input))),
  install: p.input(z.object({ id, returnTo: z.string().max(2048).optional() }).strict())
    .mutation(({ input, ctx }) => run(() => installApp(input.id, ctx.request, safeReturnPath(input.returnTo) ?? undefined))),
  startChange: p.input(z.object({ id }).strict()).mutation(({ input }) => run(() => startChange(input.id))),
  applyChange: p.input(z.object({ id }).strict()).mutation(({ input }) => run(() => applyChange(input.id))),
  discardChange: p.input(z.object({ id }).strict()).mutation(({ input }) => run(() => discardChange(input.id))),
  job: p.input(z.object({ id }).strict()).query(({ input }) => getAppJob(input.id)),
  // The catalog of recommended apps (docs/personal-apps.md "The catalog").
  catalog: p.query(() => listCatalogApps()),
  addFromCatalog: p.input(z.object({ id: z.string().min(1).max(48), returnTo: z.string().max(2048).optional() }).strict())
    .mutation(({ input, ctx }) => run(() => addCatalogApp(input.id, ctx.request, safeReturnPath(input.returnTo) ?? undefined))),
  updateFromCatalog: p.input(z.object({ id }).strict()).mutation(({ input }) => run(() => updateCatalogApp(input.id))),
  // An installed app's state, Restart and Logs, from the kit's own commands (docs/personal-apps.md "Status, Restart and Logs").
  status: p.input(z.object({ id, fresh: z.boolean().optional() }).strict()).query(({ input }) => appStatus(input.id, { fresh: input.fresh })),
  restart: p.input(z.object({ id }).strict()).mutation(({ input }) => run(() => restartApp(input.id))),
  logs: p.input(z.object({ id, lines: z.number().int().min(1).max(2000).optional(), since: z.string().max(40).optional(), change: z.boolean().optional() }).strict())
    .query(({ input }) => run(() => appLogs(input.id, input))),
});
