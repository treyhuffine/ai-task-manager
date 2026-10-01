import { expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { countUnsavedMutations } from './mutation-meta';

it('counts only requests carrying typed input, never work the home finishes on its own', async () => {
  const client = new QueryClient();
  let finishJob!: () => void; let finishSend!: () => void;
  const job = client.getMutationCache().build(client, {
    mutationFn: () => new Promise<void>(resolve => { finishJob = resolve; }),
  });
  const send = client.getMutationCache().build(client, {
    mutationFn: () => new Promise<void>(resolve => { finishSend = resolve; }),
    meta: { carriesInput: true },
  });
  const jobDone = job.execute(undefined);
  expect(client.isMutating()).toBe(1);
  expect(countUnsavedMutations(client)).toBe(0);
  const sendDone = send.execute(undefined);
  expect(countUnsavedMutations(client)).toBe(1);
  await new Promise(resolve => setTimeout(resolve, 0));
  finishSend(); await sendDone;
  expect(countUnsavedMutations(client)).toBe(0);
  finishJob(); await jobDone;
  expect(client.isMutating()).toBe(0);
});
