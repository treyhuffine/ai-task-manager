import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AskRiButton, Avatar, Button, ButtonRow, Checkbox, ConflictNotice, DateInput, Dialog, EmptyState, InlineError, KeyValueList, Menu, Notice, SectionPanel,
  Select, StatusLabel, TextArea, TextInput, Timeline, useAnnounce, useQuery, useRiApp, type TimelineItem as KitTimelineItem,
} from '@ri/app-kit/ui';
import type { Affiliation, Briefing, Commitment, Fact, Identity, Note, PersonDetail, TimelineItem } from '../schemas.js';
import { dayLabel, meetingLabel, updatedLabel } from './format.js';
import { CoverageFooter, DueLabel, Failure, Loading, NameLink, RecordTabs, TaskStatus, useSave, usePeople } from './shared.js';

type Saved<T> = { status: 'saved'; record: T } | { status: 'conflict'; current: T; message: string };

export function PersonWorkspace({ id, headingLevel = 2 }: { id: string; headingLevel?: 1 | 2 }) {
  const ui = usePeople();
  const detail = useQuery<PersonDetail & { merges: { id: string; revision: number; survivorId: string; mergedId: string; createdAt: string }[] }>('get_person', { id }, { keepPrevious: false });
  const briefing = useQuery<Briefing>('get_briefing', { subjectKind: 'person', subjectId: id }, { keepPrevious: false });
  const [tab, setTab] = useState(ui.route.query.tab ?? 'timeline');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [noteFocus, setNoteFocus] = useState(0);
  const save = useSave<Saved<unknown>>('save_person');
  const announce = useAnnounce();
  const { ask } = useRiApp();
  useEffect(() => { setTab(ui.route.query.tab ?? 'timeline'); }, [id]);
  if (detail.error && !detail.data) return <Failure error={detail.error} reload={detail.reload} />;
  if (!detail.data) return <Loading label="Loading person" />;
  const person = detail.data.person, header = detail.data.header;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const canWrite = ui.data.canWrite;
  const first = person.name.split(/\s+/)[0] ?? person.name;
  const prompt = header.nextMeeting
    ? `Prepare me for my meeting with ${person.name} (${meetingLabel(header.nextMeeting.at)}). Use the People app's permitted records: recent exchanges, my notes, that meeting and open commitments on both sides. Cite sources and say what is unknown.`
    : `Using the People app, summarize what I know about ${person.name}: recent exchanges, my notes and open commitments. Cite sources and say what is unknown.`;
  const togglePin = async () => {
    const result = await save.run({ id: person.id, expectedRevision: person.revision, pinned: !person.pinned });
    announce(result.status === 'saved' ? (person.pinned ? 'Unpinned' : 'Pinned') : 'This person changed. Reloaded the latest version');
    void detail.reload();
  };
  const selectTab = (next: string) => { setTab(next); ui.setQuery({ tab: next === 'timeline' ? null : next }); };
  const more = [
    ...(canWrite ? [{ id: 'edit', label: 'Edit details' }] : []),
    ...(canWrite ? [{ id: 'pin', label: person.pinned ? 'Unpin' : 'Pin' }] : []),
    { id: 'reconnect', label: 'Help me reconnect' },
    ...(ui.data.owner ? [{ id: 'remove', label: 'Archive or remove' }] : []),
  ];
  return (
    <article className="pe-record" aria-label={person.name}>
      <header className="pe-record-head">
        <div className="pe-record-head__who">
          <Avatar name={person.name} size="lg" />
          <div className="pe-stack" style={{ gap: '0.25rem' }}>
            <Heading className="pe-record-title">{person.name}</Heading>
            <p className="pe-record-sub">
              {header.role ?? (header.company ? null : 'Role not recorded')}
              {header.role && header.company && ' · '}
              {header.company && <NameLink kind="company" id={header.company.id} name={header.company.name} />}
            </p>
            <p className="pe-small pe-muted">{header.affiliationNote}{person.pinned ? ' · Pinned' : ''}{person.archived ? ' · Archived' : ''}</p>
          </div>
        </div>
        <ButtonRow>
          {canWrite && <Button size="sm" onClick={() => { selectTab('notes'); setNoteFocus((count) => count + 1); }}>Add note</Button>}
          {canWrite && <Button size="sm" onClick={() => ui.followUp({ subject: { kind: 'person', id: person.id }, title: header.nextAction?.label ?? `Follow up with ${first}`, label: person.name })}>Follow up</Button>}
          <AskRiButton size="sm" prompt={prompt} />
          <Menu label="More" size="sm" variant="quiet" items={more} onSelect={(choice) => {
            if (choice === 'edit') setEditing(true);
            if (choice === 'pin') void togglePin();
            if (choice === 'remove') setRemoving(true);
            if (choice === 'reconnect') void ask(`Help me reconnect with ${person.name}. Draft a short, editable note using the People app's permitted context. Do not send anything.`);
          }} />
        </ButtonRow>
      </header>
      <div className="pe-record-meta">
        <span>{header.lastExchangeAt ? `Last direct exchange ${dayLabel(header.lastExchangeAt)}` : 'No direct exchange in the indexed history'}</span>
        <span>{header.nextMeeting ? `${header.nextMeeting.title} · ${meetingLabel(header.nextMeeting.at)}` : 'No meeting scheduled'}</span>
        {person.keepInTouchDays && <span>Keep in touch every {person.keepInTouchDays} days</span>}
      </div>
      {detail.data.reviews.length > 0 && ui.data.owner && (
        <Notice tone="info" title="Identity review" action={<Button size="sm" onClick={() => ui.go({ section: 'sources', record: null, query: { panel: 'review' } })}>Review</Button>}>
          {detail.data.reviews[0]!.summary}
        </Notice>
      )}
      <BriefingCard briefing={briefing.data} error={briefing.error} detail={detail.data} reload={() => { void briefing.reload(); void detail.reload(); }} />
      <RecordTabs label={`${person.name} sections`} panelId={`pe-person-${id}`} value={tab} onChange={selectTab}
        items={[{ id: 'timeline', label: 'Timeline' }, { id: 'notes', label: 'Notes', badge: detail.data.notes.length || undefined }, { id: 'details', label: 'Details' }]} />
      <SectionPanel panelId={`pe-person-${id}`} value={tab}>
        {tab === 'timeline' && <PersonTimeline id={id} />}
        {tab === 'notes' && <NotesPanel subjectKind="person" subjectId={id} notes={detail.data.notes} reload={detail.reload} focusNew={noteFocus} />}
        {tab === 'details' && <PersonDetails detail={detail.data} reload={detail.reload} />}
      </SectionPanel>
      <ButtonRow>
        <AskRiButton variant="primary" prompt={prompt}>Prepare with Ri</AskRiButton>
        {canWrite && tab !== 'notes' && <Button onClick={() => selectTab('notes')}>Add note</Button>}
      </ButtonRow>
      <CoverageFooter coverage={detail.data.coverage} />
      {editing && <EditPersonDialog detail={detail.data} onClose={() => { setEditing(false); void detail.reload(); }} />}
      {removing && <RemoveDialog kind="person" id={person.id} name={person.name} revision={person.revision} onClose={() => setRemoving(false)} />}
    </article>
  );
}

