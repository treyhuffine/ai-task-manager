import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runSourceInvocation } from './source-invocations';
let chat: string;
beforeEach(() => { chat = randomUUID(); });
it('coalesces concurrent retries and reads durable results after completion', async () => {
  const run = vi.fn(async () => ({ ok: true as const, result: { sent: true } }));
  const id = randomUUID();
  const [a, b] = await Promise.all([runSourceInvocation(chat, id, { account: 'work' }, run), runSourceInvocation(chat, id, { account: 'work' }, run)]);
  expect(a).toEqual(b); expect(run).toHaveBeenCalledTimes(1);
  expect(await runSourceInvocation(chat, id, { account: 'work' }, run)).toEqual(a);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(runSourceInvocation(chat, id, { account: 'personal' }, run)).rejects.toThrow(/different/);
});
it('does not replay an indeterminate crash but permits an approval pause retry', async () => {
  const crashed = randomUUID();
  await expect(runSourceInvocation(chat, crashed, {}, async () => { throw new Error('transport lost'); })).rejects.toThrow('transport lost');
  const never = vi.fn();
  await expect(runSourceInvocation(chat, crashed, {}, never)).rejects.toThrow(/unknown outcome/);
  expect(never).not.toHaveBeenCalled();
  const paused = randomUUID();
  const run = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'approval_required', actionId: 'send', risk: 'high' }).mockResolvedValueOnce({ ok: true, result: 'approved' });
  await runSourceInvocation(chat, paused, {}, run);
  expect(await runSourceInvocation(chat, paused, {}, run)).toEqual({ ok: true, result: 'approved' });
  expect(run).toHaveBeenCalledTimes(2);
});
