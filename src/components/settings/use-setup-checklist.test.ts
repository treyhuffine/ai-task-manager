import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { useSetupChecklist, type SetupChecklist } from './use-setup-checklist';

// The data sources aren't what's under test: every query reads as not loaded.
vi.mock('@/hooks/use-user-state', () => ({ useUserState: () => ({ data: undefined }) }));
vi.mock('@/lib/api/settings', () => ({ settingsApi: {} }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { externalAi: { list: { queryOptions: () => ({ queryKey: ['agent-keys'] }) } } },
  trpcClient: {},
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isFetched: false }) }));

const DISMISS_KEY = 'ri.setup.dismissed';
let roots: Root[];
let stored: Map<string, string>;
let win: Window & typeof globalThis;
let latest: Record<string, SetupChecklist>;

function Probe({ name }: { name: string }) {
  const checklist = useSetupChecklist(true);
  useLayoutEffect(() => { latest[name] = checklist; });
  return null;
}

function mount(name: string) {
  const root = createRoot(document.createElement('div') as unknown as HTMLElement);
  roots.push(root);
  act(() => root.render(createElement(Probe, { name })));
}

const dismissedIds = (name: string) => latest[name].items.filter((i) => i.dismissed).map((i) => i.id);

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  win = window as unknown as Window & typeof globalThis;
  stored = new Map();
  Object.assign(win, {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', document);
  vi.stubGlobal('Event', win.Event);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  roots = [];
  latest = {};
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('setup checklist dismissals', () => {
  it("starts from the browser's saved dismissals", () => {
    stored.set(DISMISS_KEY, JSON.stringify(['remote', 'browser']));
    mount('modal');
    expect(dismissedIds('modal')).toEqual(['remote', 'browser']);
  });

  it('saves a dismissal and a restore, and every copy of the checklist follows', () => {
    mount('modal');
    mount('tab');
    act(() => latest.modal.dismiss('notifications'));
    expect(JSON.parse(stored.get(DISMISS_KEY)!)).toEqual(['notifications']);
    expect(dismissedIds('modal')).toEqual(['notifications']);
    expect(dismissedIds('tab')).toEqual(['notifications']);

    act(() => latest.tab.restore('notifications'));
    expect(JSON.parse(stored.get(DISMISS_KEY)!)).toEqual([]);
    expect(dismissedIds('modal')).toEqual([]);
  });

  it('follows a dismissal made in another tab', () => {
    mount('modal');
    stored.set(DISMISS_KEY, JSON.stringify(['profile']));
    act(() => { win.dispatchEvent(Object.assign(new win.Event('storage'), { key: DISMISS_KEY })); });
    expect(dismissedIds('modal')).toEqual(['profile']);
  });

  it('reads a malformed saved list as nothing dismissed', () => {
    stored.set(DISMISS_KEY, '[not json');
    mount('modal');
    expect(dismissedIds('modal')).toEqual([]);
  });

  it('renders on the server with nothing dismissed', () => {
    vi.stubGlobal('window', undefined);
    function ServerProbe() {
      const { items } = useSetupChecklist(true);
      return createElement('p', null, `dismissed:${items.filter((i) => i.dismissed).length}`);
    }
    expect(renderToString(createElement(ServerProbe))).toContain('dismissed:0');
  });
});
