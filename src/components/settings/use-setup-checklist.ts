'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { settingsApi } from '@/lib/api/settings';
import { useUserState } from '@/hooks/use-user-state';
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

const DISMISS_KEY = 'flow.setup.dismissed';

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {
    // best-effort; non-fatal
  }
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
    queryFn: () => api.get<{ channels: unknown[] }>('/notifications/channels'),
    enabled,
  });
  const connections = useQuery({
    queryKey: ['connectors', 'connections'],
    queryFn: () => api.get<{ connections: unknown[] }>('/connectors/connections'),
    enabled,
  });

  // SSR-safe: start empty, hydrate from localStorage on mount.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const restore = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const items = useMemo<ChecklistItem[]>(() => {
    // "Tell us about you" == the free-form context. Name alone (often set at
    // onboarding) doesn't count — the description is the substantive part.
    const profileDone = !!userState?.description?.trim();
    const modelDone = !!userState?.defaultAgentHarness;
    const remoteDone = !!baseUrls.data?.tunnel;
    const notificationsDone = (channels.data?.channels.length ?? 0) > 0;
    const connectorsDone = (connections.data?.connections.length ?? 0) > 0;

    const base: Omit<ChecklistItem, 'dismissed'>[] = [
      { id: 'profile', section: 'profile', label: 'Tell us about you', hint: 'Fill this out in the Profile tab any time.', done: profileDone },
      { id: 'model', section: 'models', label: 'Pick a default model', hint: 'Choose one in the Models tab any time.', done: modelDone },
      { id: 'remote', section: 'devices', label: 'Set a remote URL', hint: 'Set your remote URL in the Devices tab any time.', done: remoteDone },
      { id: 'notifications', section: 'notifications', label: 'Turn on notifications', hint: 'Add a channel in the Notifications tab any time.', done: notificationsDone },
      { id: 'connectors', section: 'connectors', label: 'Connect an app', hint: 'Connect one in the Connectors tab any time.', done: connectorsDone },
    ];
    return base.map((i) => ({ ...i, dismissed: dismissed.has(i.id) }));
  }, [userState?.name, userState?.description, userState?.defaultAgentHarness, baseUrls.data, channels.data, connections.data, dismissed]);

  const doneCount = items.filter((i) => i.done).length;
  const pending = items.filter((i) => !i.done && !i.dismissed);
  const ready = !!(userState && baseUrls.data && channels.data && connections.data);

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
