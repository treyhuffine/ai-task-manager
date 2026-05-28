"use client";

import { useCallback, useState } from 'react';
import { Search, CheckSquare, FileText, Layers, Zap, ChevronRight } from 'lucide-react';
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
  { id: 'task', label: 'Task', icon: CheckSquare, color: 'text-background', bg: 'bg-primary' },
  { id: 'note', label: 'Note', icon: FileText, color: 'text-background', bg: 'bg-primary' },
  { id: 'area', label: 'Area', icon: Layers, color: 'text-background', bg: 'bg-primary' },
  { id: 'search', label: 'Search', icon: Search, color: 'text-blue-600', bg: 'bg-blue-400/20' },
] as const;

export function MobileCreateSheet() {
  const { mobileCreateOpen, setMobileCreateOpen, openNote, openTask, setQuickCaptureOpen } = useDashboard();
  const [areaOpen, setAreaOpen] = useState(false);
  const createNote = useCreateNote();
  const createTask = useCreateTask();

  const handleQuickCapture = useCallback(() => {
    setMobileCreateOpen(false);
    setQuickCaptureOpen(true);
  }, [setMobileCreateOpen, setQuickCaptureOpen]);

  const handleAction = useCallback((id: string) => {
    setMobileCreateOpen(false);

    if (id === 'search') {
      document.dispatchEvent(new CustomEvent('open-search'));
      return;
    }

    if (id === 'task') {
      createTask.mutate(
        { title: ' ', rawInput: ' ' },
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
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-5" />

          {/* Quick Capture — hero action */}
          <button
            onClick={handleQuickCapture}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-amber-500 text-white shadow-lg shadow-amber-500/25 active:scale-[0.98] active:shadow-md transition-all mb-4"
          >
            <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Zap size={22} className="text-white fill-white" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold">Quick Capture</div>
              <div className="text-[11px] text-white/80">
                Type or speak — triage later
              </div>
            </div>
            <ChevronRight size={18} className="text-white/70 flex-shrink-0" />
          </button>

          <div className="grid grid-cols-4 gap-3">
            {ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                className="flex flex-col items-center gap-2 py-1 rounded-xl hover:bg-muted/50 active:scale-95 transition-all"
              >
                <div className={cn(
                  'w-full rounded-xl flex items-center justify-center aspect-square',
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
