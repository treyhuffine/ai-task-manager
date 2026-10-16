/** @jsxRuntime automatic */
import { useEffect, useRef, useState } from 'react';
import {
  AskRiButton, Button, ButtonRow, ChevronLeftIcon, ConflictNotice, ErrorState, InlineError, LoadingState, Notice, SourceLine, StatusLabel, TextArea,
  useAnnounce, useMutation, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import type { Location } from './app.js';
import type { Interview, OpportunityDetail, PostingDetail, Preparation, Write } from './types.js';
import { durationText, errorText, FORMAT_TEXT, localId, mediumDate, shortDate, whenText, classificationText } from './format.js';

type Go = (patch: Partial<Location> | ((current: Location) => Partial<Location>)) => void;
interface Draft { requirements: Preparation['requirements']; examples: Preparation['examples']; questions: Preparation['questions']; notes: string; postingSnapshotId: string | null; decisions: Record<string, 'accepted' | 'dismissed'> }
const draftOf = (prep: Preparation): Draft => ({ requirements: prep.requirements, examples: prep.examples, questions: prep.questions, notes: prep.notes, postingSnapshotId: prep.postingSnapshotId, decisions: {} });
const sameDraft = (a: Draft, b: Draft) => JSON.stringify({ ...a, decisions: {} }) === JSON.stringify({ ...b, decisions: {} }) && !Object.keys(a.decisions).length;

export function PreparationView({ target, onBack, backLabel, go }: { target: { opportunityId: string | null; interviewId: string | null }; onBack: () => void; backLabel: string; go: Go }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const prep = useQuery<Preparation>('get_preparation', { ...(target.opportunityId ? { opportunityId: target.opportunityId } : {}), ...(target.interviewId ? { interviewId: target.interviewId } : {}) });
  const opportunityId = prep.data?.opportunityId ?? target.opportunityId;
  const detailQuery = useQuery<OpportunityDetail>('get_opportunity', { id: opportunityId ?? '' }, { enabled: Boolean(opportunityId) });
  const detail = { ...detailQuery, data: detailQuery.data?.opportunity.id === opportunityId ? detailQuery.data : undefined };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<Preparation | null>(null);
  const [conflict, setConflict] = useState<Preparation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation<Record<string, unknown>, Write<Preparation>>('save_preparation');
  const suggest = useMutation<Record<string, unknown>, { preparation: Preparation; outcome: string; message: string }>('suggest_preparation');
  const dirty = draft && base ? !sameDraft(draft, draftOf(base)) : false;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // A background refresh never replaces typed text. It only updates the draft while nothing is unsaved.
  useEffect(() => {
    if (!prep.data) return;
    if (!draft || !dirtyRef.current) {
      setDraft(draftOf(prep.data));
      setBase(prep.data);
    } else if (base && prep.data.revision === base.revision) setBase(prep.data);
  }, [prep.data]);
  useEffect(() => {
    if (!prep.data) return;
    app.context({ section: 'preparation', selected: [...(prep.data.interviewId ? [{ type: 'interview', id: prep.data.interviewId }] : []), { type: 'opportunity', id: prep.data.opportunityId }], revisions: detail.data ? { [detail.data.opportunity.id]: detail.data.opportunity.revision } : undefined });
  }, [app, prep.data, detail.data]);

  if (prep.error && !prep.data) return <ErrorState title="This preparation could not open" message={prep.error} onRetry={prep.reload} />;
  if (!prep.data || !draft || !base) return <LoadingState label="Opening preparation" rows={4} />;
  const record = detail.data?.opportunity;
  const interview: Interview | undefined = detail.data?.interviews.find((item) => item.id === prep.data!.interviewId);
  const remote = prep.data.revision !== base.revision ? prep.data : null;

  const persist = async (revision: number, current?: Draft) => {
    const value = current ?? draft;
    setError(null);
    try {
      const result = await save.run({
        preparationId: base.id, opportunityId: base.opportunityId, interviewId: base.interviewId, expectedRevision: revision, postingSnapshotId: value.postingSnapshotId,
        requirements: value.requirements, examples: value.examples.filter((item) => item.text.trim()), questions: value.questions.filter((item) => item.text.trim()), notes: value.notes,
        ...(Object.keys(value.decisions).length ? { suggestionDecisions: Object.entries(value.decisions).map(([id, status]) => ({ id, status })) } : {}),
      });
      save.reset();
      if (result.status === 'conflict') { setConflict(result.current); return false; }
      setConflict(null);
      setBase(result.record);
      setDraft(draftOf(result.record));
      announce('Preparation saved');
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    }
  };
  const back = async () => {
    if (dirty && !(await persist(base.revision))) return;
    onBack();
  };
  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const useNewer = async () => {
    if (!base.newerSnapshotId) return;
    try {
      const posting = await app.call<PostingDetail>('get_posting', { id: base.newerSnapshotId });
      const own = draft.requirements.filter((item) => item.origin === 'user');
      update({ postingSnapshotId: posting.id, requirements: [...posting.extracted.requirements.map((item) => ({ ...item, origin: 'posting' as const, snapshotId: posting.id })), ...own] });
      announce('Requirements updated from the newer description. Save to keep them.');
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const suggestions = base.suggestions.filter((item) => ((draft.decisions[item.id] as string | undefined) ?? item.status) === 'proposed');
  const submitted = detail.data?.submissions.flatMap((submission) => submission.materials.map((material) => ({ ...material, appliedOn: submission.appliedOn }))) ?? [];
  const preparePrompt = record
    ? `Prepare me for ${interview ? `my ${interview.title}${interview.startAt ? ` on ${whenText(interview.startAt, interview.zone, { viewer: false })}` : ''}` : 'my interview'} with ${record.company} for the ${record.role} role. Use the saved posting snapshot${submitted.length ? `, the exact materials I submitted (${submitted.filter((item) => item.shared).map((item) => `${item.title} v${item.number}`).join(', ')})` : ''}, my preparation notes and our permitted correspondence. Keep my own experience separate from suggestions and do not invent experience.`
    : 'Prepare me for this interview using my saved records. Do not invent experience.';

  return (
    <article className="ri-stack ri-stack--loose" aria-labelledby="js-prep-title">
      <div><Button variant="quiet" className="ri-split__back" onClick={() => void back()}><ChevronLeftIcon />{backLabel}</Button></div>
      <div className="js-workspace-head">
        <div className="js-workspace-head__text">
          <span className="ri-eyebrow">{record ? `${record.company} · ${record.role}` : 'Preparation'}</span>
          <h2 id="js-prep-title" className="js-workspace-title">{interview ? `Prepare for ${interview.title}` : 'Interview preparation'}</h2>
          {interview && <p className="ri-muted">{interview.status === 'scheduling_needed' ? 'Scheduling needed. No time confirmed yet' : whenText(interview.startAt, interview.zone)}</p>}
        </div>
        <ButtonRow>
          <AskRiButton variant="primary" prompt={preparePrompt}>Prepare with Ri</AskRiButton>
        </ButtonRow>
      </div>

      {interview && (
        <div className="js-strip">
          <div className="js-strip__text">
            <span className="ri-eyebrow">{FORMAT_TEXT[interview.format]}{durationText(interview.startAt, interview.endAt) ? ` · ${durationText(interview.startAt, interview.endAt)}` : ''}{interview.zone ? ` · ${interview.zone.replace(/_/g, ' ')}` : ''}</span>
            <p className="js-strip__title">{interview.status === 'scheduling_needed' ? 'Waiting for a confirmed time' : whenText(interview.startAt, interview.zone)}</p>
            <p className="js-strip__meta">{interview.participants.filter((person) => person.role !== 'self').map((person) => `${person.name ?? person.email}${person.role === 'organizer' ? ', organizer' : ''}`).join(' · ') || 'Participants not recorded'}</p>
          </div>
          {interview.meetingLink && <Button onClick={() => void app.openExternal(interview.meetingLink!)}>Open meeting link</Button>}
        </div>
      )}

      {conflict && (
        <ConflictNotice
          title="This preparation was saved somewhere else while you edited"
          fields={[
            { label: 'Examples', mine: `${draft.examples.length} examples`, current: `${conflict.examples.length} examples` },
            { label: 'Questions', mine: `${draft.questions.length} questions`, current: `${conflict.questions.length} questions` },
            { label: 'Notes', mine: draft.notes.slice(0, 160) || 'Empty', current: conflict.notes.slice(0, 160) || 'Empty' },
          ]}
          busy={save.pending}
          onKeepMine={() => persist(conflict.revision)}
          onUseCurrent={() => { setBase(conflict); setDraft(draftOf(conflict)); setConflict(null); }}
        />
      )}
      {!conflict && remote && dirty && <Notice tone="info" title="A newer saved version exists">Your unsaved text is kept here. Saving compares it with the newer version first.</Notice>}

      <div className="js-grid-2">
        <div className="ri-stack ri-stack--loose" style={{ minWidth: 0 }}>
          <section className="js-panel" aria-labelledby="js-prep-req">
            <div className="ri-section-heading">
              <h3 id="js-prep-req" className="js-panel__title">What the role asks for</h3>
              <p>{draft.postingSnapshotId ? `Quoted from the description saved ${shortDate(detail.data?.postings.find((item) => item.id === draft.postingSnapshotId)?.capturedAt)}` : 'No description saved'}</p>
            </div>
            {base.newerSnapshotId && draft.postingSnapshotId !== base.newerSnapshotId && (
              <Notice tone="info" title="A newer description was saved" action={<Button size="sm" onClick={() => void useNewer()}>Use the newer description</Button>}>Your preparation keeps the description it was based on until you choose.</Notice>
            )}
            {draft.requirements.length === 0 ? (
              <p className="ri-small ri-muted">{draft.postingSnapshotId ? 'No requirement list was found in the description.' : 'Add the description to prepare with this role.'} You can add requirements in your own words.</p>
            ) : (
              <ul className="js-list">
                {draft.requirements.map((requirement) => (
                  <li key={requirement.id} className="js-req">
                    <div className="js-item">
                      <span>{requirement.text}</span>
                      <Button variant="link" size="sm" aria-label={`Remove requirement: ${requirement.text}`} onClick={() => update({ requirements: draft.requirements.filter((item) => item.id !== requirement.id) })}>Remove</Button>
                    </div>
                    <span className="ri-small ri-muted">{requirement.origin === 'posting' ? `From the posting${requirement.section ? `, ${requirement.section}` : ''}` : 'Added by you'}</span>
                  </li>
                ))}
              </ul>
            )}
            <AddLine label="Add a requirement" onAdd={(text) => update({ requirements: [...draft.requirements, { id: localId('req'), text, passage: text, section: null, origin: 'user', snapshotId: null }] })} />
          </section>

          <section className="js-panel" aria-labelledby="js-prep-examples">
            <div className="ri-section-heading">
              <h3 id="js-prep-examples" className="js-panel__title">Your examples to discuss</h3>
              <p>Your own words and facts</p>
            </div>
            <EditableList items={draft.examples} label="Example" onChange={(examples) => update({ examples })} addLabel="Add an example" placeholder="A project, decision or result you can describe, in your own words" />
          </section>

          <section className="js-panel" aria-labelledby="js-prep-questions">
            <h3 id="js-prep-questions" className="js-panel__title">Questions to ask</h3>
            <EditableList items={draft.questions} label="Question" onChange={(questions) => update({ questions })} addLabel="Add a question" placeholder="Something you want to learn from them" />
          </section>

          <TextArea label="Notes" value={draft.notes} onChange={(notes) => update({ notes })} rows={4} />

          <div className="ri-stack ri-stack--tight">
            <ButtonRow>
              <Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void persist(base.revision)}>Save preparation</Button>
              <span className="ri-small ri-muted" role="status">{dirty ? 'Unsaved changes' : base.updatedAt ? `Saved ${mediumDate(base.updatedAt)}${base.revisions.length ? `, revision ${base.revision}` : ''}` : 'Not saved yet'}</span>
            </ButtonRow>
            <InlineError>{error}</InlineError>
          </div>

          <section className="ri-stack" aria-labelledby="js-prep-ai">
            <div className="ri-section-heading">
              <h3 id="js-prep-ai" className="ri-h3">AI suggestions</h3>
              <p>Kept apart from your own notes. Each one cites saved evidence.</p>
            </div>
            {base.id ? (
              <ButtonRow>
                <Button busy={suggest.pending} busyLabel="Reading your evidence" onClick={async () => {
                  try {
                    const result = await suggest.run({ preparationId: base.id });
                    suggest.reset();
                    if (!dirtyRef.current) { setBase(result.preparation); setDraft(draftOf(result.preparation)); }
                    else setBase((current) => (current ? { ...current, suggestions: result.preparation.suggestions, suggestionsState: result.preparation.suggestionsState } : current));
                    announce(result.message);
                  } catch (failure) {
                    setError(errorText(failure));
                  }
                }}>Suggest from my saved evidence</Button>
              </ButtonRow>
            ) : <p className="ri-small ri-muted">Save the preparation first. Suggestions then use the posting, your submitted materials and your examples.</p>}
            {base.suggestionsState.status === 'unavailable' && (
              <Notice tone="info" title="Extraction unavailable" action={<Button size="sm" onClick={() => void app.openSources()}>Open Sources</Button>}>
                Your preparation works fully by hand, and Prepare with Ri uses your chat instead. Ri's bounded AI may need to be allowed for this app.
              </Notice>
            )}
            {(base.suggestionsState.status === 'invalid' || base.suggestionsState.status === 'ready') && base.suggestionsState.message && <p className="ri-small ri-muted">{base.suggestionsState.message}</p>}
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="js-suggestion">
                <span className="js-version__head"><span className="js-tag">AI suggestion</span><span className="js-tag">{suggestion.kind === 'talking_point' ? 'Way to present your experience' : suggestion.kind === 'question' ? 'Question' : 'Missing evidence'}</span></span>
                <p>{suggestion.text}</p>
                {suggestion.evidence.map((evidence, index) => (
                  <div key={index} className="ri-stack ri-stack--tight">
                    <blockquote className="js-quote">{evidence.quote}</blockquote>
                    <span className="ri-small ri-muted">Source: {evidence.label}</span>
                  </div>
                ))}
                <ButtonRow>
                  {suggestion.kind === 'question' && <Button size="sm" onClick={() => update({ questions: [...draft.questions, { id: localId('q'), text: suggestion.text, requirementIds: [] }], decisions: { ...draft.decisions, [suggestion.id]: 'accepted' } })}>Add to my questions</Button>}
                  {suggestion.kind !== 'question' && <Button size="sm" onClick={() => update({ notes: `${draft.notes ? `${draft.notes}\n\n` : ''}${suggestion.text}`, decisions: { ...draft.decisions, [suggestion.id]: 'accepted' } })}>Copy into my notes</Button>}
                  <Button size="sm" variant="quiet" onClick={() => update({ decisions: { ...draft.decisions, [suggestion.id]: 'dismissed' } })}>Dismiss</Button>
                </ButtonRow>
              </div>
            ))}
          </section>
        </div>

        <aside className="js-panel" aria-labelledby="js-prep-sources">
          <h3 id="js-prep-sources" className="js-panel__title">Sources for this preparation</h3>
          <div className="ri-stack ri-stack--tight">
            <span className="ri-eyebrow">Submitted materials</span>
            {submitted.length === 0 ? <p className="ri-small ri-muted">No application recorded.</p> : submitted.map((material) => (
              <div key={`${material.versionId}-${material.appliedOn}`}>
                <p className="ri-small"><strong>{material.shared ? `${material.title} v${material.number}` : material.title}</strong></p>
                <p className="ri-small ri-muted">Submitted {shortDate(material.appliedOn)} · Kept as submitted</p>
                {material.shared && material.familyId && <Button variant="link" size="sm" onClick={() => go({ tab: 'materials', materialId: material.familyId, prepare: null, opportunityId: null })}>Open submitted version</Button>}
              </div>
            ))}
          </div>
          <div className="ri-stack ri-stack--tight">
            <span className="ri-eyebrow">Correspondence</span>
            {!detail.data?.correspondence.length ? <p className="ri-small ri-muted">None linked.</p> : detail.data.correspondence.slice(0, 4).map((message) => (
              <p key={message.id} className="ri-small"><span className="ri-muted">{shortDate(message.receivedAt)} · </span>{classificationText(message.classification)}{message.unavailable ? <span className="ri-muted"> · Source unavailable</span> : null}</p>
            ))}
          </div>
          {draft.postingSnapshotId && detail.data && <SourceLine label="posting snapshot used here" observedAt={detail.data.postings.find((item) => item.id === draft.postingSnapshotId)?.capturedAt ?? null} onOpen={() => go({ prepare: null, opportunityId: detail.data!.opportunity.id, section: 'posting' })} openLabel="Open posting" />}
          {base.revisions.length > 0 && <p className="ri-small ri-muted">Saved {base.revisions.length === 1 ? 'once' : `${base.revisions.length} times`}. Every save keeps a revision.</p>}
          {interview?.sourceState === 'removed' && <StatusLabel tone="warning">The calendar event was removed. Your preparation is kept.</StatusLabel>}
        </aside>
      </div>
    </article>
  );
}

