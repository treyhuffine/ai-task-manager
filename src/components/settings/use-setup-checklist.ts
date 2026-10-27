'use client';

import { useUserState } from '@/hooks/use-user-state';
import { settingsApi } from '@/lib/api/settings';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SectionId } from './settings-sections';

/**
 * Drives the "Get started" checklist. Each item's "done" is derived from real
 * data (no separate progress flags to drift); "dismissed" is a per-browser
 * opt-out persisted in localStorage. The same hook feeds the Get-started tab
 * (count + list) and the per-section attention dot, so they can't disagree.
 */
export interface ChecklistItem {
  id: string;
  label: string;
  /** Where the "Set up" button jumps to. */
  section: SectionId;
  /** Inline guidance shown in place of the button once dismissed. */
  hint: string;
  done: boolean;
  dismissed: boolean;
}

const DISMISS_KEY = 'ri.setup.dismissed';

const DISMISS_CHANGE_EVENT = 'ri:setup-dismissed-changed';

/** The stored list as text, so the snapshot only changes when the list does. */
function readDismissed(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function parseDismissed(raw: string | null): Set<string> {
  try {
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function subscribeDismissed(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISMISS_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(DISMISS_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(DISMISS_CHANGE_EVENT, onChange);
  };
}

/** Nothing is dismissed on the server render, and hydration then reads the browser's list. */
function serverDismissed(): string | null {
  return null;
}

function saveDismissed(ids: Set<string>): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {
    // best-effort; non-fatal
  }
  window.dispatchEvent(new Event(DISMISS_CHANGE_EVENT));
}

export interface SetupChecklist {
  items: ChecklistItem[];
  doneCount: number;
  total: number;
  /** Show the Get-started tab while any item is neither done nor dismissed. */
  showGetStarted: boolean;
  /** True once every data source has loaded — `showGetStarted` is trustworthy. */
  ready: boolean;
  dismiss: (id: string) => void;
  restore: (id: string) => void;
}

export function useSetupChecklist(enabled: boolean): SetupChecklist {
  const { data: userState } = useUserState();
  const baseUrls = useQuery({ queryKey: ['settings', 'base-url'], queryFn: () => settingsApi.getBaseUrls(), enabled });
  const channels = useQuery({
    queryKey: ['notifications', 'channels'],
    queryFn: () => trpcClient.notifications.channelsGet.query({}),
    enabled,
  });
  const connections = useQuery({
    queryKey: ['integrations', 'connections'],
    queryFn: () => trpcClient.integrations.connectionsGet.query({}),
    enabled,
  });
  const browser = useQuery({
    queryKey: ['browser', 'status'],
    queryFn: () => trpcClient.browser.list.query({}),
    enabled,
  });
  const agentKeys = useQuery({ ...trpc.externalAi.list.queryOptions(), enabled });

  // Per-browser, read from localStorage. Every copy of the checklist and every
  // tab follows a dismissal, and the server render starts with none.
  const dismissedRaw = useSyncExternalStore(subscribeDismissed, readDismissed, serverDismissed);
  const dismissed = useMemo(() => parseDismissed(dismissedRaw), [dismissedRaw]);

  const dismiss = useCallback((id: string) => {
    saveDismissed(parseDismissed(readDismissed()).add(id));
  }, []);

  const restore = useCallback((id: string) => {
    const next = parseDismissed(readDismissed());
    next.delete(id);
    saveDismissed(next);
  }, []);

  const items = useMemo<ChecklistItem[]>(() => {
    // "Tell your assistant about you" == the free-form context. Name alone (often set at
    // onboarding) doesn't count — the description is the substantive part.
    const profileDone = !!userState?.description?.trim();
    const modelDone = !!userState?.defaultHarness;
    const remoteDone = !!baseUrls.data?.tunnel;
    const notificationsDone = (channels.data?.channels.length ?? 0) > 0;
    const integrationsDone = (connections.data?.connections.length ?? 0) > 0;
    // Done when the capability is on and a browser is available. Signing into a
    // site is the optional next step, surfaced in the Browser tab itself.
    const browserDone = !!browser.data?.enabled && (browser.data?.config.detected.length ?? 0) > 0;
    // Any outside agent with its own key: Set up, its steps or its setup prompt.
    const agentDone = (agentKeys.data?.length ?? 0) > 0;

    const base: Omit<ChecklistItem, 'dismissed'>[] = [
      { id: 'profile', section: 'profile', label: 'Tell your assistant about you', hint: 'Fill this out in the Profile tab any time.', done: profileDone },
      { id: 'model', section: 'models', label: 'Pick a default model', hint: 'Choose one in the Models tab any time.', done: modelDone },
      { id: 'connect-agent', section: 'external-ai', label: 'Connect your agent', hint: 'Connect Claude Code, Codex or another agent in Connect your agent any time.', done: agentDone },
      { id: 'remote', section: 'devices', label: 'Set a remote URL', hint: 'Set your remote URL in the Devices tab any time.', done: remoteDone },
      { id: 'notifications', section: 'notifications', label: 'Turn on notifications', hint: 'Add a channel in the Notifications tab any time.', done: notificationsDone },
      // Ids are saved in DISMISS_KEY, so this one keeps its pre-rename spelling.
      { id: 'connectors', section: 'plugins', label: 'Connect an app', hint: 'Connect one in Plugins any time.', done: integrationsDone },
      { id: 'browser', section: 'browser', label: 'Set up the agent browser', hint: 'Pick a browser and sign into sites in the Browser tab any time.', done: browserDone },
    ];
    return base.map((i) => ({ ...i, dismissed: dismissed.has(i.id) }));
  }, [userState?.description, userState?.defaultHarness, baseUrls.data, channels.data, connections.data, browser.data, agentKeys.data, dismissed]);

  const doneCount = items.filter((i) => i.done).length;
  const pending = items.filter((i) => !i.done && !i.dismissed);
  // The agent check is optional to setup, so a failed one doesn't hold the tab back.
  const ready = !!(userState && baseUrls.data && channels.data && connections.data && browser.data && agentKeys.isFetched);

  return {
    items,
    doneCount,
    total: items.length,
    showGetStarted: pending.length > 0,
    ready,
    dismiss,
    restore,
  };
}