function BriefingCard({ briefing, error, detail, reload }: { briefing: Briefing | undefined; error: string | null; detail: PersonDetail; reload(): void }) {
  const ui = usePeople();
  const request = useSave<{ status: string; jobId: string | null; availability: string }>('request_briefing');
  const announce = useAnnounce();
  const commitments = detail.commitments;
  return (
    <section className="pe-briefing" aria-label={briefing?.title ?? 'Recent context'}>
      <div className="pe-row pe-between">
        <h3 className="ri-h3">{briefing?.title ?? 'Recent context'}</h3>
        {briefing && briefing.coverage.extraction === 'on' && briefing.origin !== 'generated' && (
          <Button size="sm" variant="quiet" busy={request.pending} onClick={async () => {
            const result = await request.run({ subjectKind: 'person', subjectId: detail.person.id });
            announce(result.availability === 'queued' ? 'Briefing queued. It appears after the next update' : result.availability === 'ready' ? 'Briefing is up to date' : 'Extraction unavailable');
            reload();
          }}>Prepare briefing</Button>
        )}
      </div>
      {error && !briefing ? <InlineError>{error}</InlineError> : !briefing ? <Loading label="Loading briefing" /> : (
        <>
          {briefing.items.filter((item) => item.kind !== 'i_owe' && item.kind !== 'waiting_on').length ? (
            <ul className="pe-briefing__items">
              {briefing.items.filter((item) => item.kind !== 'i_owe' && item.kind !== 'waiting_on').map((item, index) => (
                <li key={index} className="pe-briefing__item">
                  <p>{item.text}</p>
                  {item.evidenceIds[0] && <span><button type="button" className="pe-link pe-small" onClick={() => ui.showEvidence(item.evidenceIds[0]!)}>View evidence</button></span>}
                </li>
              ))}
            </ul>
          ) : <p className="pe-muted">No recent conversation, note or meeting in the permitted records.</p>}
          {briefing.unknowns.length > 0 && <p className="pe-small pe-muted">{briefing.unknowns.join(' ')}</p>}
          <p className="pe-small pe-muted">{briefing.origin === 'generated' && briefing.generatedAt ? `Generated ${updatedLabel(briefing.generatedAt).replace('Updated ', '')} from cited records. ` : ''}{briefing.statusLabel}</p>
        </>
      )}
      {commitments.length > 0 && <div className="pe-briefing__divider" />}
      {commitments.length > 0 && (
        <div className="pe-stack">
          <p className="pe-section-label">Relationship context</p>
          {commitments.slice(0, 4).map((commitment) => <CommitmentRow key={commitment.id} commitment={commitment} reload={reload} />)}
        </div>
      )}
    </section>
  );
}

