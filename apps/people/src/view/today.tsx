import { useEffect, useState } from 'react';
import { Button, ButtonRow, EmptyState, SegmentedControl, SplitView, StatusLabel, useAppLayout, useQuery, useRiApp } from '@ri/app-kit/ui';
import type { Commitment, Coverage, Fact, TaskLink } from '../schemas.js';
import { dateLabel, dayLabel, meetingLabel } from './format.js';
import { CommitmentRow, FactRow, PersonWorkspace } from './person.js';
import { CoverageFooter, Failure, Loading, TaskStatus, usePeople } from './shared.js';

type FollowItem = { kind: 'commitment'; commitment: Commitment } | { kind: 'task'; task: TaskLink; subject: { kind: string; id: string; name: string } | null };
interface Today {
  meetings: { id: string; at: string; title: string; people: { id: string; name: string }[]; declined: boolean }[];
  iOwe: FollowItem[]; waitingOn: FollowItem[];
  keepInTouch: { id: string; name: string; lastExchangeAt: string | null; intervalDays: number }[];
  review: { suggestions: FollowItem[]; suggestionCount: number; facts: Fact[]; factCount: number; identities: { id: string; summary: string }[]; identityCount: number };
  focusPersonId: string | null; empty: boolean; coverage: Coverage; revision: string;
}
const personOf = (item: FollowItem) => item.kind === 'commitment' ? item.commitment.person : item.subject?.kind === 'person' ? { id: item.subject.id, name: item.subject.name } : null;

