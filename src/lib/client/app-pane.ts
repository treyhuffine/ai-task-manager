"use client";

import { useCallback, useSyncExternalStore } from "react";

type AppPane = "closed" | "chat" | "app";
// The dashboard replaces its page tree at tablet/phone breakpoints. Keep the
// chosen pane for this browser session so resizing doesn't close an app chat.
// This is UI state only. Draft text stays in the existing chat draft store.
const panes = new Map<string, AppPane>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const serverSnapshot = (): AppPane => "closed";
function setAppPane(id: string, next: AppPane) {
  panes.set(id, next);
  for (const listener of listeners) listener();
}
// An explicit library action opens chat even after it was previously closed.
export function openAppChat(id: string) {
  setAppPane(id, "chat");
}
export function useAppPane(id: string, initial: AppPane = "closed") {
  const read = useCallback(() => panes.get(id) ?? initial, [id, initial]);
  const mode = useSyncExternalStore(subscribe, read, serverSnapshot);
  const setMode = useCallback(
    (next: AppPane) => {
      setAppPane(id, next);
    },
    [id],
  );
  return { mode, setMode };
}
