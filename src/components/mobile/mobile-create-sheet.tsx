"use client";

import { useCallback, useState } from 'react';
import { Search, CheckSquare, FileText, Layers } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { AreaCreateModal } from '@/components/dashboard/area-create-modal';
import { useCreateNote } from '@/hooks/use-notes';
import { useCreateTask } from '@/hooks/use-tasks';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';

const ACTIONS = [
  { id: 'search', label: 'Search', icon: Search, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  { id: 'task', label: 'New Task', icon: CheckSquare, color: 'text-primary', bg: 'bg-primary/10' },
  { id: 'note', label: 'New Note', icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { id: 'area', label: 'New Area', icon: Layers, color: 'text-violet-500', bg: 'bg-violet-500/10' },
] as const;

export function MobileCreateSheet() {
  const { mobileCreateOpen, setMobileCreateOpen, openNote, openTask } = useDashboard();
  const [areaOpen, setAreaOpen] = useState(false);
  const createNote = useCreateNote();
  const createTask = useCreateTask();

  const handleAction = useCallback((id: string) => {
    setMobileCreateOpen(false);

    if (id === 'search') {
      // Trigger the global search overlay
      document.dispatchEvent(new CustomEvent('open-search'));
      return;
    }

    if (id === 'task') {
      createTask.mutate(
        { title: ' ', raw_input: ' ' },
        { onSuccess: (task) => openTask(task.id) }
      );
      return;
    }

    if (id === 'note') {
      createNote.mutate(
        { body: ' ' },
        { onSuccess: (note) => openNote(note.id) }
      );
      return;
    }

    if (id === 'area') {
      setAreaOpen(true);
    }
  }, [setMobileCreateOpen, createTask, createNote, openTask, openNote]);

  return (
    <>
      <Sheet open={mobileCreateOpen} onOpenChange={setMobileCreateOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl px-6 pb-8 pt-4">
          <SheetTitle className="sr-only">Quick Actions</SheetTitle>

          {/* Drag handle */}
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-6" />

          <div className="grid grid-cols-4 gap-3">
            {ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-muted/50 active:scale-95 transition-all"
              >
                <div className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center',
                  action.bg
                )}>
                  <action.icon size={22} className={action.color} />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <AreaCreateModal open={areaOpen} onOpenChange={setAreaOpen} />
    </>
  );
}
