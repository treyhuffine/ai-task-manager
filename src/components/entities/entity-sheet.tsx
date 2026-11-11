'use client';

import type { ComponentProps, ReactNode, Ref } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

/** One detail frame, focus boundary and close protocol for every Home. */
export function EntitySheet({ open, label, onClose, onCloseAll = onClose, width = 672, fullWidth = false, contentRef, resizing = false, showCloseButton = true, onOpenAutoFocus, onCloseAutoFocus, children }: {
  open: boolean;
  label: string;
  onClose: () => void;
  onCloseAll?: () => void;
  width?: number;
  fullWidth?: boolean;
  contentRef?: Ref<HTMLDivElement>;
  resizing?: boolean;
  showCloseButton?: boolean;
  onOpenAutoFocus?: ComponentProps<typeof SheetContent>['onOpenAutoFocus'];
  onCloseAutoFocus?: ComponentProps<typeof SheetContent>['onCloseAutoFocus'];
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onCloseAll()}>
      <SheetContent side="right" ref={contentRef} showCloseButton={showCloseButton}
        className="flex-row gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-none"
        style={{ width: fullWidth ? '100vw' : `min(${width}px, 100vw)` }}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onInteractOutside={(event) => { if (resizing) event.preventDefault(); }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (event.target instanceof Element && event.target.closest('[data-cancel-on-escape]')) return;
          // Escape closes one frame. Its content may move back into an
          // underlying panel synchronously as onClose runs.
          event.stopPropagation();
          if (event.shiftKey) onCloseAll(); else onClose();
        }}
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
