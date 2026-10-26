'use client';
import { useSyncExternalStore } from 'react';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { useReviewPreferences } from './preferences';
import { isLayoutChoice } from './options';

// A client-only presentation slot. The layout owns its contents and operations.
let element: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
function setElement(next: HTMLDivElement | null) { element = next; listeners.forEach(listener => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useReviewRailTarget() { return useSyncExternalStore(subscribe, () => element, () => null); }
export function AppsReviewRailSlot({ children }: { children: React.ReactNode }) {
  const dashboard = useOptionalDashboard();
  const preferences = useReviewPreferences();
  const view = dashboard?.activeView;
  const layout = view?.kind === 'apps' && isLayoutChoice(view.query?.layout) ? view.query.layout : preferences.layout;
  const active = view?.kind === 'apps' && !view.route && layout === 'rail' && !view.query?.provider && !view.query?.mcp;
  // Keep the empty host stable. Reusing it for the normal rail's children
  // would let React replace DOM still owned by the portal during a switch.
  return <><div key="apps-review-slot" ref={setElement} hidden={!active} data-apps-review-rail /><div key="normal-rail" hidden={active}>{children}</div></>;
}
