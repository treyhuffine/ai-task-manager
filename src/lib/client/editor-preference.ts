'use client';

import { useEffect, useState } from 'react';

/**
 * The user's preferred editor for "Open in editor" deep links. Stored
 * per-origin in localStorage so a laptop and a host machine can have
 * different defaults. The CLI keeps its own preference (laptop-local,
 * not synced) — see `src/cli/lib/cli-config.ts`.
 */

export type EditorPreference = 'cursor' | 'vscode' | 'jetbrains';

export const EDITOR_PREFERENCE_KEY = 'flow.client.editor';

export const DEFAULT_EDITOR: EditorPreference = 'cursor';

export const EDITOR_LABELS: Record<EditorPreference, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  jetbrains: 'JetBrains',
};

function readEditor(): EditorPreference {
  if (typeof window === 'undefined') return DEFAULT_EDITOR;
  try {
    const raw = window.localStorage.getItem(EDITOR_PREFERENCE_KEY);
    if (raw === 'cursor' || raw === 'vscode' || raw === 'jetbrains') return raw;
  } catch {
    // ignore
  }
  return DEFAULT_EDITOR;
}

export function useEditorPreference(): {
  editor: EditorPreference;
  setEditor: (next: EditorPreference) => void;
} {
  const [editor, setEditorState] = useState<EditorPreference>(() => readEditor());

  useEffect(() => {
    setEditorState(readEditor());

    function onStorage(event: StorageEvent) {
      if (event.key === EDITOR_PREFERENCE_KEY || event.key === null) {
        setEditorState(readEditor());
      }
    }
    window.addEventListener('storage', onStorage);

    function onLocal() {
      setEditorState(readEditor());
    }
    window.addEventListener('flow:editor-preference-changed', onLocal);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('flow:editor-preference-changed', onLocal);
    };
  }, []);

  function setEditor(next: EditorPreference) {
    setEditorState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(EDITOR_PREFERENCE_KEY, next);
      window.dispatchEvent(new Event('flow:editor-preference-changed'));
    } catch {
      // ignore
    }
  }

  return { editor, setEditor };
}
