'use client';

import { useSkillNavigation } from '@/components/skills/skill-navigation';
import { SKILLS_KEY } from '@/hooks/use-skills';
import { getAuthToken } from '@/lib/api/client';
import { useHomeStorageScope } from '@/components/home/home-context';
import { documentCredential } from '@/lib/home/document-binding';
import { homeDocumentKey, assertDocumentCredential } from '@/lib/home/document-scope';
import { documentSaves } from '@/lib/client/document-saves';
import { SkillFileSaver, type SkillEditMode } from '@/lib/client/skill-file-saver';
import { skillsApi, type SkillView, type SaveSkillBody } from '@/lib/api/skills';
import { cn } from '@/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Check, FileText, Loader2, MessageCircleMore } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { SkillMarkdownEditor } from './skill-markdown-editor';

/** The same hash-checked file editor in personal and shared libraries. */
export function SkillEditor({ skill, aiWriting }: { skill: SkillView; aiWriting: boolean }) {
  const qc = useQueryClient();
  const { openSkill } = useSkillNavigation();
  const scope = useHomeStorageScope();
  const [credential] = useState(() => documentCredential(getAuthToken()));
  const mutation = useMutation({ mutationFn: ({ ref, body }: { ref: string; body: SaveSkillBody }) => {
    assertDocumentCredential(credential, documentCredential(getAuthToken()));
    return skillsApi.save(ref, body);
  }, meta: { carriesInput: true } });
  const [saver] = useState(() => new SkillFileSaver(skill,
    ref => 'ri:skill-draft:v1:' + homeDocumentKey('skill', ref, scope), () => window.localStorage,
    (ref, body) => mutation.mutateAsync({ ref, body }), ref => skillsApi.get(ref).then(result => result.skill),
    result => {
      qc.setQueryData([...SKILLS_KEY, 'one', result.skill.ref], result.skill);
      void qc.invalidateQueries({ queryKey: [...SKILLS_KEY, 'overview'] });
    },
  ));
  const { saved, draft, mode, conflict, saving, error, recovery } = useSyncExternalStore(saver.subscribe, saver.snapshot, saver.snapshot);
  const readOnly = !saved.editable;
  const dirty = !readOnly && saver.hasUnsaved();
  const fieldsBlocked = saved.frontmatterError !== null;
  const effectiveMode = fieldsBlocked ? 'file' : mode;
  const saveNow = useCallback(() => { void saver.flush().catch(() => {}); }, [saver]);
  useEffect(() => saver.observe(skill), [saver, skill]);
  useEffect(() => {
    const unregister = documentSaves.register(saver);
    return () => { unregister(); void saver.flush().catch(() => {}); saver.dispose(); };
  }, [saver]);
  // A rename changes navigation only after newer typing has also been acknowledged.
  useEffect(() => {
    if (!saving && !dirty && saved.ref !== skill.ref) openSkill(saved.ref, { replace: true });
  }, [saving, dirty, saved.ref, skill.ref, openSkill]);
  const switchMode = (next: SkillEditMode) => { void saver.switchMode(next).catch(() => {}); };
  const takeTheirs = () => saver.takeTheirs();
  const keepMine = () => saver.keepMine();
  const DESCRIPTION_MAX = 1024;

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
              onClick={() => switchMode(m)}
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
          {readOnly && saved.linkedFrom && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
              Another tool links this skill in from {saved.linkedFrom}, so it&apos;s edited there. To change it here,
              copy it into Ri from the menu above.
            </p>
          )}
          {recovery && <div role="alert" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <p>A retained draft is available for this skill. It has not been sent.</p>
            <div className="flex gap-3">{!readOnly && <button className="underline" onClick={() => saver.restore()}>Restore draft</button>}<button className="underline" onClick={() => saver.discardRecovery()}>Discard draft</button></div>
          </div>}
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
              <span>{error} <button className="underline" onClick={saveNow}>Try again</button></span>
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
                  onChange={(e) => saver.edit({ description: e.target.value })}
                  onBlur={saveNow}
                  readOnly={readOnly || !!recovery}
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
                    onChange={(body) => saver.edit({ body })}
                    onSave={saveNow}
                    ariaLabel="Instructions"
                    placeholder={'# Steps\n\n1. ...'}
                    minHeight="320px"
                    readOnly={readOnly || !!recovery}
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
                  onChange={(content) => saver.edit({ content })}
                  onSave={saveNow}
                  ariaLabel="SKILL.md"
                  minHeight="420px"
                  readOnly={readOnly || !!recovery}
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