export function CommitmentRow({ commitment, reload, showSubject }: { commitment: Commitment; reload(): void; showSubject?: boolean }) {
  const ui = usePeople();
  const review = useSave<Saved<Commitment>>('review_commitment');
  const announce = useAnnounce();
  const [editing, setEditing] = useState(false);
  const decide = async (decision: string, extra: Record<string, unknown> = {}) => {
    const result = await review.run({ id: commitment.id, expectedRevision: commitment.revision, decision, ...extra });
    announce(result.status === 'saved' ? { accept: 'Accepted', dismiss: 'Dismissed', complete: 'Marked complete', reopen: 'Reopened', snooze: 'Snoozed', keep_open: 'Kept open', unsnooze: 'Snooze cleared' }[decision] ?? 'Saved' : 'This changed. Showing the latest version');
    review.reset();
    reload();
  };
  const who = commitment.direction === 'i_owe' ? 'You offered to' : `${commitment.actorLabel} offered to`;
  const text = `${who} ${commitment.action.replace(/^./, (c) => c.toLowerCase())}`;
  const subject = commitment.person ?? commitment.organization;
  const tomorrow = new Date(Date.now() + 864e5 * 7).toISOString().slice(0, 10);
  return (
    <div className="pe-commitment">
      <div className="pe-row">
        <span className="pe-section-label">{commitment.state === 'suggested' ? 'Suggestion from email' : commitment.direction === 'i_owe' ? 'You owe' : 'Waiting on'}</span>
        {commitment.state === 'accepted' && <StatusLabel tone="neutral">Accepted</StatusLabel>}
        {commitment.snoozedUntil && <span className="pe-pill">Snoozed until {dayLabel(commitment.snoozedUntil)}</span>}
      </div>
      <p className="pe-commitment__action">{text}.{showSubject && subject && <> <span className="pe-muted">({subject.name})</span></>}</p>
      <p className="pe-small pe-muted">
        <DueLabel date={commitment.dueDate} />
        {commitment.occurredAt && <> · From {commitment.sourceLabel}, {dayLabel(commitment.occurredAt)}</>}
        {commitment.confirmation && <> · {commitment.confirmation}</>}
      </p>
      {commitment.previousDecision && <Notice tone="info">{commitment.previousDecision}</Notice>}
      {commitment.completionEvidenceId && commitment.state === 'accepted' && (
        <Notice tone="info" title="A later message may show this is done" action={<ButtonRow><Button size="sm" onClick={() => ui.showEvidence(commitment.completionEvidenceId!)}>View message</Button><Button size="sm" onClick={() => void decide('complete')}>Mark complete</Button><Button size="sm" variant="quiet" onClick={() => void decide('keep_open')}>Keep open</Button></ButtonRow>}>
          Nothing was completed automatically. Your Ri task is unchanged.
        </Notice>
      )}
      {commitment.taskLink && <div><TaskStatus link={commitment.taskLink} /></div>}
      <ButtonRow>
        {commitment.evidenceId && <Button size="sm" variant="link" onClick={() => ui.showEvidence(commitment.evidenceId!, commitment.passage)}>View evidence</Button>}
        {ui.data.canWrite && commitment.state === 'suggested' && <Button size="sm" onClick={() => void decide('accept')} busy={review.pending}>Accept</Button>}
        {ui.data.canWrite && (commitment.state === 'suggested' || commitment.state === 'accepted') && !commitment.taskLink && (
          <Button size="sm" onClick={() => ui.followUp({ subject: { kind: 'commitment', id: commitment.id }, title: commitment.action, dueDate: commitment.dueDate, label: subject?.name ?? 'This commitment' })}>{commitment.state === 'suggested' ? 'Accept and create task' : 'Create follow-up'}</Button>
        )}
        {ui.data.canWrite && commitment.state !== 'completed' && commitment.state !== 'dismissed' && commitment.state !== 'withdrawn' && (
          <Menu size="sm" variant="quiet" label="More" items={[
            { id: 'edit', label: 'Edit wording or date' },
            ...(commitment.state === 'accepted' ? [{ id: 'complete', label: 'Mark complete' }] : []),
            commitment.snoozedUntil ? { id: 'unsnooze', label: 'Clear snooze' } : { id: 'snooze', label: 'Snooze for a week' },
            { id: 'dismiss', label: 'Dismiss' },
          ]} onSelect={(choice) => {
            if (choice === 'edit') setEditing(true);
            else if (choice === 'snooze') void decide('snooze', { snoozedUntil: tomorrow });
            else void decide(choice);
          }} />
        )}
        {ui.data.canWrite && (commitment.state === 'completed' || commitment.state === 'dismissed' || commitment.state === 'withdrawn') && <Button size="sm" variant="quiet" onClick={() => void decide(commitment.state === 'withdrawn' || commitment.state === 'dismissed' ? 'accept' : 'reopen')}>Reopen</Button>}
      </ButtonRow>
      {review.error && <InlineError>{review.error}</InlineError>}
      {editing && <EditCommitmentDialog commitment={commitment} onClose={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

function EditCommitmentDialog({ commitment, onClose }: { commitment: Commitment; onClose(): void }) {
  const [action, setAction] = useState(commitment.action);
  const [due, setDue] = useState<string | null>(commitment.dueDate);
  const review = useSave<Saved<Commitment>>('review_commitment');
  const [conflict, setConflict] = useState<Commitment | null>(null);
  const submit = async (revision: number) => {
    const result = await review.run({ id: commitment.id, expectedRevision: revision, decision: commitment.state === 'suggested' ? 'accept' : 'keep_open', action, dueDate: due }, 'Saved');
    if (result.status === 'conflict') { setConflict(result.current); review.reset(); return; }
    onClose();
  };
  return (
    <Dialog open title="Edit commitment" description="Your wording is saved beside the extracted text, which stays as evidence." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={review.pending} onClick={() => void submit(conflict?.revision ?? commitment.revision)}>Save</Button></ButtonRow>}>
      <div className="pe-stack">
        {conflict && <ConflictNotice fields={[{ label: 'Commitment', mine: action, current: conflict.action }, { label: 'Due', mine: due ?? 'None', current: conflict.dueDate ?? 'None' }]} onKeepMine={() => submit(conflict.revision)} onUseCurrent={() => { setAction(conflict.action); setDue(conflict.dueDate); setConflict(null); }} />}
        <TextInput label="Commitment" value={action} onChange={setAction} />
        <DateInput label="Due date" hint="Only when a date was agreed" value={due} onChange={setDue} />
        {review.error && <InlineError>{review.error}</InlineError>}
      </div>
    </Dialog>
  );
}

function toKit(item: TimelineItem, actions: React.ReactNode): KitTimelineItem {
  return {
    id: item.id,
    date: item.status === 'upcoming' ? 'Upcoming' : item.type === 'note' ? 'Your note' : dayLabel(item.occurredAt),
    title: item.label,
    meta: [item.sourceLabel, item.participants.length ? item.participants.map((participant) => participant.name).join(', ') + (item.moreParticipants ? ` and ${item.moreParticipants} more` : '') : null, item.threadCount ? `${item.threadCount} messages` : null].filter(Boolean).join(' · '),
    body: (
      <div className="pe-stack" style={{ gap: '0.25rem' }}>
        <p>{item.type === 'meeting' && item.status === 'upcoming' ? `${item.title}, ${meetingLabel(item.occurredAt)}` : item.title}</p>
        {item.detail && item.type !== 'email' && <p className="pe-small pe-muted">{item.detail}</p>}
        {item.links.length > 0 && <p className="pe-small pe-muted">{item.links.map((link) => `${link.origin === 'rule' ? 'Attributed to' : 'Linked to'} ${link.name}`).join(' · ')}</p>}
      </div>
    ),
    excerpt: item.type === 'email' && item.detail ? item.detail : undefined,
    actions,
    tone: item.status === 'cancelled' || item.status === 'unavailable' ? 'warning' : undefined,
  };
}

export function PersonTimeline({ id, subjectKind = 'person' }: { id: string; subjectKind?: 'person' | 'organization' | 'opportunity' }) {
  const ui = usePeople();
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<TimelineItem[][]>([]);
  const first = useQuery<{ items: TimelineItem[]; nextCursor: string | null }>('list_interactions', { subjectKind, subjectId: id, limit: 20, ...(subjectKind === 'organization' ? { include: ['email', 'meeting'] } : {}) });
  const more = useQuery<{ items: TimelineItem[]; nextCursor: string | null }>('list_interactions', { subjectKind, subjectId: id, limit: 50, cursor: cursor ?? '' , ...(subjectKind === 'organization' ? { include: ['email', 'meeting'] } : {}) }, { enabled: !!cursor });
  const link = useSave<Saved<TimelineItem>>('link_interaction');
  const announce = useAnnounce();
  useEffect(() => { setPages([]); setCursor(null); }, [id]);
  useEffect(() => { if (more.data && cursor) setPages((current) => [...current, more.data!.items]); }, [more.data]);
  if (first.error && !first.data) return <Failure error={first.error} reload={first.reload} />;
  if (!first.data) return <Loading label="Loading timeline" />;
  const items = [...first.data.items, ...pages.flat()];
  const next = pages.length ? more.data?.nextCursor ?? null : first.data.nextCursor;
  if (!items.length) return <EmptyState compact headingLevel={3} title={subjectKind === 'organization' ? 'No linked activity yet' : 'Nothing in the timeline yet'}>{subjectKind === 'organization' ? 'Only conversations you link, or that a confirmed attribution rule covers, appear here. A person\'s unrelated exchanges never do.' : 'Conversations, meetings and notes appear here as they are found or added.'}</EmptyState>;
  const decide = async (item: TimelineItem, operation: string) => {
    const result = await link.run({ interactionId: item.id, expectedRevision: item.revision, operation });
    announce(result.status === 'saved' ? 'Saved' : 'This changed. Showing the latest');
    link.reset();
    void first.reload();
  };
  return (
    <div className="pe-stack">
      <Timeline label="Timeline" items={items.map((item) => toKit(item, (
        <>
          {item.evidenceId && <Button size="sm" variant="link" onClick={() => ui.showEvidence(item.evidenceId!)}>Read source</Button>}
          {ui.data.canWrite && item.type === 'meeting' && item.status === 'active' && item.attendance === 'unknown' && <Button size="sm" variant="link" onClick={() => void decide(item, 'confirm_attendance')}>I attended</Button>}
          {ui.data.canWrite && item.type === 'meeting' && item.attendance !== 'unknown' && item.attendance !== null && <Button size="sm" variant="link" onClick={() => void decide(item, 'clear_attendance')}>Clear attendance</Button>}
        </>
      )))} />
      {next && <Button onClick={() => setCursor(next)} busy={more.loading}>Show earlier</Button>}
    </div>
  );
}

export function NotesPanel({ subjectKind, subjectId, notes, reload, focusNew = 0 }: { subjectKind: 'person' | 'organization' | 'opportunity'; subjectId: string; notes: Note[]; reload(): void; focusNew?: number }) {
  const ui = usePeople();
  return (
    <div className="pe-stack pe-stack--loose">
      {ui.data.canWrite && <NoteEditor key="new" subjectKind={subjectKind} subjectId={subjectId} onSaved={reload} focus={focusNew} />}
      {notes.length === 0 && <p className="pe-muted">No notes yet. Notes stay in your collection and are never shared with a company or a chat unless you share that collection.</p>}
      {notes.map((note) => <NoteEditor key={note.id} note={note} subjectKind={subjectKind} subjectId={subjectId} onSaved={reload} />)}
    </div>
  );
}

/** Drafts live in component state, so a background refresh never resets typing. */
const drafts = new Map<string, string>();
function NoteEditor({ note, subjectKind, subjectId, onSaved, focus = 0 }: { note?: Note; subjectKind: string; subjectId: string; onSaved(): void; focus?: number }) {
  const ui = usePeople();
  const wrap = useRef<HTMLDivElement>(null);
  // Add note in the header opens the Notes section with the new note ready for typing.
  useEffect(() => {
    if (!focus) return;
    const field = wrap.current?.querySelector('textarea');
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'center' });
  }, [focus]);
  const key = note ? `note:${note.id}` : `new:${subjectKind}:${subjectId}`;
  const [body, setBodyState] = useState(drafts.get(key) ?? note?.body ?? '');
  const [editing, setEditing] = useState(!note || drafts.has(key));
  const [conflict, setConflict] = useState<Note | null>(null);
  const save = useSave<Saved<Note>>('save_note');
  const setBody = (value: string) => { setBodyState(value); drafts.set(key, value); };
  const submit = async (revision?: number) => {
    const result = await save.run(note ? { id: note.id, expectedRevision: revision ?? note.revision, body } : { subjectKind, subjectId, body }, 'Note saved');
    if (result.status === 'conflict') { setConflict(result.current); save.reset(); return; }
    drafts.delete(key);
    save.reset();
    setConflict(null);
    if (note) setEditing(false); else setBodyState('');
    onSaved();
  };
  if (note && !editing) return (
    <div className="pe-card pe-stack" style={{ gap: '0.5rem' }}>
      <div className="pe-row pe-between">
        <p className="pe-small pe-muted">{note.title ? `${note.title} · ` : ''}{note.collectionLabel} · {dayLabel(note.updatedAt)}</p>
        {ui.data.canWrite && <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{note.body}</p>
    </div>
  );
  return (
    <div ref={wrap} className="pe-stack pe-note-editor">
      {conflict && <ConflictNotice title="This note changed since you started editing" fields={[{ label: 'Note', mine: body, current: conflict.body }]} onKeepMine={() => submit(conflict.revision)} onUseCurrent={() => { setBody(conflict.body); setConflict(null); }} busy={save.pending} />}
      <TextArea label={note ? 'Edit your note' : subjectKind === 'organization' ? 'Your company note' : 'Your private note'} hint={note ? undefined : 'Saved to your records. Never sent anywhere.'} value={body} onChange={setBody} />
      <ButtonRow>
        <Button variant="primary" busy={save.pending} disabled={!body.trim()} onClick={() => void submit()}>{note ? 'Save note' : 'Add note'}</Button>
        {note && <Button variant="quiet" onClick={() => { drafts.delete(key); setBodyState(note.body); setEditing(false); }}>Cancel</Button>}
        {note && <Button variant="quiet" onClick={async () => { await save.run({ id: note.id, expectedRevision: note.revision, archived: true }, 'Note archived'); drafts.delete(key); save.reset(); onSaved(); }}>Archive</Button>}
      </ButtonRow>
      {save.error && <InlineError>{save.error}</InlineError>}
    </div>
  );
}

function PersonDetails({ detail, reload }: { detail: PersonDetail & { merges: { id: string; revision: number; survivorId: string; mergedId: string; createdAt: string }[] }; reload(): void }) {
  const ui = usePeople();
  const [affiliation, setAffiliation] = useState<Affiliation | 'new' | null>(null);
  const [attribution, setAttribution] = useState<Identity | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const save = useSave<Saved<unknown>>('save_person');
  const decideAffiliation = useSave<Saved<Affiliation>>('save_affiliation');
  const lists = useQuery<{ items: { id: string; name: string; revision: number }[] }>('list_lists', { recordKind: 'person', limit: 100 });
  const members = useSave<Saved<unknown>>('update_list_members');
  const announce = useAnnounce();
  const person = detail.person;
  const correct = async (patch: Record<string, unknown>, message: string) => {
    const result = await save.run({ id: person.id, expectedRevision: person.revision, ...patch });
    announce(result.status === 'saved' ? message : 'This person changed. Try again');
    save.reset();
    reload();
  };
  const workEmails = detail.identities.filter((identity) => identity.kind === 'email' && !identity.shared && !/@(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton|fastmail|me|aol)\./i.test(identity.value));
  return (
    <div className="pe-stack pe-stack--loose">
      <section className="pe-stack" aria-label="Known identities">
        <h3 className="ri-h3">Addresses and profiles</h3>
        {detail.identities.length ? (
          <ul className="pe-list">
            {detail.identities.map((identity) => (
              <li key={identity.keyId} className="pe-identity">
                <span>{identity.value}</span>
                <span className="pe-pill">{identity.confirmation === 'confirmed' ? 'Confirmed by you' : `Seen in ${identity.sources.join(', ')}`}</span>
                {identity.shared && <span className="pe-pill">Shared inbox</span>}
                {ui.data.canWrite && identity.kind === 'email' && (
                  <Menu size="sm" variant="quiet" label="Correct" items={[{ id: 'detach', label: 'Not this person' }, { id: 'shared', label: 'This is a shared inbox' }, ...(ui.data.owner && workEmails.includes(identity) ? [{ id: 'attribute', label: 'Include work conversations with this address' }] : [])]}
                    onSelect={(choice) => choice === 'attribute' ? setAttribution(identity) : void correct(choice === 'detach' ? { detachKeyIds: [identity.keyId] } : { sharedKeyIds: [identity.keyId] }, 'Correction saved. It survives resync')} />
                )}
              </li>
            ))}
          </ul>
        ) : <p className="pe-muted">No address recorded. That is normal for an imported connection.</p>}
      </section>
      <section className="pe-stack" aria-label="Affiliations">
        <div className="pe-row pe-between"><h3 className="ri-h3">Companies and roles</h3>{ui.data.canWrite && <Button size="sm" onClick={() => setAffiliation('new')}>Add affiliation</Button>}</div>
        {detail.affiliations.length ? (
          <ul className="pe-list">
            {detail.affiliations.map((item) => (
              <li key={item.id} className="pe-stack" style={{ gap: '0.25rem' }}>
                <p><strong>{item.role ?? 'Role not recorded'}</strong> · <NameLink kind="company" id={item.organizationId} name={item.organizationName} /></p>
                <p className="pe-small pe-muted">{item.description}{item.validFrom ? ` · From ${item.validFrom}` : ''}{item.validTo ? ` · Until ${item.validTo}` : ''}</p>
                {ui.data.canWrite && (
                  <ButtonRow>
                    {item.evidenceId && <Button size="sm" variant="link" onClick={() => ui.showEvidence(item.evidenceId!)}>View evidence</Button>}
                    {item.confidence !== 'confirmed' && <Button size="sm" onClick={async () => { await decideAffiliation.run({ id: item.id, expectedRevision: item.revision, decision: 'confirm', status: 'current' }, 'Confirmed as current'); decideAffiliation.reset(); reload(); }}>Confirm as current</Button>}
                    {item.confidence === 'confirmed' && item.status !== 'former' && <Button size="sm" onClick={() => setAffiliation(item)}>Edit or end</Button>}
                    <Button size="sm" variant="quiet" onClick={async () => { await decideAffiliation.run({ id: item.id, expectedRevision: item.revision, decision: 'reject' }, 'Removed. It will not come back on resync'); decideAffiliation.reset(); reload(); }}>{item.confidence === 'suggested' ? 'Not correct' : 'Remove'}</Button>
                  </ButtonRow>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="pe-muted">No company recorded. People without a company are perfectly valid.</p>}
        {detail.attribution.length > 0 && (
          <ul className="pe-list">
            {detail.attribution.map((rule) => <li key={rule.id} className="pe-small">Work conversations with {rule.identity} in {rule.account} {rule.state === 'active' ? 'count toward' : 'no longer count toward'} {rule.organization.name}{rule.from ? ` from ${rule.from}` : ''}{rule.to ? ` until ${rule.to}` : ''}.</li>)}
          </ul>
        )}
      </section>
      {detail.facts.length > 0 && (
        <section className="pe-stack" aria-label="Sourced details">
          <h3 className="ri-h3">Sourced details</h3>
          {detail.facts.map((fact) => <FactRow key={fact.id} fact={fact} reload={reload} />)}
        </section>
      )}
      <section className="pe-stack" aria-label="Lists">
        <h3 className="ri-h3">Lists</h3>
        <div className="pe-row">
          {detail.lists.length ? detail.lists.map((list) => <span key={list.id} className="pe-pill">{list.name}</span>) : <span className="pe-muted">Not on any list</span>}
          {ui.data.canWrite && lists.data && lists.data.items.length > 0 && (
            <Menu size="sm" variant="quiet" label="Change lists" items={lists.data.items.map((list) => ({ id: list.id, label: `${detail.lists.some((item) => item.id === list.id) ? 'Remove from' : 'Add to'} ${list.name}` }))}
              onSelect={async (listId) => { const list = lists.data!.items.find((item) => item.id === listId)!; const on = detail.lists.some((item) => item.id === listId); await members.run({ listId, expectedRevision: list.revision, ...(on ? { remove: [person.id] } : { add: [person.id] }) }, on ? 'Removed from list' : 'Added to list'); members.reset(); void lists.reload(); reload(); }} />
          )}
        </div>
      </section>
      {detail.opportunities.length > 0 && (
        <section className="pe-stack" aria-label="Opportunities">
          <h3 className="ri-h3">Opportunities</h3>
          <ul className="pe-list">{detail.opportunities.map((opportunity) => <li key={opportunity.id}><button type="button" className="pe-link" onClick={() => ui.openOpportunity(opportunity.id)}>{opportunity.title}</button> <span className="pe-small pe-muted">· {opportunity.pipelineName} · {opportunity.stageLabel}</span></li>)}</ul>
        </section>
      )}
      <KeyValueList stacked items={[
        { label: 'How this person was found', value: person.originLabel },
        { label: 'Collection', value: person.collection === 'manual' ? 'Your records' : person.collection },
        { label: 'Names seen in sources', value: person.observedNames.length ? person.observedNames.map((name) => `${name.name} (${name.sourceLabel})`).join(', ') : 'Not recorded' },
        { label: 'Added', value: dayLabel(person.createdAt) },
      ]} />
      {detail.merges.length > 0 && ui.data.owner && (
        <section className="pe-stack" aria-label="Merges">
          <h3 className="ri-h3">Merged records</h3>
          {detail.merges.map((merge) => <div key={merge.id} className="pe-row"><span className="pe-small pe-muted">Merged {dayLabel(merge.createdAt)}</span><Button size="sm" onClick={() => setUndo(merge.id)}>Undo merge</Button></div>)}
        </section>
      )}
      {affiliation && <AffiliationDialog personId={person.id} affiliation={affiliation === 'new' ? null : affiliation} onClose={() => { setAffiliation(null); reload(); }} />}
      {attribution && <AttributionDialog personId={person.id} identity={attribution} onClose={() => { setAttribution(null); reload(); }} />}
      {undo && <UndoMergeDialog mergeId={undo} onClose={() => { setUndo(null); reload(); }} />}
    </div>
  );
}

export function FactRow({ fact, reload }: { fact: Fact; reload(): void }) {
  const ui = usePeople();
  const review = useSave<Saved<Fact>>('review_fact');
  const decide = async (decision: string) => { await review.run({ id: fact.id, expectedRevision: fact.revision, decision }, decision === 'accept' ? 'Accepted' : 'Saved'); review.reset(); reload(); };
  return (
    <div className="pe-card pe-stack" style={{ gap: '0.5rem' }}>
      <div className="pe-row"><span className="pe-section-label">{fact.label}</span>{fact.status === 'suggested' ? <StatusLabel tone="warning">Suggestion</StatusLabel> : <StatusLabel>Confirmed by you</StatusLabel>}</div>
      <p><strong>{fact.userValue ?? fact.value}</strong></p>
      <p className="pe-small pe-muted">From {fact.sourceLabel}, {dayLabel(fact.observedAt)}. {fact.origin === 'signature' ? 'Read from an email signature.' : fact.origin === 'extraction' ? 'Suggested by relationship extraction.' : 'From an import.'}</p>
      {fact.previousDecision && <Notice tone="info">{fact.previousDecision}</Notice>}
      {ui.data.canWrite && (
        <ButtonRow>
          {fact.evidenceId && <Button size="sm" variant="link" onClick={() => ui.showEvidence(fact.evidenceId!, fact.passage)}>View evidence</Button>}
          {fact.status === 'suggested' && <Button size="sm" busy={review.pending} onClick={() => void decide('accept')}>Accept</Button>}
          {fact.status === 'suggested' && <Button size="sm" variant="quiet" onClick={() => void decide('reject')}>Reject</Button>}
          {fact.status === 'active' && <Button size="sm" variant="quiet" onClick={() => void decide('withdraw')}>Remove from context</Button>}
        </ButtonRow>
      )}
      {review.error && <InlineError>{review.error}</InlineError>}
    </div>
  );
}

function EditPersonDialog({ detail, onClose }: { detail: PersonDetail; onClose(): void }) {
  const person = detail.person;
  const [name, setName] = useState(person.nameOverride ?? person.name);
  const [headline, setHeadline] = useState(person.headline ?? '');
  const [keep, setKeep] = useState(person.keepInTouchDays ? String(person.keepInTouchDays) : '');
  const [email, setEmail] = useState('');
  const save = useSave<Saved<unknown>>('save_person');
  const [conflict, setConflict] = useState<number | null>(null);
  const submit = async (revision: number) => {
    const result = await save.run({
      id: person.id, expectedRevision: revision,
      name: name.trim() && name.trim() !== person.name ? name.trim() : person.nameOverride && !name.trim() ? null : undefined,
      headline: headline.trim() || null, keepInTouchDays: keep ? Number(keep) : null,
      ...(email.trim() ? { addIdentifiers: [{ kind: 'email', value: email.trim() }] } : {}),
    }, 'Saved');
    if (result.status === 'conflict') { setConflict((result.current as { revision: number }).revision); save.reset(); return; }
    onClose();
  };
  return (
    <Dialog open title={`Edit ${person.name}`} description="Your corrections take precedence over what sources say and survive resync." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.pending} onClick={() => void submit(conflict ?? person.revision)}>Save</Button></ButtonRow>}>
      <div className="pe-stack">
        {conflict !== null && <Notice tone="warning" title="This person changed since you opened it">Your edits are kept here. Save again to apply them to the latest version.</Notice>}
        <TextInput label="Name" hint={person.observedNames.length ? `Sources say ${person.observedNames.map((item) => item.name).join(', ')}` : undefined} value={name} onChange={setName} />
        <TextInput label="Short description" hint="Such as Independent consultant. Optional" value={headline} onChange={setHeadline} />
        <TextInput label="Add an email address" type="email" value={email} onChange={setEmail} />
        <Select label="Keep in touch" hint="Optional. A reminder appears on Today when it has been longer than this" value={keep} onChange={setKeep} options={[{ value: '', label: 'No reminder' }, { value: '14', label: 'Every 2 weeks' }, { value: '30', label: 'Every month' }, { value: '90', label: 'Every 3 months' }, { value: '180', label: 'Every 6 months' }]} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

export function AffiliationDialog({ personId, affiliation, onClose }: { personId: string; affiliation: Affiliation | null; onClose(): void }) {
  const companies = useQuery<{ items: { id: string; name: string }[] }>('list_organizations', { limit: 100 });
  const [company, setCompany] = useState(affiliation?.organizationId ?? '');
  const [newName, setNewName] = useState('');
  const [role, setRole] = useState(affiliation?.role ?? '');
  const [from, setFrom] = useState<string | null>(affiliation?.validFrom ?? null);
  const [to, setTo] = useState<string | null>(affiliation?.validTo ?? null);
  const save = useSave<Saved<Affiliation>>('save_affiliation');
  const submit = async () => {
    const result = affiliation
      ? await save.run({ id: affiliation.id, expectedRevision: affiliation.revision, role: role || null, validFrom: from, validTo: to }, to ? 'Affiliation ended. Old conversations stay where they were' : 'Saved')
      : await save.run({ personId, ...(company === 'new' || !company ? { organizationName: newName } : { organizationId: company }), role: role || null, validFrom: from, validTo: to, status: to ? 'former' : 'current' }, 'Affiliation added');
    if (result.status === 'conflict') return;
    onClose();
  };
  return (
    <Dialog open title={affiliation ? `Edit role at ${affiliation.organizationName}` : 'Add affiliation'} description="Dates can be unknown. Ending a role never moves old conversations to a new company." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.pending} onClick={() => void submit()}>Save</Button></ButtonRow>}>
      <div className="pe-stack">
        {!affiliation && <Select label="Company" value={company} onChange={setCompany} placeholder="Choose a company" options={[...(companies.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })), { value: 'new', label: 'New company' }]} />}
        {!affiliation && (company === 'new' || !company) && <TextInput label="New company name" value={newName} onChange={setNewName} />}
        <TextInput label="Role" hint="Optional" value={role} onChange={setRole} />
        <DateInput label="From" hint="Optional" value={from} onChange={setFrom} />
        <DateInput label="Until" hint="Leave empty while current" value={to} onChange={setTo} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

function AttributionDialog({ personId, identity, onClose }: { personId: string; identity: Identity; onClose(): void }) {
  const companies = useQuery<{ items: { id: string; name: string }[] }>('list_organizations', { limit: 100 });
  const sources = useQuery<{ accounts: { account: string; source: string; label: string; kind: string }[] }>('list_sources', {});
  const [company, setCompany] = useState('');
  const [account, setAccount] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const preview = useSave<{ status?: string; previewId: string; digest: string; matches: { total: number; sample: TimelineItem[] }; note: string; draft: { organization: { name: string }; account: string } }>('preview_company_attribution');
  const apply = useSave<{ status: string; linked: number; more: boolean }>('apply_company_attribution');
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof preview.run>> | null>(null);
  const accounts = useMemo(() => (sources.data?.accounts ?? []).filter((item) => item.kind === 'mail'), [sources.data]);
  return (
    <Dialog open wide title="Include work conversations with this address" description={`Direct work exchanges with ${identity.value} in one account and date range will count toward a company, now and on later syncs. Notes, other addresses and other accounts are not moved.`} onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button>{plan ? <Button variant="primary" busy={apply.pending} onClick={async () => { await apply.run({ previewId: plan.previewId, digest: plan.digest }, 'Rule saved'); onClose(); }}>Include {plan.matches.total} conversation{plan.matches.total === 1 ? '' : 's'}</Button> : <Button variant="primary" busy={preview.pending} disabled={!company || !account} onClick={async () => { const result = await preview.run({ personId, keyId: identity.keyId, organizationId: company, account, from, to }); setPlan(result); preview.reset(); }}>Preview matches</Button>}</ButtonRow>}>
      <div className="pe-stack">
        <Select label="Company" value={company} onChange={(value) => { setCompany(value); setPlan(null); }} placeholder="Choose a company" options={(companies.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))} />
        <Select label="Account" value={account} onChange={(value) => { setAccount(value); setPlan(null); }} placeholder="Choose an account" options={accounts.map((item) => ({ value: item.source, label: item.label }))} />
        <div className="pe-row"><DateInput label="From" hint="Optional" value={from} onChange={(value) => { setFrom(value); setPlan(null); }} /><DateInput label="Until" hint="Optional" value={to} onChange={(value) => { setTo(value); setPlan(null); }} /></div>
        {plan && (
          <div className="pe-card pe-stack">
            <p><strong>{plan.matches.total}</strong> matching direct exchange{plan.matches.total === 1 ? '' : 's'} in {plan.draft.account}.</p>
            <ul className="pe-list">{plan.matches.sample.map((item) => <li key={item.id} className="pe-small">{dayLabel(item.occurredAt)} · {item.title}</li>)}</ul>
            <p className="pe-small pe-muted">{plan.note}</p>
          </div>
        )}
        {(preview.error || apply.error) && <InlineError>{preview.error ?? apply.error}</InlineError>}
      </div>
    </Dialog>
  );
}

export function UndoMergeDialog({ mergeId, onClose }: { mergeId: string; onClose(): void }) {
  const [preview, setPreview] = useState<{ revision: number; digest: string; restores: number; laterReferences: { ref: string; label: string; createdAt: string }[] } | null>(null);
  const [choices, setChoices] = useState<Record<string, 'survivor' | 'restored'>>({});
  const { call } = useRiApp();
  const undo = useSave<{ status: string; skipped: string[] }>('undo_merge');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void call<NonNullable<typeof preview>>('undo_merge', { mergeId, preview: true }).then((value) => { setPreview(value); setChoices(Object.fromEntries(value.laterReferences.map((item) => [item.ref, 'survivor']))); }, (failure: Error) => setError(failure.message)); }, [mergeId]);
  return (
    <Dialog open title="Undo merge" description="Restores the separate record and exactly the references the merge moved." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={undo.pending} disabled={!preview} onClick={async () => { try { await undo.run({ mergeId, expectedRevision: preview!.revision, digest: preview!.digest, attributions: Object.entries(choices).map(([ref, to]) => ({ ref, to })) }, 'Merge undone'); onClose(); } catch { /* shown below */ } }}>Undo merge</Button></ButtonRow>}>
      {error ? <InlineError>{error}</InlineError> : !preview ? <Loading label="Preparing undo" /> : (
        <div className="pe-stack">
          <p>{preview.restores} reference{preview.restores === 1 ? '' : 's'} will return to the restored record.</p>
          {preview.laterReferences.length > 0 ? (
            <fieldset className="ri-fieldset">
              <legend>Added after the merge. Choose where each belongs</legend>
              {preview.laterReferences.map((item) => (
                <div key={item.ref} className="pe-row pe-between">
                  <span className="pe-small">{item.label}</span>
                  <Select hideLabel label={`Where ${item.label} belongs`} value={choices[item.ref] ?? 'survivor'} onChange={(value) => setChoices((current) => ({ ...current, [item.ref]: value as 'survivor' | 'restored' }))} options={[{ value: 'survivor', label: 'Keep on this record' }, { value: 'restored', label: 'Move to the restored record' }]} />
                </div>
              ))}
            </fieldset>
          ) : <p className="pe-muted">Nothing was added after the merge.</p>}
          {undo.error && <InlineError>{undo.error}</InlineError>}
        </div>
      )}
    </Dialog>
  );
}

export function RemoveDialog({ kind, id, name, revision, onClose }: { kind: 'person' | 'organization'; id: string; name: string; revision: number; onClose(): void }) {
  const ui = usePeople();
  const [mode, setMode] = useState<'archive' | 'remove'>('archive');
  const [notes, setNotes] = useState<'keep' | 'delete'>('keep');
  const [suppress, setSuppress] = useState(false);
  const remove = useSave<{ status: string; message: string }>('delete_record');
  return (
    <Dialog open title={`Archive or remove ${name}`} onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant={mode === 'remove' ? 'danger-solid' : 'primary'} busy={remove.pending} onClick={async () => { const result = await remove.run({ kind, id, expectedRevision: revision, mode, notes, suppress }, undefined); if (result.status === 'saved') { onClose(); ui.go({ record: null }); } }}>{mode === 'archive' ? 'Archive' : 'Remove'}</Button></ButtonRow>}>
      <div className="pe-stack">
        <Select label="What to do" value={mode} onChange={(value) => setMode(value as 'archive' | 'remove')} options={[{ value: 'archive', label: 'Archive. Hide it and keep everything' }, { value: 'remove', label: kind === 'person' ? 'Remove imported details and links' : 'Remove the company and its links' }]} />
        {mode === 'remove' && <Select label="Your notes" value={notes} onChange={(value) => setNotes(value as 'keep' | 'delete')} options={[{ value: 'keep', label: 'Keep my notes on an archived record' }, { value: 'delete', label: 'Delete my notes too' }]} />}
        <Checkbox label="Do not rediscover from sources" hint="Keeps only the addresses needed to skip them. You can reverse this in Sources" checked={suppress} onChange={setSuppress} />
        <p className="pe-small pe-muted">{kind === 'organization' ? 'People at this company and Ri tasks are never deleted.' : 'Conversations stay in their mailbox source. Ri tasks are never deleted.'}</p>
        {remove.error && <InlineError>{remove.error}</InlineError>}
      </div>
    </Dialog>
  );
}
