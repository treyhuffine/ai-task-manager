/** @jsxRuntime automatic */
import { useEffect, useState } from 'react';
import {
  AskRiButton, Button, ButtonRow, Dialog, EmptyState, ErrorState, InlineError, KeyValueList, LoadingState, Notice, SectionPanel, SectionTabs, SourceLine, StatusLabel, Timeline,
  useAnnounce, useMutation, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import { CHANNEL_LABELS, MATERIAL_LABELS } from '../domain/labels.js';
import { compensationLabel, formatCompensation } from '../domain/compensation.js';
import type { Location } from './app.js';
import type { CorrespondenceDetail, FollowUpItem, Interview, OpportunityDetail, OpportunityRecord, PostingDetail, Write } from './types.js';
import { DetailsDialog, FollowUpButton, InterviewDialog, RecordApplicationDialog, StageMenu } from './dialogs.js';
import { authorText, classificationText, CONFIDENCE_TEXT, dayOf, DECISION_TEXT, durationText, errorText, FORMAT_TEXT, interviewStatusText, locationText, mediumDate, shortDate, stageText, whenText } from './format.js';

type Go = (patch: Partial<Location> | ((current: Location) => Partial<Location>)) => void;
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'posting', label: 'Posting' },
  { id: 'correspondence', label: 'Correspondence' },
  { id: 'materials', label: 'Materials' },
  { id: 'interviews', label: 'Interviews' },
];

