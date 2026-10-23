'use client';

import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/** Navigation and settings operations belong to the active Home's adapter. */
export function SettingsPanel({ navigation, title, description, children, compact, bodyRef, bodyClassName, onOpenAutoFocus }: {
  navigation?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  compact?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  bodyClassName?: string;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  return <DialogContent
    className={cn('flex max-h-[92dvh] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0', compact ? 'sm:max-w-xl' : 'h-[800px] sm:max-w-6xl sm:flex-row')}
    onOpenAutoFocus={onOpenAutoFocus}
  >
    {navigation}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DialogHeader className="gap-1 border-b border-border px-5 py-4 pr-12 text-left">
        <DialogTitle className="text-[15px] font-semibold">{title}</DialogTitle>
        <DialogDescription className="text-[12px] leading-snug">{description}</DialogDescription>
      </DialogHeader>
      <div ref={bodyRef} data-settings-scroll className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-5', bodyClassName)}>
        {children}
      </div>
    </div>
  </DialogContent>;
}