export function TodayView() {
  const ui = usePeople();
  const layout = useAppLayout();
  const today = useQuery<Today>('get_today', {});
  const selected = ui.route.record?.kind === 'person' ? ui.route.record.id : null;
  // At wide widths the most relevant person opens beside the list. Narrow frames keep the list first.
  const focus = selected ?? (layout === 'wide' ? today.data?.focusPersonId ?? null : null);
  if (today.error && !today.data) return <Failure error={today.error} reload={today.reload} />;
  if (!today.data) return <Loading label="Loading today" />;
  const data = today.data;
  if (ui.data.owner && ui.data.setup.people === 0 && !selected) return <Welcome coverage={data.coverage} />;
  if (data.empty && !data.review.suggestionCount && !data.review.factCount && !selected) return (
    <div className="pe-stack">
      <EmptyState title="Nothing needs your attention" action={<Button variant="primary" onClick={() => ui.go({ section: 'people', record: null, query: {} })}>Open your people</Button>}>
        No meetings this week, chosen follow-ups or things you are waiting on. People never invents urgent work.
      </EmptyState>
      <CoverageFooter coverage={data.coverage} />
    </div>
  );
  const item = (key: string, id: string | null | undefined, top: string, name: string, bottom: string, extra?: React.ReactNode) => id ? (
    <li key={key}>
      <button type="button" className="pe-today-item" aria-current={focus === id ? 'true' : undefined} onClick={() => ui.openPerson(id)}>
        <span className="pe-small">{top}</span>
        <strong>{name}</strong>
        <span className="pe-small">{bottom}</span>
        {extra}
      </button>
    </li>
  ) : null;
  const list = (
    <nav className="pe-today-list" aria-label="Today">
      <section className="pe-today-group">
        <h2>Coming up</h2>
        {data.meetings.length ? <ul>{data.meetings.flatMap((meeting) => meeting.people.slice(0, 1).map((person) => item(meeting.id, person.id, meetingLabel(meeting.at), meeting.people.length > 1 ? `${person.name} and ${meeting.people.length - 1} more` : person.name, meeting.title, meeting.declined ? <span className="pe-small">You declined</span> : undefined)))}</ul>
          : <p className="pe-today-empty">No meetings in the next seven days.</p>}
      </section>
      <section className="pe-today-group">
        <h2>Next action</h2>
        {data.iOwe.length ? <ul>{data.iOwe.map((entry) => {
          const who = personOf(entry);
          const label = entry.kind === 'commitment' ? entry.commitment.action : entry.task.title;
          const due = entry.kind === 'commitment' ? entry.commitment.dueDate : entry.task.dueAt?.slice(0, 10) ?? null;
          return who ? item(entry.kind === 'commitment' ? entry.commitment.id : entry.task.id, who.id, due ? `Chosen for ${dateLabel(due)}` : 'Chosen follow-up', who.name, label, entry.kind === 'task' && entry.task.status !== 'linked' ? <TaskStatus link={entry.task} /> : undefined)
            : <li key={entry.kind === 'task' ? entry.task.id : entry.commitment.id} className="pe-today-item"><span className="pe-small">Chosen follow-up</span><strong>{label}</strong></li>;
        })}</ul> : <p className="pe-today-empty">No follow-ups chosen.</p>}
      </section>
      {data.waitingOn.length > 0 && (
        <section className="pe-today-group">
          <h2>Waiting on</h2>
          <ul>{data.waitingOn.map((entry) => { const who = personOf(entry); return item(entry.kind === 'commitment' ? entry.commitment.id : entry.task.id, who?.id, entry.kind === 'commitment' && entry.commitment.occurredAt ? `Offered ${dayLabel(entry.commitment.occurredAt)}` : 'Waiting on', who?.name ?? 'Someone', entry.kind === 'commitment' ? entry.commitment.action : entry.task.title); })}</ul>
        </section>
      )}
      {data.keepInTouch.length > 0 && (
        <section className="pe-today-group">
          <h2>Keep in touch</h2>
          <ul>{data.keepInTouch.map((person) => item(`k-${person.id}`, person.id, person.lastExchangeAt ? `Last exchange ${dayLabel(person.lastExchangeAt)}` : 'No exchange found', person.name, `Every ${person.intervalDays} days`))}</ul>
        </section>
      )}
      {(data.review.suggestionCount > 0 || data.review.factCount > 0 || data.review.identityCount > 0) && (
        <section className="pe-today-group">
          <h2>To review</h2>
          <p className="pe-small pe-muted">{[data.review.suggestionCount ? `${data.review.suggestionCount} suggested commitment${data.review.suggestionCount === 1 ? '' : 's'}` : null, data.review.factCount ? `${data.review.factCount} sourced detail${data.review.factCount === 1 ? '' : 's'}` : null, data.review.identityCount ? `${data.review.identityCount} identity review${data.review.identityCount === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')}. Suggestions stay separate until you accept them.</p>
          <ButtonRow>
            {data.review.suggestionCount > 0 && <Button size="sm" onClick={() => ui.go({ section: 'follow-ups', record: null, query: { filter: 'suggestions' } })}>Review suggestions</Button>}
            {data.review.identityCount > 0 && ui.data.owner && <Button size="sm" variant="quiet" onClick={() => ui.go({ section: 'sources', record: null, query: { panel: 'review' } })}>Review identities</Button>}
          </ButtonRow>
        </section>
      )}
      <p className="pe-small pe-muted">A little context. A clear next step.</p>
    </nav>
  );
  return (
    <SplitView
      className="pe-today"
      list={list}
      detailOpen={!!focus}
      onBack={() => ui.go({ record: null })}
      backLabel="Back to today"
      detailLabel="Selected person"
      minSplitWidth={900}
      detail={focus ? <PersonWorkspace id={focus} /> : null}
      emptyDetail={<EmptyState compact headingLevel={3} title="Choose someone">Select a meeting or follow-up to see the briefing, timeline and notes.</EmptyState>}
    />
  );
}

/**
 * The first open: three equal ways in, none of them a setup decision. Once
 * accounts are granted, people appear as each page is read, so this screen
 * gives way on its own.
 */
function Welcome({ coverage }: { coverage: Coverage }) {
  const ui = usePeople();
  const app = useRiApp();
  const reading = ui.data.setup.grantedAccounts > 0;
  return (
    <div className="pe-stack pe-stack--loose">
      <p className="pe-lead">Start with any one of these. Nothing needs to be organized first.</p>
      <ul className="pe-welcome" aria-label="Ways to start">
        <li>
          <h2 className="ri-h3">Connect email and calendar</h2>
          <p>Choose the exact accounts and calendars in Ri. People reads the last 90 days by default (30 or 365 if you prefer), keeps what it reads on this computer and never sends anything.</p>
          {reading
            ? <p className="pe-small pe-muted">{ui.data.setup.grantedAccounts === 1 ? 'One account is' : `${ui.data.setup.grantedAccounts} accounts are`} being read. People appear as each page arrives.</p>
            : <Button variant="primary" onClick={() => void app.openSources()}>Connect email and calendar</Button>}
        </li>
        <li>
          <h2 className="ri-h3">Import contacts</h2>
          <p>A CSV, vCard or LinkedIn connections export. You see a preview before anything is added.</p>
          <Button onClick={() => ui.go({ section: 'sources', record: null, query: { panel: 'import' } })}>Import contacts</Button>
        </li>
        <li>
          <h2 className="ri-h3">Add a person</h2>
          <p>A name is enough. Add an address, company or note whenever it helps.</p>
          <Button onClick={() => ui.go({ section: 'today', record: null, query: { create: 'person' } })}>Add a person</Button>
        </li>
      </ul>
      <CoverageFooter coverage={coverage} />
    </div>
  );
}

export function FollowUpsView() {
  const ui = usePeople();
  const filter = (ui.route.query.filter as 'i_owe' | 'waiting_on' | 'suggestions' | 'completed') ?? 'i_owe';
  const [pages, setPages] = useState<string[]>([]);
  const list = useQuery<{ items: FollowItem[]; nextCursor: string | null; coverage: Coverage }>('list_commitments', { filter, limit: 50 });
  const more = useQuery<{ items: FollowItem[]; nextCursor: string | null; coverage: Coverage }>('list_commitments', { filter, limit: 100, cursor: pages.at(-1) ?? '' }, { enabled: pages.length > 0 });
  const [extra, setExtra] = useState<FollowItem[]>([]);
  const tasks = (list.data?.items ?? []).flatMap((item) => item.kind === 'task' && item.task.taskId ? [item.task.id] : item.kind === 'commitment' && item.commitment.taskLink?.taskId ? [item.commitment.taskLink.id] : []);
  const checked = useQuery<{ items: TaskLink[] }>('check_follow_ups', { ids: tasks.slice(0, 50) }, { enabled: tasks.length > 0 && ui.data.canWrite });
  void checked;
  useEffect(() => { setPages([]); setExtra([]); }, [filter]);
  useEffect(() => { if (more.data && pages.length) setExtra((current) => [...current, ...more.data!.items]); }, [more.data]);
  const items = [...(list.data?.items ?? []), ...extra];
  const next = pages.length ? more.data?.nextCursor ?? null : list.data?.nextCursor ?? null;
  const emptyText = { i_owe: 'No accepted commitments or chosen Ri follow-ups.', waiting_on: 'Nothing you are waiting on is recorded.', suggestions: 'No suggestions to review.', completed: 'Nothing completed or dismissed yet.' }[filter];
  return (
    <div className="pe-stack pe-stack--loose">
      <SegmentedControl label="Follow-up type" value={filter} onChange={(value) => ui.setQuery({ filter: value === 'i_owe' ? null : value })} options={[{ id: 'i_owe', label: 'I owe' }, { id: 'waiting_on', label: 'Waiting on' }, { id: 'suggestions', label: 'Suggestions' }, { id: 'completed', label: 'Resolved' }]} />
      {filter === 'suggestions' && <p className="pe-small pe-muted">Suggestions come from bounded extraction of your conversations. Each names its evidence, and none becomes a commitment or task until you choose.</p>}
      {list.error && !list.data ? <Failure error={list.error} reload={list.reload} /> : !list.data ? <Loading label="Loading follow-ups" /> : items.length === 0 ? (
        <EmptyState compact title={emptyText}>
          {list.data.coverage.partial ? <>Coverage is partial: {list.data.coverage.summary} Missing evidence is not proof that nothing is owed.</> : filter === 'waiting_on' ? 'No confirming message found in the indexed history either way.' : null}
        </EmptyState>
      ) : (
        <ul className="pe-stack" aria-label="Follow-ups">
          {items.map((entry) => (
            <li key={entry.kind === 'commitment' ? entry.commitment.id : entry.task.id} className="pe-follow">
              {entry.kind === 'commitment' ? (
                <>
                  <div className="pe-follow__head">
                    <span className="pe-small pe-muted">{entry.commitment.person ? <button type="button" className="pe-link" onClick={() => ui.openPerson(entry.commitment.person!.id)}>{entry.commitment.person.name}</button> : entry.commitment.organization?.name}{entry.commitment.organization && entry.commitment.person ? ` · ${entry.commitment.organization.name}` : ''}</span>
                    {entry.commitment.state === 'withdrawn' || entry.commitment.state === 'completed' || entry.commitment.state === 'dismissed' ? <StatusLabel tone={entry.commitment.state === 'completed' ? 'success' : 'neutral'}>{entry.commitment.state === 'completed' ? 'Completed' : entry.commitment.state === 'dismissed' ? 'Dismissed' : 'Withdrawn'}</StatusLabel> : null}
                  </div>
                  <CommitmentRow commitment={entry.commitment} reload={list.reload} />
                  {entry.commitment.resolution && <p className="pe-small pe-muted">{entry.commitment.resolution}</p>}
                </>
              ) : (
                <>
                  <div className="pe-follow__head"><span className="pe-section-label">Chosen follow-up</span><TaskStatus link={entry.task} /></div>
                  <p className="pe-follow__title">{entry.task.title}</p>
                  <p className="pe-small pe-muted">{entry.subject ? <button type="button" className="pe-link" onClick={() => entry.subject!.kind === 'person' ? ui.openPerson(entry.subject!.id) : entry.subject!.kind === 'organization' ? ui.openCompany(entry.subject!.id) : ui.openOpportunity(entry.subject!.id)}>{entry.subject.name}</button> : 'Record no longer available'}{entry.task.dueAt ? ` · Due ${dateLabel(entry.task.dueAt.slice(0, 10))}` : ''}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {next && <Button onClick={() => setPages((current) => [...current, next])} busy={more.loading}>Show more</Button>}
      <CoverageFooter coverage={list.data?.coverage} />
    </div>
  );
}
export { FactRow };