export function OpportunityWorkspace({ id, section, go, onAddDescription }: { id: string; section: string | null; go: Go; onAddDescription: () => void }) {
  const app = useRiApp();
  const detail = useQuery<OpportunityDetail>('get_opportunity', { id });
  const [dialog, setDialog] = useState<null | 'details' | 'record' | 'interview' | { interview: Interview }>(null);
  const tab = SECTIONS.some((item) => item.id === section) ? section! : 'overview';
  // Previous data stays while a different record loads. Never show or describe it as this one.
  const current = detail.data?.opportunity.id === id ? detail.data : undefined;
  useEffect(() => {
    if (!current) return;
    const upcoming = current.interviews.find((interview) => interview.status === 'scheduled' && interview.startAt && Date.parse(interview.endAt ?? interview.startAt) > Date.now());
    app.context({ section: 'opportunity', selected: [{ type: 'opportunity', id }, ...(upcoming ? [{ type: 'interview', id: upcoming.id }] : [])], revisions: { [id]: current.opportunity.revision } });
  }, [app, id, current]);
  if (detail.error && !current) return <ErrorState title="This opportunity could not open" message={detail.error} onRetry={detail.reload} />;
  if (!current) return <LoadingState label="Loading opportunity" rows={4} />;
  const data = current;
  const record = data.opportunity;
  const upcoming = data.interviews.filter((interview) => interview.status === 'scheduled' && interview.startAt && Date.parse(interview.endAt ?? interview.startAt) > Date.now()).sort((a, b) => a.startAt!.localeCompare(b.startAt!))[0];
  const scheduling = data.interviews.find((interview) => interview.status === 'scheduling_needed');
  const status = upcoming ? { tone: 'success' as const, text: 'Interview confirmed' } : scheduling ? { tone: 'warning' as const, text: 'Scheduling needed' } : { tone: record.stage === 'offer' ? 'success' as const : 'neutral' as const, text: stageText(record.stage, record.outcome) };
  const preparePrompt = upcoming
    ? `Prepare me for my ${upcoming.title} with ${record.company} on ${whenText(upcoming.startAt, upcoming.zone, { viewer: false })}. Use the saved ${record.role} posting, the exact materials I submitted and our permitted correspondence. Keep my own experience separate from suggestions and do not invent experience.`
    : `Help me prepare for ${record.company} using the saved ${record.role} posting, the materials I submitted and permitted correspondence. Do not invent experience.`;

  return (
    <article className="ri-stack ri-stack--loose" aria-labelledby="js-workspace-title">
      <div className="js-workspace-head">
        <div className="js-workspace-head__text">
          <span className="ri-eyebrow">{record.company}</span>
          <h2 id="js-workspace-title" className="js-workspace-title">{record.role}</h2>
          <p className="ri-muted">{locationText(record)} · {stageText(record.stage, record.outcome)}{record.stageLocked ? ' (set by you)' : ''}</p>
          <div><StatusLabel tone={status.tone}>{status.text}</StatusLabel></div>
        </div>
        <ButtonRow>
          <StageMenu opportunity={record} onChanged={detail.reload} />
          <Button onClick={() => setDialog('details')}>Edit details</Button>
          <FollowUpButton subject={{ type: 'opportunity', id: record.id }} label={`${record.company} · ${record.role}`} defaultTitle={record.nextAction ?? `Follow up with ${record.company}`} defaultDue={record.nextActionDue} onCreated={detail.reload} />
        </ButtonRow>
      </div>

      {upcoming && (
        <div className="js-strip">
          <div className="js-strip__text">
            <span className="ri-eyebrow">{upcoming.title}</span>
            <h3 className="js-strip__title">{whenText(upcoming.startAt, upcoming.zone)}</h3>
            <p className="js-strip__meta">{[upcoming.participants.filter((person) => person.role !== 'self').map((person) => person.name ?? person.email).filter(Boolean).join(', '), durationText(upcoming.startAt, upcoming.endAt), FORMAT_TEXT[upcoming.format]].filter(Boolean).join(' · ')}</p>
            <SourceLine label={upcoming.origin === 'calendar' ? 'calendar event' : upcoming.origin === 'mail' ? 'confirmation email' : 'added by you'} observedAt={upcoming.updatedAt} />
          </div>
          <Button variant="primary" onClick={() => go({ prepare: { opportunityId: record.id, interviewId: upcoming.id } })}>Open preparation</Button>
        </div>
      )}
      {data.reviews.length > 0 && <Notice tone="warning" title={data.reviews.length === 1 ? 'One item about this role needs your decision' : `${data.reviews.length} items about this role need your decision`} action={<Button size="sm" onClick={() => go({ tab: 'sources', opportunityId: null })}>Review in Sources</Button>}>{data.reviews[0].summary}</Notice>}
      {record.listingClosedAt && <Notice tone="info" title="The listing is closed">Saved descriptions stay readable under Posting, including the one your preparation uses.</Notice>}

      <div className="js-grid-2">
        <div className="ri-stack" style={{ minWidth: 0 }}>
          <SectionTabs label="Opportunity sections" panelId="js-opportunity-panel" value={tab} onChange={(next) => go({ section: next })} items={SECTIONS.map((item) => ({ ...item, badge: item.id === 'correspondence' && data.correspondence.length ? data.correspondence.length : item.id === 'interviews' && data.interviews.length ? data.interviews.length : undefined }))} />
          <SectionPanel panelId="js-opportunity-panel" value={tab}>
            {tab === 'overview' && <Overview data={data} onAddDescription={onAddDescription} reload={detail.reload} go={go} />}
            {tab === 'posting' && <PostingTab data={data} onAddDescription={onAddDescription} />}
            {tab === 'correspondence' && <CorrespondenceTab data={data} />}
            {tab === 'materials' && <MaterialsTab data={data} onRecord={() => setDialog('record')} go={go} />}
            {tab === 'interviews' && <InterviewsTab data={data} go={go} onAdd={() => setDialog('interview')} onEdit={(interview) => setDialog({ interview })} />}
          </SectionPanel>
        </div>
        <aside className="js-panel" aria-labelledby="js-record-title">
          <span className="ri-eyebrow">Application record</span>
          <h3 id="js-record-title" className="js-panel__title">What you submitted</h3>
          {data.submissions.length === 0 ? (
            <div className="ri-stack ri-stack--tight">
              <p className="ri-small ri-muted">No application recorded yet.</p>
              <ButtonRow><Button size="sm" onClick={() => setDialog('record')}>Record application</Button></ButtonRow>
            </div>
          ) : data.submissions.slice(0, 2).map((submission) => (
            <div key={submission.id} className="ri-stack ri-stack--tight">
              {submission.materials.length ? submission.materials.map((material) => (
                <div key={material.versionId}>
                  <p className="ri-small"><strong>{material.shared ? `${material.title} v${material.number}` : material.title}</strong></p>
                  <p className="ri-small ri-muted">Submitted {shortDate(submission.appliedOn)} · Kept exactly as submitted</p>
                  {material.shared && material.familyId && <Button variant="link" size="sm" onClick={() => go({ tab: 'materials', materialId: material.familyId, opportunityId: null })}>Open submitted version</Button>}
                </div>
              )) : <p className="ri-small ri-muted">Applied {shortDate(submission.appliedOn)} via {CHANNEL_LABELS[submission.channel].toLowerCase()}, no materials recorded</p>}
              <p className="ri-small ri-muted">{submission.evidenceId ? 'Receipt email linked' : submission.confirmedByUser ? 'Confirmed by you' : ''}</p>
            </div>
          ))}
          <h3 className="js-panel__title">Recent correspondence</h3>
          {data.correspondence.length === 0 ? <p className="ri-small ri-muted">No correspondence linked yet.</p> : (
            <ul className="js-items">
              {data.correspondence.slice(0, 3).map((message) => (
                <li key={message.id} className="ri-small">
                  <span className="ri-muted">{shortDate(message.receivedAt)} · </span>{classificationText(message.classification)}
                  {message.unavailable && <span className="ri-muted"> · Source unavailable</span>}
                </li>
              ))}
            </ul>
          )}
          <AskRiButton variant="primary" prompt={preparePrompt}>Prepare with Ri</AskRiButton>
        </aside>
      </div>

      {dialog === 'details' && <DetailsDialog opportunity={record} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); detail.reload(); }} />}
      {dialog === 'record' && <RecordApplicationDialog opportunity={record} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); detail.reload(); }} />}
      {dialog === 'interview' && <InterviewDialog opportunityId={record.id} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); detail.reload(); }} />}
      {dialog && typeof dialog === 'object' && <InterviewDialog opportunityId={record.id} interview={dialog.interview} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); detail.reload(); }} />}
    </article>
  );
}

