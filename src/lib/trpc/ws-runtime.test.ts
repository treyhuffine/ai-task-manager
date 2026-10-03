import { afterEach, expect, it } from 'vitest';
import { initTRPC } from '@trpc/server';
import { liveApplicationRouter, publishApplicationRouter } from './ws-runtime';
const t = initTRPC.create();
afterEach(() => { delete globalThis.__riTRPCRouter; });
it('lets an existing socket use the current procedure definition after route hot reload', async () => {
  const before = t.router({ value: t.procedure.query(() => 'before') });
  const current = liveApplicationRouter(before);
  expect(await t.createCallerFactory(current)({}).value()).toBe('before');
  const after = t.router({ value: t.procedure.query(() => 'after') });
  publishApplicationRouter(after);
  const caller = t.createCallerFactory(current)({});
  expect(await caller.value()).toBe('after');
});
