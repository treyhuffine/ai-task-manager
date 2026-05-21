'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { FolderPickerDialog } from './folder-picker-dialog';

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  /** Open the picker dialog immediately when this component mounts. */
  autoOpen?: boolean;
  /** Fires when the dialog closes without the user choosing a folder
   *  (cancel / X / escape / backdrop). Lets the parent collapse the whole
   *  flow when the picker is the primary surface. */
  onDismiss?: () => void;
}

/**
 * Trigger for the in-app folder picker. Renders the current value (or a
 * placeholder) as a button-styled input; clicking opens the dialog.
 */
export function FolderPicker({
  value,
  onChange,
  placeholder,
  autoOpen,
  onDismiss,
}: FolderPickerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Tracks whether the user actually picked a folder during the current
  // dialog session. Reset on each open so cancel→reopen→choose works.
  const chosenRef = useRef(false);

  // Auto-open on mount when requested. Only on mount — toggling `autoOpen`
  // later shouldn't yank the dialog back open after the user closed it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoOpen) setDialogOpen(true);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (next) chosenRef.current = false;
    setDialogOpen(next);
    if (!next && !chosenRef.current) onDismiss?.();
  };

  const handleChoose = (p: string) => {
    chosenRef.current = true;
    onChange(p);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono bg-background border border-border rounded-md hover:bg-muted/40 transition-colors text-left focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <FolderOpen size={12} className="shrink-0 text-muted-foreground" />
        {value ? (
          <span className="truncate text-foreground">{value}</span>
        ) : (
          <span className="truncate text-muted-foreground/70">
            {placeholder ?? 'Choose folder…'}
          </span>
        )}
      </button>
      <FolderPickerDialog
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        initialPath={value || '~'}
        onChoose={handleChoose}
      />
    </>
  );
}