function AddLine({ label, onAdd }: { label: string; onAdd: (text: string) => void }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <ButtonRow><Button size="sm" onClick={() => setOpen(true)}>{label}</Button></ButtonRow>;
  return (
    <div className="ri-stack ri-stack--tight">
      <TextArea label={label} value={value} onChange={setValue} rows={2} />
      <ButtonRow>
        <Button size="sm" variant="primary" onClick={() => { if (value.trim()) onAdd(value.trim()); setValue(''); setOpen(false); }}>Add</Button>
        <Button size="sm" variant="quiet" onClick={() => { setValue(''); setOpen(false); }}>Cancel</Button>
      </ButtonRow>
    </div>
  );
}

function EditableList({ items, label, onChange, addLabel, placeholder }: { items: Preparation['examples']; label: string; onChange: (items: Preparation['examples']) => void; addLabel: string; placeholder: string }) {
  return (
    <div className="js-items">
      {items.length === 0 && <p className="ri-small ri-muted">None yet.</p>}
      {items.map((item, index) => (
        <div key={item.id} className="js-item">
          <TextArea label={`${label} ${index + 1}`} hideLabel value={item.text} onChange={(text) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, text } : entry)))} rows={2} placeholder={placeholder} />
          <Button variant="link" size="sm" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>Remove</Button>
        </div>
      ))}
      <ButtonRow><Button size="sm" onClick={() => onChange([...items, { id: localId(label.toLowerCase()), text: '', requirementIds: [] }])}>{addLabel}</Button></ButtonRow>
    </div>
  );
}
