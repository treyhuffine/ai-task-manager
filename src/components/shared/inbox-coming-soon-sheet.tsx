"use client";

import { Inbox } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';

interface InboxComingSoonSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InboxComingSoonSheet({ open, onOpenChange }: InboxComingSoonSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl px-6 pb-10 pt-4">
        <div className="w-8 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-6" />
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
            <Inbox size={22} />
          </div>
          <SheetTitle className="text-base font-semibold">Inbox</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground max-w-xs">
            Coming soon — a single place for agent updates, mentions, and things that need your attention.
          </SheetDescription>
        </div>
      </SheetContent>
    </Sheet>
  );
}
