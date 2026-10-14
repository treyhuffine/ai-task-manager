import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ changed: vi.fn(), subscribe: undefined as undefined | ((listener: () => void) => () => void) }));
vi.mock('react', () => ({ useSyncExternalStore: (subscribe: typeof hooks.subscribe, snapshot: () => unknown) => { hooks.subscribe = subscribe; return snapshot(); } }));
import { closeSettings, openSettings, setSettingsAnchor, setSettingsSection, useSettingsStore } from './settings-store';

beforeEach(() => { closeSettings(); hooks.changed.mockClear(); });

it('treats each creation shortcut as a new navigation intent even at the same address', () => {
  openSettings('plugins', { anchor: 'mcp:new' });
  const first = useSettingsStore();
  const unsubscribe = hooks.subscribe!(hooks.changed);
  openSettings('plugins', { anchor: 'mcp:new' });
  expect(useSettingsStore()).toEqual({ ...first, requestId: first.requestId + 1 });
  expect(hooks.changed).toHaveBeenCalledOnce();
  unsubscribe();
});

it('updates a pane deep link without replaying its opening request', () => {
  openSettings('plugins', { anchor: 'integrations' });
  const first = useSettingsStore();
  setSettingsAnchor('integrations:github');
  expect(useSettingsStore()).toEqual({ ...first, anchor: 'integrations:github' });
  setSettingsSection('general');
  expect(useSettingsStore().anchor).toBeNull();
  setSettingsAnchor('mcp:new');
  expect(useSettingsStore().section).toBe('general');
  expect(useSettingsStore().anchor).toBeNull();
});

it('does not reopen a closed modal when an old pane completes work', () => {
  openSettings('plugins', { anchor: 'mcp:new' });
  closeSettings();
  setSettingsAnchor('mcp:saved-server');
  expect(useSettingsStore().open).toBe(false);
  expect(useSettingsStore().anchor).toBeNull();
});
