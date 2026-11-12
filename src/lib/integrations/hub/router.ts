import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { viewerProcedure as p, router } from '@/lib/trpc/init';
import { getHubAppView, listHubAppViews, narrowHubApp, turnOffHubApp } from './manage';

/** What apps can reach through Ri's hub, and the person's controls for it (docs/personal-apps.md "The hub"). */
const id = z.string().min(1).max(200);

export const hubAppsRouter = router({
  list: p.query(() => listHubAppViews()),
  get: p.input(z.object({ id }).strict()).query(async ({ input }) => {
    const app = await getHubAppView(input.id);
    if (!app) throw new TRPCError({ code: 'NOT_FOUND', message: 'This app isn’t connected to Ri’s hub.' });
    return app;
  }),
  turnOff: p.input(z.object({ id }).strict()).mutation(({ input }) => { turnOffHubApp(input.id); return { ok: true }; }),
  narrow: p.input(z.union([
    z.object({ id, connectionId: id, tool: z.string().min(1).max(200).optional() }).strict(),
    z.object({ id, service: z.string().min(1).max(100) }).strict(),
  ])).mutation(({ input }) => {
    const { id: appId, ...remove } = input;
    const grant = narrowHubApp(appId, remove);
    if (!grant) throw new TRPCError({ code: 'NOT_FOUND', message: 'This app isn’t connected to Ri’s hub.' });
    return grant;
  }),
});
