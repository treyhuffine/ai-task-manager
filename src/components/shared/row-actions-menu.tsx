"use client";

import { useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface RowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  title?: string;
  className?: string;
  iconSize?: number;
}

export function RowActionsMenu({ actions, title = 'Actions', className, iconSize = 16 }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          'md:hidden p-1.5 rounded-md text-muted-foreground active:bg-muted transition-colors',
          className,
        )}
        aria-label={title}
      >
        <MoreHorizontal size={iconSize} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl px-3 pb-6 pt-3">
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-3" />
          <div className="flex flex-col">
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
                className={cn(
                  'flex items-center gap-3 px-3 py-3.5 rounded-lg active:bg-muted transition-colors text-left',
                  action.destructive ? 'text-red-500' : 'text-foreground',
                )}
              >
                <action.icon size={18} className="flex-shrink-0" />
                <span className="text-sm font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
