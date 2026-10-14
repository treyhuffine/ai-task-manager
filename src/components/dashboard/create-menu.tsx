"use client";

import { useState, useCallback } from "react";
import { Plus, CheckSquare, FileText, Layers, Zap } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { AreaCreateModal } from "./area-create-modal";
import { useCreateNote } from "@/hooks/use-notes";
import { useCreateTask } from "@/hooks/use-tasks";
import { useDashboard } from "@/contexts/dashboard-context";
import { HOTKEYS } from "@/constants/commands";
import { Tip } from "@/components/ui/tip";
import { useStartSkill } from "@/hooks/use-start-skill";
import { openSettings } from "@/components/settings/settings-store";
import { PLUGIN_CREATE_ANCHORS } from "@/components/settings/sections/plugins/navigation";

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);

  const createNote = useCreateNote();
  const createTask = useCreateTask();
  const newSkill = useStartSkill();
  const { openNote, openTask, setQuickCaptureOpen } = useDashboard();

  const handleQuickCapture = useCallback(() => {
    setOpen(false);
    setQuickCaptureOpen(true);
  }, [setQuickCaptureOpen]);

  const handleNewTask = useCallback(() => {
    setOpen(false);
    createTask.mutate(
      { title: " ", rawInput: " " },
      {
        onSuccess: (task) => {
          openTask(task.id);
        },
      }
    );
  }, [createTask, openTask]);

  const handleNewNote = useCallback(() => {
    setOpen(false);
    createNote.mutate(
      { body: " " },
      {
        onSuccess: (note) => {
          openNote(note.id);
        },
      }
    );
  }, [createNote, openNote]);

  const handleNewArea = useCallback(() => {
    setOpen(false);
    setAreaOpen(true);
  }, []);


  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Tip label="Create" onlyWhenTextHidden>
            <button type="button" aria-label="Create" className="hud-create flex shrink-0 items-center gap-1 whitespace-nowrap px-3 py-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-lg shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95">
              <Plus size={14} className="shrink-0" /> <span className="hud-create-label">CREATE</span>
            </button>
          </Tip>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[240px] p-1.5"
          // Each item here navigates into a new surface (task/note slideout,
          // area modal, quick capture) that focuses its own field. Don't let the
          // popover snap focus back to the CREATE trigger as it closes, or it
          // steals the caret from the freshly opened new task's title.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Quick Capture — hero action, spans full width */}
          <button
            onClick={handleQuickCapture}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent transition-colors group mb-1"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center group-hover:bg-amber-500/25 transition-colors flex-shrink-0">
              <Zap size={16} className="text-amber-500" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-[11px] font-semibold text-foreground">Quick Capture</div>
              <div className="text-[10px] text-muted-foreground truncate">
                Type or speak. Sort later
              </div>
            </div>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/70 font-sans flex-shrink-0">
              {HOTKEYS.quickCapture.label}
            </kbd>
          </button>

          <div className="h-px bg-border my-1" />

          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={handleNewTask}
              className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg hover:bg-accent transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <CheckSquare size={16} className="text-primary" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Task
              </span>
            </button>

            <button
              onClick={handleNewNote}
              className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg hover:bg-accent transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <FileText size={16} className="text-emerald-500" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Note
              </span>
            </button>

            <button
              onClick={handleNewArea}
              className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg hover:bg-accent transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-accent transition-colors">
                <Layers size={16} className="text-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Area
              </span>
            </button>

          </div>
          <div className="h-px bg-border my-1" />
          <button type="button" onClick={() => { setOpen(false); openSettings('plugins', { anchor: PLUGIN_CREATE_ANCHORS.connectService }); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] hover:bg-accent">
            <Plus size={15} className="shrink-0 text-muted-foreground" /> Connect a service
          </button>
          <button type="button" disabled={newSkill.isPending} onClick={() => { setOpen(false); newSkill.start(); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] hover:bg-accent disabled:opacity-50">
            <Plus size={15} className="shrink-0 text-muted-foreground" /> New skill
          </button>
          <button type="button" onClick={() => { setOpen(false); openSettings('plugins', { anchor: PLUGIN_CREATE_ANCHORS.mcpServer }); }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] hover:bg-accent">
            <Plus size={15} className="shrink-0 text-muted-foreground" /> Add MCP server
          </button>
        </PopoverContent>
      </Popover>

      <AreaCreateModal open={areaOpen} onOpenChange={setAreaOpen} />
    </>
  );
}
