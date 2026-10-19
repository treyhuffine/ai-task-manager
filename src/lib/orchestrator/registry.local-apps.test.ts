import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('registers app discovery, calls and building without an environment override', async () => {
  vi.stubEnv('RI_LOCAL_APPS', undefined);
  vi.resetModules();
  const { actions } = await import('./registry');
  const names = actions.map((action) => action.name);
  expect(names).toContain('list_apps');
  expect(names).toContain('call_app_action');
  expect(names).toContain('create_app_draft');
  expect(names).toContain('list_tasks');
});

it('removes app tools when the Home explicitly opts out', async () => {
  vi.stubEnv('RI_LOCAL_APPS', '0');
  vi.resetModules();
  const { actions } = await import('./registry');
  const names = actions.map((action) => action.name);
  expect(names).not.toContain('list_apps');
  expect(names).not.toContain('call_app_action');
  expect(names).not.toContain('create_app_draft');
  expect(names).toContain('list_tasks');
});

it.each([undefined, '0'])('always registers the mention-bound source actions (old RI_CHAT_SOURCES=%s is ignored)', async (value) => {
  vi.stubEnv('RI_CHAT_SOURCES', value);
  vi.stubEnv('RI_LOCAL_APPS', '0');
  vi.resetModules();
  const names = (await import('./registry')).actions.map((action) => action.name);
  expect(names).toContain('describe_chat_source');
  expect(names).toContain('call_chat_source');
});
