'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { SKILLS_KEY } from '@/hooks/use-skills';
import { apiErrorBody, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { skillsApi, type SkillView } from '@/lib/api/skills';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Check, FileText, Loader2, MessageCircleMore } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SkillMarkdownEditor } from './skill-markdown-editor';

/** Mirrors DESCRIPTION_MAX in src/lib/skills/format.ts (not imported: it's a server module). */
const DESCRIPTION_MAX = 1024;
/** How long typing pauses before an autosave. */
const AUTOSAVE_MS = 800;

type Mode = 'fields' | 'file';

interface Draft {
  description: string;
  body: string;
  content: string;
}

function draftOf(skill: SkillView): Draft {
  return { description: skill.description ?? '', body: skill.body, content: skill.content };
}

function isDirty(mode: Mode, draft: Draft, saved: SkillView): boolean {
  return mode === 'file'
    ? draft.content !== saved.content
    : draft.description !== (saved.description ?? '') || draft.body !== saved.body;
}

/**
 * The skill's file, editable two ways: as fields (description and
 * instructions, which is how most people think about a skill) or as the
 * whole SKILL.md (for frontmatter keys like allowed-tools).
 *
 * It autosaves. The builder AI writes the same file through its own
 * actions, so every save carries the hash it was based on:
 *
 *   - While you have nothing unsaved, the AI's changes flow straight in.
 *   - If the file changed under unsaved typing, nothing is overwritten. A
 *     banner lets you take their version or keep yours.
 */
