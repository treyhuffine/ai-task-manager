'use client';

/**
 * Wrap any chat surface — composer, transcript, the whole panel — and
 * get drag-and-drop file uploads for free. Files dropped anywhere on
 * the wrapped area are forwarded to `onFiles`, which the caller routes
 * into the editor's `uploadFile` (same path used by paste, the paperclip
 * button, and Tiptap's in-editor drop handler).
 *
 * The Tiptap editor already intercepts drops on its own DOM node and
 * inserts chips at the cursor — we explicitly skip handling whenever
 * the inner editor has called `preventDefault`, so dropping straight on
 * the textarea still inserts at the caret instead of double-uploading.
 *
 * Drag depth is counted to handle child enter/leave noise. Without it,
 * the overlay flickers every time the cursor crosses a nested element.
 */

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatDropZoneProps {
  /** Called once per dropped file. The caller uploads + inserts. */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Text rendered in the overlay during a drag. */
  hint?: string;
  children: React.ReactNode;
}

function hasFiles(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

export function ChatDropZone({
  onFiles,
  disabled,
  className,
  style,
  hint = 'Drop to attach',
  children,
}: ChatDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  // Browsers fire dragenter/leave for every nested element the cursor
  // crosses. A simple boolean would flicker; tracking depth keeps the
  // overlay stable while the cursor moves over chips, buttons, etc.
  const depthRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depthRef.current += 1;
    if (depthRef.current === 1) setDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    // Required to allow drop. Also sets the cursor affordance to copy.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    depthRef.current = 0;
    setDragging(false);
    if (disabled) return;
    // Tiptap's prosemirror plugin already preventDefaulted this drop and
    // inserted a chip at the cursor. Bailing here is the difference
    // between "drop on textarea inserts where I clicked" and
    // "drop on textarea uploads the same file twice."
    if (e.defaultPrevented) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    onFiles(files);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn('relative', className)}
      style={style}
    >
      {children}
      {dragging && (
        <div
          // Overlay sits above the chat content but ignores pointer
          // events so the underlying drop target keeps receiving the
          // drag events that drive the depth counter.
          className={cn(
            'pointer-events-none absolute inset-2 z-40 flex items-center justify-center',
            'rounded-lg border-2 border-dashed border-primary/50',
            'bg-primary/10 backdrop-blur-[1px]',
          )}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/95 shadow-md text-[12px] font-medium text-foreground">
            <Upload size={14} className="text-primary" />
            {hint}
          </div>
        </div>
      )}
    </div>
  );
}
