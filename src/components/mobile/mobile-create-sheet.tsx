"use client";

import { useCallback, useState } from 'react';
import { Search, CheckSquare, FileText, Layers, MessageSquarePlus, Zap, Plus } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { AreaCreateModal } from '@/components/dashboard/area-create-modal';
import { useCreateNote } from '@/hooks/use-notes';
import { useCreateTask } from '@/hooks/use-tasks';
import { useStartSkill } from '@/hooks/use-start-skill';
import { openSettings } from '@/components/settings/settings-store';
import { openLauncher } from '@/components/workspaces/launcher/launcher-store';
import { PLUGIN_CREATE_ANCHORS } from '@/components/settings/sections/plugins/navigation';
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
  const newSkill = useStartSkill();

  const handleQuickCapture = useCallback(() => {
    setMobileCreateOpen(false);
    setQuickCaptureOpen(true);
  }, [setMobileCreateOpen, setQuickCaptureOpen]);

  // The same launcher as the desktop rail's New chat: no agent picked, the
  // prompt first, then where it runs and on what.
  const handleNewChat = useCallback(() => {
    setMobileCreateOpen(false);
    openLauncher({ workspaceId: null });
  }, [setMobileCreateOpen]);

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

          {/* The two ways to start something: hand work to an agent, or
              get a thought down to sort later. */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <HeroAction
              onClick={handleNewChat}
              icon={MessageSquarePlus}
              label="New chat"
              hint="Put an agent to work"
              className="bg-primary text-primary-foreground shadow-primary/25"
            />
            <HeroAction
              onClick={handleQuickCapture}
              icon={Zap}
              label="Quick Capture"
              hint="Type or speak, triage later"
              className="bg-amber-500 text-white shadow-amber-500/25 [&_svg]:fill-white"
            />
          </div>

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
          <div className="mt-4 grid gap-1 border-t border-border pt-2">
            <button type="button" onClick={() => { setMobileCreateOpen(false); openSettings('plugins', { anchor: PLUGIN_CREATE_ANCHORS.connectService }); }}
              className="flex items-center gap-3 rounded-lg px-2 py-3 text-left text-xs hover:bg-accent">
              <Plus size={17} className="shrink-0 text-muted-foreground" /> Connect a service
            </button>
            <button type="button" disabled={newSkill.isPending} onClick={() => { setMobileCreateOpen(false); newSkill.start(); }}
              className="flex items-center gap-3 rounded-lg px-2 py-3 text-left text-xs hover:bg-accent disabled:opacity-50">
              <Plus size={17} className="shrink-0 text-muted-foreground" /> New skill
            </button>
            <button type="button" onClick={() => { setMobileCreateOpen(false); openSettings('plugins', { anchor: PLUGIN_CREATE_ANCHORS.mcpServer }); }}
              className="flex items-center gap-3 rounded-lg px-2 py-3 text-left text-xs hover:bg-accent">
              <Plus size={17} className="shrink-0 text-muted-foreground" /> Add MCP server
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <AreaCreateModal open={areaOpen} onOpenChange={setAreaOpen} />
    </>
  );
}

function HeroAction({ onClick, icon: Icon, label, hint, className }: {
  onClick: () => void;
  icon: typeof Zap;
  label: string;
  hint: string;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex flex-col items-start gap-2.5 rounded-xl p-3.5 text-left shadow-lg transition-all active:scale-[0.98] active:shadow-md', className)}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-white/20">
        <Icon size={20} />
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px] opacity-80">{hint}</span>
      </span>
    </button>
  );
}