export function SkillEditor({ skill, aiWriting }: { skill: SkillView; aiWriting: boolean }) {
  const qc = useQueryClient();
  const { openSkill } = useDashboard();
  const [mode, setMode] = useState<Mode>(skill.frontmatterError ? 'file' : 'fields');
  const [draft, setDraft] = useState<Draft>(() => draftOf(skill));
  const [saved, setSaved] = useState<SkillView>(skill);
  const [conflict, setConflict] = useState<SkillView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for the save path, which runs from timers and editor callbacks.
  const state = useRef({ mode, draft, saved, saving: false, queued: false });
  useLayoutEffect(() => {
    state.current.mode = mode;
    state.current.draft = draft;
    state.current.saved = saved;
  });

  const readOnly = !saved.editable;
  const dirty = !readOnly && isDirty(mode, draft, saved);
  const fieldsBlocked = saved.frontmatterError !== null;
  const effectiveMode: Mode = fieldsBlocked ? 'file' : mode;

  // A newer copy from the server (the AI saved, or another tab): adopt it
  // when nothing local is unsaved, otherwise hold it as a conflict.
  useEffect(() => {
    if (skill.ref !== state.current.saved.ref) {
      setSaved(skill);
      setDraft(draftOf(skill));
      setConflict(null);
      return;
    }
    if (skill.hash === state.current.saved.hash) return;
    if (state.current.saving) return;
    if (isDirty(state.current.mode, state.current.draft, state.current.saved)) {
      setConflict(skill);
      return;
    }
    setSaved(skill);
    setDraft(draftOf(skill));
    setConflict(null);
  }, [skill]);

  /** Save what's typed. Returns the skill as saved, or null when nothing was. */
  const save = useCallback(
    async (opts: { baseHash?: string } = {}): Promise<SkillView | null> => {
      const current = state.current;
      if (current.saving) {
        current.queued = true;
        return null;
      }
      if (!isDirty(current.mode, current.draft, current.saved) && !opts.baseHash) return null;
      current.saving = true;
      setSaving(true);
      setError(null);
      const sent = current.draft;
      const body =
        current.mode === 'file' || current.saved.frontmatterError
          ? { content: sent.content }
          : { description: sent.description, body: sent.body };
      try {
        const result = await skillsApi.save(current.saved.ref, { ...body, baseHash: opts.baseHash ?? current.saved.hash });
        setSaved(result.skill);
        setConflict(null);
        // Keep anything typed while the save was in flight. Only the parts
        // that match what was sent follow the server.
        setDraft((now) => ({
          description: now.description === sent.description ? (result.skill.description ?? '') : now.description,
          body: now.body === sent.body ? result.skill.body : now.body,
          content: now.content === sent.content ? result.skill.content : now.content,
        }));
        qc.setQueryData([...SKILLS_KEY, 'one', result.skill.ref], result.skill);
        void qc.invalidateQueries({ queryKey: [...SKILLS_KEY, 'overview'] });
        current.saved = result.skill;
        if (result.renamedFrom) openSkill(result.skill.ref, { replace: true });
        return result.skill;
      } catch (err) {
        if (apiErrorStatus(err) !== undefined && apiErrorStatus(err) === 409 && (apiErrorBody(err) as { code?: string } | null)?.code === 'stale') {
          const fresh = await skillsApi.get(current.saved.ref).then((r) => r.skill).catch(() => null);
          if (fresh) setConflict(fresh);
        } else {
          setError(apiErrorText(err));
        }
        return null;
      } finally {
        current.saving = false;
        setSaving(false);
        if (current.queued) {
          current.queued = false;
          void save();
        }
      }
    },
    [qc, openSkill],
  );

  const saveNow = useCallback(() => void save(), [save]);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (!dirty || conflict) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict, save]);

  const switchMode = async (next: Mode) => {
    if (next === mode) return;
    const latest = dirty ? await save() : null;
    if (dirty && !latest) return; // The save failed or hit a conflict. Stay put so nothing is lost.
    setDraft(draftOf(latest ?? state.current.saved));
    setMode(next);
  };

  const takeTheirs = () => {
    if (!conflict) return;
    setSaved(conflict);
    setDraft(draftOf(conflict));
    setConflict(null);
  };
  const keepMine = () => {
    if (!conflict) return;
    const base = conflict.hash;
    setSaved(conflict);
    setConflict(null);
    void save({ baseHash: base });
  };

  const errors = saved.problems.filter((p) => p.level === 'error');
  const warnings = saved.problems.filter((p) => p.level === 'warning');
  const descriptionLength = draft.description.trim().length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1">
        <div role="tablist" aria-label="Edit as" className="flex items-center gap-0.5">
          {(['fields', 'file'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={effectiveMode === m}
              disabled={m === 'fields' && fieldsBlocked}
              onClick={() => void switchMode(m)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors disabled:opacity-40',
                effectiveMode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'fields' ? 'Fields' : 'SKILL.md'}
            </button>
          ))}
        </div>
        {readOnly ? (
          <span className="text-[10.5px] text-muted-foreground/70">Read only</span>
        ) : (
          <SaveStatus saving={saving} dirty={dirty} aiWriting={aiWriting} />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-4">
          {readOnly && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
              Another tool links this skill in from {saved.linkedFrom}, so it&apos;s edited there. To change it here,
              copy it into Ri from the menu above.
            </p>
          )}
          {conflict && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="flex-1">The skill changed while you were typing. Nothing was overwritten.</span>
              <button onClick={takeTheirs} className="rounded-md px-2 py-1 font-medium hover:bg-amber-500/15">
                Use the new version
              </button>
              <button onClick={keepMine} className="rounded-md px-2 py-1 font-medium hover:bg-amber-500/15">
                Keep mine
              </button>
            </div>
          )}
          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
              <AlertCircle size={14} className="mt-px shrink-0" />
              {error}
            </p>
          )}
          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="space-y-1">
              {[...errors, ...warnings].map((p) => (
                <li
                  key={`${p.field}:${p.message}`}
                  className={cn(
                    'flex items-start gap-2 text-[11.5px]',
                    p.level === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400',
                  )}
                >
                  {p.level === 'error' ? <AlertCircle size={13} className="mt-px shrink-0" /> : <AlertTriangle size={13} className="mt-px shrink-0" />}
                  {p.message}
                </li>
              ))}
            </ul>
          )}

          {effectiveMode === 'fields' ? (
            <>
              <section className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="skill-description" className="text-[12px] font-semibold text-foreground">
                    When to use it
                  </label>
                  <span
                    className={cn(
                      'text-[10.5px] tabular-nums',
                      descriptionLength > DESCRIPTION_MAX ? 'text-destructive' : 'text-muted-foreground/70',
                    )}
                  >
                    {descriptionLength.toLocaleString('en-US')} / {DESCRIPTION_MAX.toLocaleString('en-US')}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Agents see only this until they decide to use the skill. Say what it does and when, in the words
                  you&apos;d use to ask for it.
                </p>
                <textarea
                  id="skill-description"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  onBlur={() => void save()}
                  readOnly={readOnly}
                  rows={3}
                  placeholder="Reviews pull requests the way I do. Use when I ask for a review, a second look at a diff, or whether a PR is ready to merge."
                  className="field-sizing-content min-h-[4.5rem] w-full resize-none rounded-lg border border-border bg-card/30 px-3 py-2 text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-[3px] focus:ring-ring/30"
                />
              </section>

              <section className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-foreground">Instructions</span>
                <p className="text-[11px] text-muted-foreground">
                  What the agent follows once it picks the skill: the steps, the judgment calls and why, an example of
                  good output.
                </p>
                <div className="overflow-hidden rounded-lg border border-border bg-card/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
                  <SkillMarkdownEditor
                    value={draft.body}
                    onChange={(body) => setDraft((d) => ({ ...d, body }))}
                    onSave={saveNow}
                    ariaLabel="Instructions"
                    placeholder={'# Steps\n\n1. ...'}
                    minHeight="320px"
                    readOnly={readOnly}
                  />
                </div>
              </section>

              {saved.otherKeys.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Also in the file: {saved.otherKeys.join(', ')}. Edit them in the SKILL.md view.
                </p>
              )}
            </>
          ) : (
            <section className="flex flex-col gap-1.5">
              <p className="text-[11px] text-muted-foreground">
                The whole file, frontmatter and all. Changing <code className="font-mono">name:</code> renames the
                skill.
              </p>
              <div className="overflow-hidden rounded-lg border border-border bg-card/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
                <SkillMarkdownEditor
                  value={draft.content}
                  onChange={(content) => setDraft((d) => ({ ...d, content }))}
                  onSave={saveNow}
                  ariaLabel="SKILL.md"
                  minHeight="420px"
                  readOnly={readOnly}
                />
              </div>
            </section>
          )}

          {saved.files.length > 0 && (
            <section className="space-y-1.5">
              <span className="text-[12px] font-semibold text-foreground">Files</span>
              <ul className="space-y-0.5">
                {saved.files.map((f) => (
                  <li key={f.path} className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <FileText size={12} className="shrink-0" />
                    <span className="truncate font-mono">{f.path}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground/60">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ saving, dirty, aiWriting }: { saving: boolean; dirty: boolean; aiWriting: boolean }) {
  if (saving) {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin" /> Saving
      </span>
    );
  }
  if (dirty) return <span className="text-[10.5px] text-muted-foreground">Unsaved</span>;
  if (aiWriting) {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <MessageCircleMore size={11} className="animate-pulse" /> AI is working
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground/70">
      <Check size={11} /> Saved
    </span>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
