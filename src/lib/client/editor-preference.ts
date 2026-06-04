'use client';

import { useCallback, useEffect, useState } from 'react';
import { EDITOR_APPS, type EditorTarget } from '@/lib/fs/known-apps';
import { fsApi, type OpenInResult } from '@/lib/api/fs';

/**
 * The user's preferred editor for "Open in editor" actions. Stored
 * per-origin in localStorage so a laptop and a host machine can keep
 * different defaults; the CLI keeps its own (see `src/cli/lib/cli-config.ts`).
 *
 * This is the single editor preference for the whole web client — the
 * settings picker, the file viewer's "Open in editor", and the worktree
 * header all read it. Every open routes through the local `/api/fs/open`
 * spawn endpoint (the old `vscode://` deep links were blind no-ops when the
 * handler wasn't registered).
 *
 * `'custom'` selects a user-defined command (vim/nvim/emacs/…) stored under
 * a second key; the editor list itself is derived from `KNOWN_APPS` so it
 * never drifts from what the open-worktree menu can launch.
 */

export type EditorChoice = EditorTarget | 'custom';

export const EDITOR_PREFERENCE_KEY = 'flow.client.editor';
export const EDITOR_CUSTOM_COMMAND_KEY = 'flow.client.editorCustomCommand';
export const DEFAULT_EDITOR: EditorChoice = 'cursor';

const CHANGE_EVENT = 'flow:editor-preference-changed';

/** Labels for each choice, derived from KNOWN_APPS (strip the "Open in " prefix). */
export const EDITOR_CHOICE_LABELS: Record<EditorChoice, string> = {
  ...(Object.fromEntries(
    EDITOR_APPS.map((a) => [a.target, a.label.replace(/^Open in\s+/i, '')]),
  ) as Record<EditorTarget, string>),
  custom: 'Custom command',
};

export const EDITOR_CHOICES = Object.keys(EDITOR_CHOICE_LABELS) as EditorChoice[];

const VALID_CHOICES = new Set<string>(EDITOR_CHOICES);

/** Migrate legacy values (`jetbrains` → `webstorm`) and validate. */
function normalizeChoice(raw: string | null): EditorChoice {
  if (!raw) return DEFAULT_EDITOR;
  if (raw === 'jetbrains') return 'webstorm';
  return VALID_CHOICES.has(raw) ? (raw as EditorChoice) : DEFAULT_EDITOR;
}

function readChoice(): EditorChoice {
  if (typeof window === 'undefined') return DEFAULT_EDITOR;
  try {
    return normalizeChoice(window.localStorage.getItem(EDITOR_PREFERENCE_KEY));
  } catch {
    return DEFAULT_EDITOR;
  }
}

function readCustomCommand(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(EDITOR_CUSTOM_COMMAND_KEY) ?? '';
  } catch {
    return '';
  }
}

export function useEditorPreference(): {
  choice: EditorChoice;
  customCommand: string;
  setChoice: (next: EditorChoice) => void;
  setCustomCommand: (next: string) => void;
} {
  const [choice, setChoiceState] = useState<EditorChoice>(() => readChoice());
  const [customCommand, setCustomCommandState] = useState<string>(() => readCustomCommand());

  useEffect(() => {
    const sync = () => {
      setChoiceState(readChoice());
      setCustomCommandState(readCustomCommand());
    };
    sync();

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === EDITOR_PREFERENCE_KEY ||
        event.key === EDITOR_CUSTOM_COMMAND_KEY ||
        event.key === null
      ) {
        sync();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setChoice = useCallback((next: EditorChoice) => {
    setChoiceState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(EDITOR_PREFERENCE_KEY, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // localStorage can throw in private mode — non-fatal.
    }
  }, []);

  const setCustomCommand = useCallback((next: string) => {
    setCustomCommandState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(EDITOR_CUSTOM_COMMAND_KEY, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // ignore
    }
  }, []);

  return { choice, customCommand, setChoice, setCustomCommand };
}

/** Display label for the current editor choice (button text, tooltips). */
export function editorChoiceLabel(choice: EditorChoice): string {
  return EDITOR_CHOICE_LABELS[choice];
}

export interface OpenInEditorOptions {
  line?: number;
  column?: number;
  /** Project/worktree root so the editor's tree loads alongside the file. */
  projectDir?: string;
}

/**
 * Returns a function that opens an absolute path in the user's preferred
 * editor — dispatching to the spawn endpoint (known target) or the custom
 * command. The single place every "Open in editor" surface goes through.
 */
export function useOpenInPreferredEditor(): {
  /** The current choice's label, for button text. */
  label: string;
  openInEditor: (absPath: string, opts?: OpenInEditorOptions) => Promise<OpenInResult>;
} {
  const { choice, customCommand } = useEditorPreference();

  const openInEditor = useCallback(
    (absPath: string, opts?: OpenInEditorOptions): Promise<OpenInResult> => {
      if (choice === 'custom') {
        if (!customCommand.trim()) {
          return Promise.resolve({
            ok: false,
            reason: 'failed',
            message: 'No custom editor command set — configure it in Settings.',
          });
        }
        return fsApi.openWithCommand(absPath, customCommand, opts);
      }
      return fsApi.openIn(absPath, choice, opts);
    },
    [choice, customCommand],
  );

  return { label: EDITOR_CHOICE_LABELS[choice], openInEditor };
}