function Overview({ data, onAddDescription, reload, go }: { data: OpportunityDetail; onAddDescription: () => void; reload: () => void; go: Go }) {
  const record = data.opportunity;
  const app = useRiApp();
  const announce = useAnnounce();
  const tracking = useMutation<Record<string, unknown>, Write<OpportunityRecord>>('set_stage_tracking');
  const archive = useMutation<Record<string, unknown>, Write<OpportunityRecord>>('save_opportunity');
  const followUps = useQuery<{ items: FollowUpItem[] }>('list_follow_ups', { opportunityId: record.id });
  const finish = useMutation<Record<string, unknown>, unknown>('create_follow_up');
  const [error, setError] = useState<string | null>(null);
  const latest = data.postings.find((posting) => posting.latest);
  const visibleHistory = data.stageHistory.slice().reverse();
  const toggle = async (patch: Record<string, unknown>, done: string) => {
    setError(null);
    try {
      const result = await archive.run({ id: record.id, expectedRevision: record.revision, ...patch });
      archive.reset();
      if (result.status === 'conflict') setError('This opportunity changed. Try again.');
      else announce(done);
      reload();
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <div className="ri-stack ri-stack--loose">
      <section className="ri-stack" aria-labelledby="js-ov-role">
        <h3 id="js-ov-role" className="ri-h3">What the role asks for</h3>
        {data.requirements.length ? (
          <>
            <ul className="js-items">{data.requirements.slice(0, 6).map((requirement) => <li key={requirement.id}>{requirement.text}</li>)}</ul>
            {data.requirements.length > 6 && <p className="ri-small ri-muted">{data.requirements.length - 6} more under Posting</p>}
            {latest && <SourceLine label={`original job description${latest.fileName ? `, ${latest.fileName}` : ''}`} observedAt={latest.capturedAt} onOpen={() => go({ section: 'posting' })} openLabel="Open posting" />}
          </>
        ) : latest ? <p className="ri-muted">No requirement list was found in the saved description. Read it under Posting.</p> : (
          <Notice tone="info" title="Add the description to prepare with this role" action={<Button size="sm" variant="primary" onClick={onAddDescription}>Add description</Button>}>
            {record.sourceUrl ? 'Only the link is saved. It is not fetched, so paste the description or choose a file.' : 'Paste it or choose a file. It stays available even if the posting disappears.'}
          </Notice>
        )}
      </section>

      <section className="ri-stack" aria-labelledby="js-ov-facts">
        <h3 id="js-ov-facts" className="ri-h3">Details you recorded</h3>
        <KeyValueList items={[
          { label: 'Next action', value: record.nextAction ? `${record.nextAction}${record.nextActionDue ? ` by ${mediumDate(record.nextActionDue)}` : ''}` : 'None chosen' },
          ...(record.deadline ? [{ label: record.deadlineLabel ?? 'Deadline', value: mediumDate(record.deadline) }] : []),
          { label: 'Posting link', value: record.sourceUrl ? <Button variant="link" size="sm" onClick={() => void app.openExternal(record.sourceUrl!).catch((failure) => setError(errorText(failure)))}>{new URL(record.sourceUrl).hostname}</Button> : 'None' },
          ...(record.requisitionId ? [{ label: 'Requisition', value: record.requisitionId }] : []),
          ...record.compensation.map((item, index) => ({ key: `comp-${index}`, label: compensationLabel(item), value: <span>{formatCompensation(item)}{item.qualifiers.length ? <span className="ri-small ri-muted" style={{ display: 'block' }}>{item.qualifiers.join(', ')}. From {item.source === 'user' ? 'you' : item.source === 'offer' ? 'the offer' : 'the posting'}</span> : <span className="ri-small ri-muted" style={{ display: 'block' }}>From {item.source === 'user' ? 'you' : item.source === 'offer' ? 'the offer' : 'the posting'}</span>}</span> })),
        ]} />
        {record.compensation.length > 1 && new Set(record.compensation.map((item) => item.period)).size > 1 && <p className="ri-small ri-muted">These amounts are stated for different periods and are not converted.</p>}
        {record.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{record.notes}</p>}
      </section>

      <section className="ri-stack" aria-labelledby="js-ov-history">
        <div className="ri-section-heading">
          <h3 id="js-ov-history" className="ri-h3">Stage history</h3>
          <p>A stage is a summary of known progress, not the employer's internal status.</p>
        </div>
        <div className="js-panel js-panel--soft">
          <p className="ri-small">{record.stageLocked ? 'You set this stage. New email or calendar evidence that disagrees waits for your review instead of changing it.' : 'Email and calendar evidence can move this stage forward when the match is exact or strong. Weaker matches wait for you.'}</p>
          <ButtonRow>
            <Button size="sm" busy={tracking.pending} onClick={async () => { try { await tracking.run({ id: record.id, expectedRevision: record.revision, automatic: record.stageLocked }); tracking.reset(); announce(record.stageLocked ? 'Email and calendar can update this stage again' : 'Your stage is kept'); reload(); } catch (failure) { setError(errorText(failure)); } }}>
              {record.stageLocked ? 'Let email and calendar update this stage' : 'Keep the current stage'}
            </Button>
          </ButtonRow>
        </div>
        <ol className="js-history">
          {visibleHistory.map((event) => (
            <li key={event.id} className="js-history__row">
              <span><strong>{event.toStage === 'saved' && !event.fromStage ? 'Saved' : stageText(event.toStage, event.toOutcome)}</strong> <span className="ri-muted">· {shortDate(event.occurredAt)}</span></span>
              <span className="ri-small ri-muted">{DECISION_TEXT[event.decision]} · {authorText(event.author)}{event.author === 'automatic' ? `, ${CONFIDENCE_TEXT[event.confidence]}` : ''}{event.note ? ` · ${event.note}` : ''}</span>
              {event.evidence?.kind === 'correspondence' && <span><Button variant="link" size="sm" onClick={() => go({ section: 'correspondence' })}>See the email</Button></span>}
              {event.evidence?.kind === 'interview' && <span><Button variant="link" size="sm" onClick={() => go({ section: 'interviews' })}>See the interview</Button></span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="ri-stack" aria-labelledby="js-ov-followups">
        <h3 id="js-ov-followups" className="ri-h3">Ri follow-ups</h3>
        {!followUps.data ? <p className="ri-small ri-muted">Checking linked tasks</p> : followUps.data.items.length === 0 ? <p className="ri-small ri-muted">No follow-ups yet. Create one to get a linked task in Ri.</p> : (
          <ul className="js-items">
            {followUps.data.items.map(({ followUp, task }) => (
              <li key={followUp.id} className="ri-small">
                <strong>{followUp.title}</strong>
                <span className="ri-muted"> · {followUp.dueAt ? `Due ${shortDate(followUp.dueAt)}` : 'No due date'} · </span>
                {followUp.state === 'pending' ? 'Not created in Ri yet' : followUp.state === 'failed' ? (followUp.lastError ?? 'Not created') : task ? (task.available ? `Ri task ${task.status === 'done' ? 'done' : 'open'}` : task.reason) : 'Ri task linked'}
                {followUp.state !== 'created' && (
                  <> <Button variant="link" size="sm" busy={finish.pending} onClick={async () => {
                    setError(null);
                    try {
                      // The same operation ID always resolves to the same Ri task.
                      await finish.run({ subject: followUp.interviewId ? { type: 'interview', id: followUp.interviewId } : { type: 'opportunity', id: record.id }, title: followUp.title, ...(followUp.dueAt ? { dueAt: followUp.dueAt } : {}), operationId: followUp.operationId });
                      finish.reset();
                      announce('Task created in Ri');
                      followUps.reload();
                    } catch (failure) {
                      setError(errorText(failure));
                    }
                  }}>Create it in Ri</Button></>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ButtonRow>
        <Button size="sm" busy={archive.pending} onClick={() => void toggle({ listingClosed: !record.listingClosedAt }, record.listingClosedAt ? 'Listing marked open' : 'Listing marked closed')}>{record.listingClosedAt ? 'Listing is open again' : 'Mark listing closed'}</Button>
        <Button size="sm" busy={archive.pending} onClick={() => void toggle({ archived: !record.archivedAt }, record.archivedAt ? 'Restored from archive' : 'Archived. Nothing was erased')}>{record.archivedAt ? 'Restore from archive' : 'Archive'}</Button>
      </ButtonRow>
      <InlineError>{error}</InlineError>
      {error && /Sources/.test(error) && <ButtonRow><Button size="sm" onClick={() => void app.openSources()}>Open Sources</Button></ButtonRow>}
    </div>
  );
}

function PostingTab({ data, onAddDescription }: { data: OpportunityDetail; onAddDescription: () => void }) {
  const [selected, setSelected] = useState<string | null>(data.postings.find((posting) => posting.latest)?.id ?? null);
  const query = useQuery<PostingDetail>('get_posting', { id: selected ?? '' }, { enabled: Boolean(selected) });
  const posting = { ...query, data: query.data?.id === selected ? query.data : undefined };
  if (!data.postings.length)
    return (
      <EmptyState compact headingLevel={3} title="Add the description to prepare with this role" action={<Button variant="primary" onClick={onAddDescription}>Add description</Button>}>
        <p>{data.opportunity.sourceUrl ? 'Only the link is saved. Links are kept as written and not fetched.' : 'Paste the description or choose a file. It is kept exactly as captured.'}</p>
      </EmptyState>
    );
  return (
    <div className="ri-stack">
      <div className="ri-section-heading">
        <h3 className="ri-h3">Saved descriptions</h3>
        <Button size="sm" onClick={onAddDescription}>Add a newer description</Button>
      </div>
      <div className="js-versions" role="list">
        {data.postings.map((item) => (
          <div role="listitem" key={item.id}>
            <button type="button" className="js-version" aria-current={item.id === selected || undefined} onClick={() => setSelected(item.id)}>
              <span className="js-version__head">
                <strong>Captured {mediumDate(item.capturedAt)}</strong>
                {item.latest && <span className="js-tag js-tag--strong">Latest</span>}
                {item.usedByPreparations > 0 && <span className="js-tag">Used for preparation</span>}
              </span>
              <span className="ri-small ri-muted">{item.origin === 'file' ? `From ${item.fileName ?? 'a file'}` : 'Pasted'} · {item.characters.toLocaleString('en-US')} characters · Digest {item.contentDigest.slice(0, 10)}{item.truncated ? ' · Only the first part was read' : ''}</span>
            </button>
          </div>
        ))}
      </div>
      {posting.error && <InlineError>{posting.error}</InlineError>}
      {posting.data && (
        <div className="ri-stack">
          {!posting.data.textAvailable ? <Notice tone="warning" title="This snapshot's text is unavailable">Its record and digest are kept.</Notice> : <pre className="js-doc" tabIndex={0} aria-label="Posting text as captured">{posting.data.text}</pre>}
          {posting.data.extracted.compensation.length > 0 && (
            <div className="ri-stack ri-stack--tight">
              <h4 className="ri-h3">Pay as stated in this snapshot</h4>
              {posting.data.extracted.compensation.map((item) => <blockquote key={item.id} className="js-quote">{item.passage}</blockquote>)}
            </div>
          )}
          <SourceLine label={posting.data.sourceUrl ? 'posting link, captured as text' : 'pasted description'} observedAt={posting.data.capturedAt} />
        </div>
      )}
    </div>
  );
}

function CorrespondenceTab({ data }: { data: OpportunityDetail }) {
  const app = useRiApp();
  const [reading, setReading] = useState<string | null>(null);
  const query = useQuery<CorrespondenceDetail>('get_correspondence', { id: reading ?? '' }, { enabled: Boolean(reading) });
  const message = { ...query, data: query.data?.message.id === reading ? query.data : undefined };
  if (!data.correspondence.length)
    return (
      <EmptyState compact headingLevel={3} title="No correspondence linked" action={<Button onClick={() => void app.openSources()}>Connect email</Button>}>
        <p>When email is connected, application, interview and offer messages for this role are linked here with the reason for each match.</p>
      </EmptyState>
    );
  const latestThread = data.correspondence.find((item) => !item.sent && !item.unavailable);
  return (
    <div className="ri-stack">
      {latestThread && (
        <ButtonRow>
          <AskRiButton prompt={`Help me follow up on my ${data.opportunity.role} application at ${data.opportunity.company}. Write a reply to ${latestThread.from?.name ?? latestThread.from?.email ?? 'the sender'} (${latestThread.from?.email ?? 'address unknown'}) in the thread "${latestThread.subject}". Draft editable text only and do not send it.`}>Help me follow up</AskRiButton>
        </ButtonRow>
      )}
      <Timeline
        label="Correspondence"
        items={data.correspondence.map((item) => ({
          id: item.id,
          date: dayOf(item.receivedAt),
          title: item.subject || 'No subject',
          meta: `${item.sent ? `You to ${item.to[0]?.name ?? item.to[0]?.email ?? 'recipient'}` : `From ${item.from?.name ?? item.from?.email ?? 'unknown sender'}`} · ${classificationText(item.classification)}${item.aiLabel ? ` · ${item.aiLabel}` : ''}`,
          body: <span className="ri-small ri-muted">Matched because: {item.matchBasis.map((entry) => entry.detail).join('. ') || 'you chose this role'}</span>,
          excerpt: item.unavailable ? undefined : item.evidence,
          tone: item.unavailable ? 'warning' : 'neutral',
          actions: item.unavailable ? <span className="ri-small ri-muted">Source unavailable. It was deleted or moved at the source</span> : <Button variant="link" size="sm" onClick={() => setReading(item.id)}>Read email</Button>,
        }))}
      />
      {reading && (
        <Dialog open wide title={message.data?.message.subject || 'Email'} onClose={() => setReading(null)} footer={<Button onClick={() => setReading(null)}>Close</Button>}>
          {message.error ? <InlineError>{message.error}</InlineError> : !message.data ? <p className="ri-muted">Loading email</p> : (
            <div className="ri-stack">
              <p className="ri-small ri-muted">{message.data.message.sent ? 'You sent this' : `From ${message.data.message.from?.name ?? ''} ${message.data.message.from?.email ?? ''}`} · {mediumDate(message.data.message.receivedAt)} · {classificationText(message.data.message.classification)}</p>
              {message.data.passage && <blockquote className="js-quote">{message.data.passage}</blockquote>}
              {message.data.body ? <pre className="js-doc" tabIndex={0}>{message.data.body}</pre> : <Notice tone="info">The text of this email is not available. It may have been removed at the source.</Notice>}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function MaterialsTab({ data, onRecord, go }: { data: OpportunityDetail; onRecord: () => void; go: Go }) {
  if (!data.submissions.length)
    return (
      <EmptyState compact headingLevel={3} title="No application recorded" action={<Button variant="primary" onClick={onRecord}>Record application</Button>}>
        <p>Record the date you applied and the exact résumé and cover letter versions you used. Later edits never change what you submitted.</p>
      </EmptyState>
    );
  return (
    <div className="ri-stack">
      {data.submissions.map((submission) => (
        <div key={submission.id} className="js-panel">
          <p className="js-panel__title">Applied {mediumDate(submission.appliedOn)} via {CHANNEL_LABELS[submission.channel].toLowerCase()}</p>
          {submission.materials.length ? (
            <ul className="js-items">
              {submission.materials.map((material) => (
                <li key={material.versionId} className="js-item">
                  <span>{material.shared ? <><strong>{material.title} v{material.number}</strong> <span className="ri-muted">{material.kind ? MATERIAL_LABELS[material.kind] : ''}</span></> : material.title}</span>
                  {material.shared && material.familyId && <Button variant="link" size="sm" onClick={() => go({ tab: 'materials', materialId: material.familyId, opportunityId: null })}>Open</Button>}
                </li>
              ))}
            </ul>
          ) : <p className="ri-small ri-muted">No materials recorded with this application.</p>}
          <p className="ri-small ri-muted">{submission.evidenceId ? 'Receipt email linked.' : 'Confirmed by you.'}{submission.note ? ` ${submission.note}` : ''}</p>
        </div>
      ))}
      <ButtonRow><Button onClick={onRecord}>Record another submission</Button></ButtonRow>
    </div>
  );
}

function InterviewsTab({ data, go, onAdd, onEdit }: { data: OpportunityDetail; go: Go; onAdd: () => void; onEdit: (interview: Interview) => void }) {
  if (!data.interviews.length)
    return (
      <EmptyState compact headingLevel={3} title="No interviews yet" action={<Button variant="primary" onClick={onAdd}>Add an interview</Button>}>
        <p>Interviews from a connected calendar or a confirmation email appear here. An invitation to choose times shows as scheduling needed until a time is confirmed.</p>
      </EmptyState>
    );
  return (
    <div className="ri-stack">
      <ButtonRow><Button onClick={onAdd}>Add an interview</Button></ButtonRow>
      {data.interviews.slice().reverse().map((interview) => (
        <article key={interview.id} className="js-panel" aria-labelledby={`js-int-${interview.id}`}>
          <div className="ri-section-heading">
            <h3 id={`js-int-${interview.id}`} className="ri-h3">{interview.title}</h3>
            <StatusLabel tone={interview.status === 'scheduling_needed' ? 'warning' : interview.status === 'canceled' ? 'neutral' : 'neutral'}>{interviewStatusText(interview)}</StatusLabel>
          </div>
          <KeyValueList items={[
            { label: 'When', value: interview.status === 'scheduling_needed' ? 'Not scheduled yet' : whenText(interview.startAt, interview.zone) },
            ...(interview.zone ? [{ label: 'Time zone', value: interview.zone.replace(/_/g, ' ') }] : []),
            { label: 'Format', value: FORMAT_TEXT[interview.format] },
            ...(interview.participants.filter((person) => person.role !== 'self').length ? [{ label: 'With', value: interview.participants.filter((person) => person.role !== 'self').map((person) => `${person.name ?? person.email}${person.role === 'organizer' ? ', organizer' : ''}`).join('; ') }] : []),
            ...(interview.meetingLink ? [{ label: 'Meeting link', value: new URL(interview.meetingLink).hostname }] : []),
            { label: 'Source', value: interview.origin === 'calendar' ? 'Calendar' : interview.origin === 'mail' ? 'Email' : 'Added by you' },
          ]} />
          {interview.corrected.length > 0 && <p className="ri-small ri-muted">You corrected {interview.corrected.join(', ')}. Later syncs keep your correction.</p>}
          {interview.notes && <p className="ri-small" style={{ whiteSpace: 'pre-wrap' }}>{interview.notes}</p>}
          <details>
            <summary className="ri-small">History ({interview.history.length})</summary>
            <ol className="js-history" style={{ marginTop: '0.5rem' }}>
              {interview.history.slice().reverse().map((event) => <li key={event.id} className="js-history__row"><span>{event.summary}</span><span className="ri-small ri-muted">{mediumDate(event.occurredAt)} · {authorText(event.author)}</span></li>)}
            </ol>
          </details>
          <ButtonRow>
            {interview.status !== 'canceled' && <Button variant="primary" size="sm" onClick={() => go({ prepare: { opportunityId: data.opportunity.id, interviewId: interview.id } })}>{interview.preparationId ? 'Open preparation' : 'Prepare'}</Button>}
            <Button size="sm" onClick={() => onEdit(interview)}>Edit</Button>
          </ButtonRow>
        </article>
      ))}
    </div>
  );
}
