'use client';

import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { useClientTheme } from '@/lib/client/theme';
import { cmTheme } from '@/components/executions/viewer/cm-theme';

/**
 * Plain-text markdown editing for SKILL.md. CodeMirror rather than the rich
 * editor on purpose: a skill is read by agents byte for byte, so what you
 * type is exactly what lands (no smart quotes, no re-serialized lists).
 * ⌘S saves now, and leaving the editor saves too. `language` swaps markdown
 * for another grammar, for showing a skill's supporting files.
 */
export function SkillMarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder,
  ariaLabel,
  className,
  minHeight = '240px',
  readOnly = false,
  language,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Keep it stable (useCallback): the editor reconfigures when it changes. */
  onSave: () => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  /** The editor grows with its text from here, and its container scrolls. */
  minHeight?: string;
  readOnly?: boolean;
  /** Markdown when absent. Keep it stable (useMemo), like `onSave`. */
  language?: Extension;
}) {
  const { theme } = useClientTheme();

  const extensions = useMemo(
    () => [
      language ?? markdown(),
      cmTheme(theme === 'dark' ? 'dark' : 'light'),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }]),
      EditorView.domEventHandlers({ blur: () => void onSave() }),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
    ],
    [theme, ariaLabel, placeholder, onSave, readOnly, language],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={theme === 'dark' ? 'dark' : 'light'}
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
      className={className}
      minHeight={minHeight}
    />
  );
}
