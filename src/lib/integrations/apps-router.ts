import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { viewerProcedure as p, router } from '@/lib/trpc/init';
import { safeReturnPath } from './oauth-return';
import { chatAppTools, setAppToolMode } from './app-tools';
import {
  addPersonalApp, allowPersonalAppInAgent, getPersonalApp, listPersonalApps, PersonalAppError,
  removePersonalApp, removePersonalAppFromAgent,
} from './apps';

/** Personal apps: add one, allow it in an agent with its own connection, remove either (docs/personal-apps.md). */
const id = z.string().min(1).max(200);
const returnTo = z.string().max(2048).optional();

async function run<T>(operation: () => Promise<T> | T): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof PersonalAppError) {
      throw new TRPCError({ code: error.code === 'not_found' ? 'NOT_FOUND' : error.code === 'conflict' ? 'CONFLICT' : 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
}

export const personalAppsRouter = router({
  list: p.query(() => listPersonalApps()),
  get: p.input(z.object({ appId: id }).strict()).query(({ input }) => run(() => getPersonalApp(input.appId))),
  add: p.input(z.object({ name: z.string().max(200), url: z.string().max(2048), returnTo }).strict())
    .mutation(({ input, ctx }) => run(() => addPersonalApp({ ...input, returnTo: safeReturnPath(input.returnTo) ?? undefined }, ctx.request))),
  allow: p.input(z.object({ appId: id, workspaceId: id, returnTo }).strict())
    .mutation(({ input, ctx }) => run(() => allowPersonalAppInAgent({ ...input, returnTo: safeReturnPath(input.returnTo) ?? undefined }, ctx.request))),
  disallow: p.input(z.object({ appId: id, workspaceId: id }).strict())
    .mutation(({ input }) => run(() => removePersonalAppFromAgent(input))),
  remove: p.input(z.object({ appId: id }).strict()).mutation(({ input }) => run(() => removePersonalApp(input.appId))),
  /** The apps a chat may use, each on, automatic or off for it (docs/personal-apps.md "Loading app tools"). */
  chatTools: p.input(z.object({ chatId: id }).strict()).query(({ input }) => chatAppTools(input.chatId)),
  setChatTool: p.input(z.object({ chatId: id, toolkitId: id, mode: z.enum(['on', 'auto', 'off']) }).strict())
    .mutation(async ({ input }) => { await setAppToolMode(input.chatId, input.toolkitId, input.mode); return chatAppTools(input.chatId); }),
});
