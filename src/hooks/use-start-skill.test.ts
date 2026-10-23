import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { closeSettings, openSettings, useSettingsStore } from '@/components/settings/settings-store';
import { skillKey, useSkills } from './use-skills';
import { useStartSkill } from './use-start-skill';

const fixtures = vi.hoisted(() => ({ create: vi.fn(), overview: vi.fn(), openSkill: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api/skills', () => ({ skillsApi: { create: fixtures.create, overview: fixtures.overview } }));
vi.mock('@/contexts/dashboard-context', () => ({ useOptionalDashboard: () => ({ openSkill: fixtures.openSkill }) }));
vi.mock('sonner', () => ({ toast: { error: fixtures.error } }));
vi.mock('@/lib/api/client', () => ({ apiErrorText: (error: Error) => error.message }));

let root: Root;
let client: QueryClient;
let action: ReturnType<typeof useStartSkill>;
let settings: ReturnType<typeof useSettingsStore>;
function Harness() {
  useSkills(); // Keep the overview actively fetching to catch navigation blocked by invalidation.
  const currentAction = useStartSkill();
  const currentSettings = useSettingsStore();
  useEffect(() => { action = currentAction; settings = currentSettings; }, [currentAction, currentSettings]);
  return null;
}
beforeEach(async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const mock of Object.values(fixtures)) mock.mockReset();
  fixtures.overview.mockImplementation(() => new Promise(() => {}));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  openSettings('plugins', { anchor: 'skills' });
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
});
afterEach(async () => {
  await act(async () => { root.unmount(); closeSettings(); });
  client.clear(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('opens the acknowledged draft immediately while the skill list is still fetching', async () => {
  const skill = { ref: 'draft:new-skill', name: 'new-skill' };
  let acknowledge!: (value: { skill: typeof skill }) => void;
  fixtures.create.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  await act(async () => { action.start(); await vi.advanceTimersByTimeAsync(1); });
  expect(action.isPending).toBe(true);
  expect(settings.open).toBe(true);
  expect(fixtures.openSkill).not.toHaveBeenCalled();
  await act(async () => { acknowledge({ skill }); await vi.advanceTimersByTimeAsync(1); });
  expect(fixtures.create).toHaveBeenCalledWith({});
  expect(client.getQueryData(skillKey(skill.ref))).toEqual(skill);
  expect(fixtures.openSkill).toHaveBeenCalledExactlyOnceWith(skill.ref);
  expect(settings.open).toBe(false);
  expect(client.isFetching()).toBe(1);
  expect(action.isPending).toBe(false);
});

it('keeps the user at the creation entry when the draft cannot be created', async () => {
  fixtures.create.mockRejectedValue(new Error('Could not create the draft'));
  await act(async () => { action.start(); await vi.advanceTimersByTimeAsync(1); });
  expect(fixtures.error).toHaveBeenCalledExactlyOnceWith('Could not create the draft');
  expect(fixtures.openSkill).not.toHaveBeenCalled();
  expect(settings.open).toBe(true);
  expect(action.isPending).toBe(false);
});
