import { expect, it } from 'vitest';
import { isTrpcDrainSave } from './admission';

it('allows only complete batches of known document saves during drain', () => {
  expect(isTrpcDrainSave('POST', '/api/trpc/tasks.update')).toBe(true);
  expect(isTrpcDrainSave('POST', '/api/trpc/tasks.update,notes.update,areas.update')).toBe(true);
  expect(isTrpcDrainSave('POST', '/api/trpc/tasks.update%2Cnotes.update')).toBe(true);
  for (const path of ['tasks.update,tasks.create', 'tasks.update,', 'tasks.update.evil', 'tasks.update/extra', '', '%ZZ']) {
    expect(isTrpcDrainSave('POST', `/api/trpc/${path}`)).toBe(false);
  }
  expect(isTrpcDrainSave('GET', '/api/trpc/tasks.update')).toBe(false);
  expect(isTrpcDrainSave('POST', '/api/tasks/update')).toBe(false);
});
