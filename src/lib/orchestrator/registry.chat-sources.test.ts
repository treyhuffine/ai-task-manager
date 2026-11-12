import { afterEach, expect, it, vi } from 'vitest';

// Importing the whole action registry cold takes several seconds.
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('registers no local app actions, since Ri no longer runs local apps', async () => {
  vi.resetModules();
  const names = (await import('./registry')).actions.map((action) => action.name);
  for (const removed of ['list_apps', 'describe_app', 'call_app_action', 'create_app_draft', 'build_app_draft', 'get_app_workflow']) {
    expect(names).not.toContain(removed);
  }
  expect(names).toContain('list_tasks');
});

it.each([undefined, '0'])('always registers the mention-bound source actions (old RI_CHAT_SOURCES=%s is ignored)', async (value) => {
  vi.stubEnv('RI_CHAT_SOURCES', value);
  vi.resetModules();
  const names = (await import('./registry')).actions.map((action) => action.name);
  expect(names).toContain('describe_chat_source');
  expect(names).toContain('call_chat_source');
});
