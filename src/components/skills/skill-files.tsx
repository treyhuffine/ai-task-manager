'use client';

import { languageFor } from '@/components/executions/viewer/language-for';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Tip } from '@/components/ui/tip';
import { skillKey, useSkillFile } from '@/hooks/use-skills';
import { apiErrorText } from '@/lib/api/client';
import { skillsApi, type SkillView } from '@/lib/api/skills';
import { SUPPORTING_FILE_MAX_BYTES, supportingPathFor } from '@/lib/skills/file-placement';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, File, FileCode, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { SkillMarkdownEditor } from './skill-markdown-editor';

const NOOP = () => {};

/**
 * A skill's supporting files: scripts, docs and templates beside SKILL.md.
 * Add them from the computer (the button, or dropped on the section), open
 * one to read it, or remove it. The builder AI writes them through
 * `save_skill`'s `files`, and the list is the live skill's, so its files
 * show up here as they land.
 */
export function SkillFiles({ skill, editable }: { skill: SkillView; editable: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const files = skill.files;

  const refresh = () => qc.invalidateQueries({ queryKey: skillKey(skill.ref) });

  const add = async (picked: File[]) => {
    if (!editable || adding || picked.length === 0) return;
    const tooLarge = picked.filter((file) => file.size > SUPPORTING_FILE_MAX_BYTES);
    for (const file of tooLarge) toast.error(`${file.name} is over 1 MB. Keep supporting files small, they cost context.`);
    const planned = picked.filter((file) => !tooLarge.includes(file)).map((file) => ({ file, path: supportingPathFor(file.name) }));
    if (planned.length === 0) return;
    const replacing = planned.filter(({ path }) => files.some((f) => f.path === path)).map(({ path }) => path);
    if (replacing.length > 0) {
      const ok = await confirm({
        title: replacing.length === 1 ? `Replace ${replacing[0]}?` : `Replace ${replacing.length} files?`,
        description: replacing.length === 1 ? 'The skill already has a file there.' : `The skill already has ${replacing.join(', ')}.`,
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    setAdding(true);
    const added: string[] = [];
    try {
      // One file per write keeps each request well under the transport's 2 MB message cap.
      for (const { file, path } of planned) {
        try {
          await skillsApi.save(skill.ref, { files: [{ path, content: await readBase64(file), encoding: 'base64' }] });
          added.push(path);
        } catch (error) {
          toast.error(`${file.name} wasn't added. ${apiErrorText(error)}`);
        }
      }
    } finally {
      setAdding(false);
      await refresh();
    }
    if (added.length > 0) {
      toast.success(
        added.length === 1 ? `Added ${added[0]}` : `Added ${added.length} files`,
        { description: 'Name it in the instructions so agents know when to use it.' },
      );
    }
  };

  const remove = async (path: string) => {
    const ok = await confirm({
      title: `Remove ${path}?`,
      description: "It's deleted from the skill's folder.",
      confirmLabel: 'Remove',
      tone: 'destructive',
    });
    if (!ok) return;
    try {
      await skillsApi.save(skill.ref, { files: [{ path, content: null }] });
      if (open === path) setOpen(null);
    } catch (error) {
      toast.error(apiErrorText(error));
    } finally {
      await refresh();
    }
  };

  const carriesFiles = (e: DragEvent) => editable && e.dataTransfer.types.includes('Files');

  if (!editable && files.length === 0) return null;

  return (
    <section
      aria-label="Files"
      className={cn('space-y-1.5 rounded-lg transition-shadow', dragging && 'ring-2 ring-ring/40 ring-offset-4 ring-offset-background')}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-foreground">Files</span>
        {editable && (
          <Tip label="Scripts go in scripts/, docs in references/, the rest in assets/. Up to 1 MB each.">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={adding}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            >
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {adding ? 'Adding…' : 'Add files'}
            </button>
          </Tip>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            void add(picked);
          }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Scripts, docs and templates that come with the skill. Agents open one only when the instructions say to.
      </p>

      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground/80">
          Drop files here, or ask the chat to write one.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {files.map((f) => {
            const isOpen = open === f.path;
            const Icon = f.path.startsWith('scripts/') ? FileCode : f.path.startsWith('references/') ? FileText : File;
            return (
              <li key={f.path}>
                <div className="group flex items-center gap-1 rounded-md hover:bg-muted/40">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : f.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight size={12} className={cn('shrink-0 transition-transform', isOpen && 'rotate-90')} />
                    <Icon size={12} className="shrink-0" />
                    <span className="truncate font-mono">{f.path}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/60">{formatBytes(f.size)}</span>
                  </button>
                  {editable && (
                    <Tip label="Remove from the skill">
                      <button
                        type="button"
                        aria-label={`Remove ${f.path}`}
                        onClick={() => void remove(f.path)}
                        className="mr-1 shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 size={12} />
                      </button>
                    </Tip>
                  )}
                </div>
                {isOpen && <FileContents skillRef={skill.ref} file={f} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FileContents({ skillRef, file }: { skillRef: string; file: { path: string; size: number } }) {
  const { data, isLoading, error } = useSkillFile(skillRef, file);
  const language = useMemo(() => languageFor(file.path), [file.path]);
  if (isLoading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) return <p className="px-6 py-2 text-[11px] text-destructive">{apiErrorText(error)}</p>;
  if (data.text === null) {
    return (
      <p className="px-6 py-2 text-[11px] text-muted-foreground">
        {data.size > SUPPORTING_FILE_MAX_BYTES ? "It's over 1 MB, too large to show here." : "It isn't a text file, so it can't be shown here."}
      </p>
    );
  }
  return (
    <div className="mb-2 ml-5 mt-1 max-h-96 overflow-auto rounded-lg border border-border bg-card/30">
      <SkillMarkdownEditor value={data.text} onChange={NOOP} onSave={NOOP} ariaLabel={file.path} minHeight="0" readOnly language={language} />
    </div>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
