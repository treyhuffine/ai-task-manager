import { Notebook, NotebookText } from 'lucide-react';

interface ScratchpadIconProps {
  /** The session's scratchpad markdown. Empty/whitespace ⇒ blank-notebook icon. */
  content?: string | null;
  size?: number;
  className?: string;
}

/**
 * Mirrors {@link NoteIcon}: shows NotebookText (lines) when the scratchpad
 * has content, plain Notebook (blank) when empty. Keeps the scratchpad in
 * the notebook icon family so it stays visually distinct from notes
 * (File / FileText) while sharing the same empty-vs-content convention.
 */
export function ScratchpadIcon({ content, size = 14, className }: ScratchpadIconProps) {
  const hasContent = !!content?.trim();
  const Icon = hasContent ? NotebookText : Notebook;
  return <Icon size={size} className={className} />;
}
