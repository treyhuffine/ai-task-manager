"use client";

import { useState, useCallback, useRef } from "react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import {
  Expand,
  Paperclip,
  Calendar,
  Gauge,
  Zap,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { useCreateTask } from "@/hooks/use-tasks";
import { useAreas } from "@/hooks/use-areas";
import { useDashboard } from "@/contexts/dashboard-context";
import { useCreateNote } from "@/hooks/use-notes";
import { RichEditor } from "@/components/editor/rich-editor";
import { cn } from "@/lib/utils";
import type { Effort, Energy, Attachment } from "@/db/types";

interface TaskCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: "trivial", label: "Trivial" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "epic", label: "Epic" },
];

const ENERGY_OPTIONS: { value: Energy; label: string; icon: string }[] = [
  { value: "deep", label: "Deep work", icon: "🧠" },
  { value: "light", label: "Light task", icon: "⚡" },
];

export function TaskCreateModal({ open, onOpenChange }: TaskCreateModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("");
  const [effort, setEffort] = useState<Effort | null>(null);
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [showEffortPicker, setShowEffortPicker] = useState(false);
  const [showEnergyPicker, setShowEnergyPicker] = useState(false);
  const [showAreaPicker, setShowAreaPicker] = useState(false);

  const descriptionRef = useRef(description);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
  }, []);

  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const { data: areas } = useAreas();
  const { openNote } = useDashboard();

  const selectedArea = areas?.find((a) => a.id === areaId);

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    descriptionRef.current = "";
    pendingAttachmentsRef.current = [];
    setAreaId(null);
    setDeadline("");
    setEffort(null);
    setEnergy(null);
    setShowEffortPicker(false);
    setShowEnergyPicker(false);
    setShowAreaPicker(false);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || createTask.isPending) return;

    const attachments = pendingAttachmentsRef.current;
    createTask.mutate(
      {
        title: trimmedTitle,
        raw_input: trimmedTitle,
        description: descriptionRef.current.trim() || undefined,
        area_id: areaId,
        hard_deadline: deadline || undefined,
        effort: effort ?? undefined,
        energy: energy ?? undefined,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      }
    );
  }, [
    title,
    areaId,
    deadline,
    effort,
    energy,
    createTask,
    onOpenChange,
    resetForm,
  ]);

  const handleExpand = useCallback(() => {
    const trimmedTitle = title.trim();
    const body = descriptionRef.current.trim() || " ";
    const attachments = pendingAttachmentsRef.current;
    createNote.mutate(
      {
        title: trimmedTitle || undefined,
        body,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      {
        onSuccess: (note) => {
          resetForm();
          onOpenChange(false);
          openNote(note.id);
        },
      }
    );
  }, [title, createNote, onOpenChange, openNote, resetForm]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleDescriptionChange = useCallback((markdown: string) => {
    descriptionRef.current = markdown;
    setDescription(markdown);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resetForm();
      onOpenChange(open);
    },
    [onOpenChange, resetForm]
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] duration-200">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Create task</DialogPrimitive.Title>
            <DialogPrimitive.Description>Create a new task</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Title + expand */}
            <div className="flex items-start justify-between px-5 pt-5 pb-0">
              <div className="flex-1 mr-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  placeholder="Task name"
                  className="w-full text-lg font-semibold bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                  autoFocus
                />
              </div>
              <button
                onClick={handleExpand}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                title="Expand to full editor"
              >
                <Expand size={16} />
              </button>
            </div>

            {/* Description — TipTap rich editor */}
            <div className="px-5 pt-1 pb-3">
              <div className="min-h-[7rem] max-h-[14rem] overflow-y-auto rounded-lg">
                {open && (
                  <RichEditor
                    key="task-description"
                    content={description}
                    onChange={handleDescriptionChange}
                    onAttachment={handleAttachment}
                    placeholder="Description"
                    hideFooter
                    className="text-sm [&_.rich-editor-body]:min-h-[6rem]"
                  />
                )}
              </div>
            </div>

            {/* Action chips */}
            <div className="flex items-center gap-2 px-5 pb-4 flex-wrap">
              {/* Deadline */}
              <div className="relative">
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors",
                    deadline
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Calendar size={13} />
                  {deadline
                    ? new Date(deadline + "T00:00:00").toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" }
                      )
                    : "Deadline"}
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
              </div>

              {/* Effort */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowEffortPicker(!showEffortPicker);
                    setShowEnergyPicker(false);
                    setShowAreaPicker(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors",
                    effort
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Gauge size={13} />
                  {effort
                    ? EFFORT_OPTIONS.find((o) => o.value === effort)?.label
                    : "Effort"}
                </button>
                {showEffortPicker && (
                  <div className="absolute top-full left-0 mt-1 z-10 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[120px]">
                    {EFFORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setEffort(
                            effort === opt.value ? null : opt.value
                          );
                          setShowEffortPicker(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                          effort === opt.value && "text-primary font-semibold"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Energy */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowEnergyPicker(!showEnergyPicker);
                    setShowEffortPicker(false);
                    setShowAreaPicker(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors",
                    energy
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Zap size={13} />
                  {energy
                    ? ENERGY_OPTIONS.find((o) => o.value === energy)?.label
                    : "Energy"}
                </button>
                {showEnergyPicker && (
                  <div className="absolute top-full left-0 mt-1 z-10 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                    {ENERGY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setEnergy(
                            energy === opt.value ? null : opt.value
                          );
                          setShowEnergyPicker(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                          energy === opt.value && "text-primary font-semibold"
                        )}
                      >
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Attachments placeholder */}
              <button
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Attachments (coming soon)"
              >
                <Paperclip size={13} />
                Attach
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border">
              {/* Area selector */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowAreaPicker(!showAreaPicker);
                    setShowEffortPicker(false);
                    setShowEnergyPicker(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors",
                    selectedArea
                      ? "text-primary/80"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <FolderOpen size={13} />
                  {selectedArea ? selectedArea.name : "No area"}
                </button>
                {showAreaPicker && (
                  <div className="absolute bottom-full left-0 mb-1 z-10 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
                    <button
                      onClick={() => {
                        setAreaId(null);
                        setShowAreaPicker(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                        !areaId && "font-semibold"
                      )}
                    >
                      No area
                    </button>
                    {areas?.map((area) => (
                      <button
                        key={area.id}
                        onClick={() => {
                          setAreaId(area.id);
                          setShowAreaPicker(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors",
                          areaId === area.id && "text-primary font-semibold"
                        )}
                      >
                        {area.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <DialogPrimitive.Close asChild>
                  <button className="px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
                    Cancel
                  </button>
                </DialogPrimitive.Close>
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || createTask.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {createTask.isPending && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Add task
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
