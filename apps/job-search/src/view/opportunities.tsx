/** @jsxRuntime automatic */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AskRiButton, Button, ButtonRow, Checkbox, ChevronLeftIcon, DataTable, EmptyState, ErrorState, FilterChips, Inspector, KeyValueList, LoadingState, Notice, SearchField,
  SegmentedControl, SplitView, StatusLabel, Toolbar, useAnnounce, useAppLayout, useElementWidth, useMutation, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import { BOARD_STAGES, OUTCOME_LABELS, STAGE_LABELS, type Outcome, type Stage } from '../domain/labels.js';
import type { Location } from './app.js';
import type { OpportunityList, OpportunityRecord, OpportunitySummary, Write } from './types.js';
import { CompareDialog, StageMenu } from './dialogs.js';
import { errorText, locationText, nextText, shortDate, stageText, whenText } from './format.js';

interface Props {
  location: Location;
  go: (patch: Partial<Location> | ((current: Location) => Partial<Location>)) => void;
  onSaveJob: () => void;
  workspace: ReactNode;
}

export function OpportunitiesView({ location, go, onSaveJob, workspace }: Props) {
  const app = useRiApp();
  const layout = useAppLayout();
  const frame = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frame);
  const [compare, setCompare] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [pages, setPages] = useState(1);
  const input = { limit: Math.min(100, 50 * pages), view: location.view, ...(location.search.trim() ? { search: location.search.trim() } : {}), ...(location.mode === 'table' && location.stage ? { stage: location.stage } : {}) };
  const list = useQuery<OpportunityList>('list_opportunities', input);
  const items = list.data?.items ?? [];
  const split = layout === 'wide' && (width === null || width >= 1100);
  const selected = items.find((item) => item.id === location.selected) ?? null;

  useEffect(() => {
    const chosen = compare.length ? compare : location.selected ? [location.selected] : [];
    app.context({
      section: workspace ? 'opportunity' : 'opportunities',
      selected: chosen.slice(0, 50).map((id) => ({ type: 'opportunity', id })),
      filters: { ...(location.search ? { search: location.search.slice(0, 200) } : {}), ...(location.stage ? { stage: location.stage } : {}), view: location.view, mode: location.mode },
      revisions: Object.fromEntries(items.filter((item) => chosen.includes(item.id)).map((item) => [item.id, item.revision])),
    });
  }, [app, compare, location.selected, location.search, location.stage, location.view, location.mode, items, workspace]);

  const select = (id: string) => go(split ? { selected: id } : { selected: id, opportunityId: id, section: null });
  const upcoming = items.filter((item) => item.next?.kind === 'interview' && item.next.startAt).sort((a, b) => String((a.next as { startAt: string }).startAt).localeCompare(String((b.next as { startAt: string }).startAt)))[0];

  const listContent = (
    <div className="ri-stack">
      {upcoming && upcoming.next?.kind === 'interview' && location.view === 'active' && (
        <div className="js-strip">
          <div className="js-strip__text">
            <span className="ri-eyebrow">Up next · {whenText(upcoming.next.startAt, upcoming.next.zone, { relative: true, viewer: false })}</span>
            <h2 className="js-strip__title">{upcoming.company} · {upcoming.next.title}</h2>
            <p className="js-strip__meta">{upcoming.role} · {upcoming.hasPosting ? 'Description saved' : 'No description saved yet'}{upcoming.lastActivity ? ` · ${upcoming.lastActivity.label}` : ''}</p>
          </div>
          <Button variant="primary" onClick={() => go({ prepare: { opportunityId: upcoming.id, interviewId: upcoming.next?.kind === 'interview' ? upcoming.next.interviewId : null } })}>Open preparation</Button>
        </div>
      )}
      <Toolbar end={<SearchField label="Find an opportunity" placeholder="Company or role" value={location.search} onChange={(search) => go({ search })} />}>
        <SegmentedControl label="Opportunity view" value={location.mode} onChange={(mode) => go({ mode: mode as 'board' | 'table' })} options={[{ id: 'board', label: 'Board' }, { id: 'table', label: 'Table' }]} />
        <SegmentedControl label="Which opportunities" value={location.view} onChange={(view) => go({ view: view as Location['view'], stage: null })} options={[
          { id: 'active', label: 'Active' },
          { id: 'closed', label: `Closed${list.data ? ` ${list.data.counts.closed}` : ''}` },
          { id: 'archived', label: `Archived${list.data ? ` ${list.data.counts.archived}` : ''}` },
        ]} />
      </Toolbar>
      {location.mode === 'table' && location.view === 'active' && (
        <FilterChips label="Filter by stage" value={location.stage ? [location.stage] : []} onChange={(next) => go({ stage: (next.at(-1) as Stage | undefined) ?? null })}
          items={BOARD_STAGES.map((stage) => ({ id: stage, label: STAGE_LABELS[stage], count: list.data?.counts[stage] }))} />
      )}
      {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
        : !list.data ? <LoadingState label="Loading opportunities" rows={4} />
          : items.length === 0 ? <EmptyList location={location} onSaveJob={onSaveJob} onClear={() => go({ search: '', stage: null, view: 'active' })} />
            : location.mode === 'board'
              ? <Board items={items} view={location.view} selectedId={location.selected} onSelect={select} onMoved={list.reload} />
              : <Table items={items} selectedId={location.selected} onSelect={select} compare={compare} onCompare={setCompare} />}
      {list.data?.nextCursor && pages < 2 && <Button onClick={() => setPages((value) => value + 1)}>Show more</Button>}
      {list.data?.nextCursor && pages >= 2 && <p className="ri-small ri-muted">Showing the first 100. Search to narrow the list.</p>}
      {compare.length > 0 && (
        <div className="js-strip" role="region" aria-label="Roles chosen to compare">
          <div className="js-strip__text">
            <span className="ri-eyebrow">{compare.length} chosen to compare</span>
            <p className="ri-small ri-muted">{items.filter((item) => compare.includes(item.id)).map((item) => `${item.company} · ${item.role}`).join(', ')}</p>
          </div>
          <ButtonRow>
            <Button variant="quiet" onClick={() => setCompare([])}>Clear</Button>
            <Button variant="primary" disabled={compare.length < 2} onClick={() => setComparing(true)}>Compare roles</Button>
          </ButtonRow>
        </div>
      )}
      {list.data?.coverage.partial && list.data.coverage.sources.some((source) => source.kind !== 'collection' && source.partial) && (
        <p className="ri-small ri-muted">Email or calendar coverage is still partial, so some recent activity may not show yet.</p>
      )}
    </div>
  );

  return (
    <div ref={frame} className="ri-stack">
      <div hidden={Boolean(workspace)}>
        <SplitView
          list={listContent}
          detailOpen={split && Boolean(selected)}
          onBack={() => go({ selected: null })}
          backLabel="Back to opportunities"
          detailLabel={selected ? `${selected.company}, ${selected.role}` : undefined}
          minSplitWidth={1100}
          detail={selected && <OpportunityInspector item={selected} go={go} onChanged={list.reload} />}
        />
      </div>
      {workspace && (
        <section aria-label="Opportunity" className="ri-stack">
          <div><Button variant="quiet" className="ri-split__back" onClick={() => go({ opportunityId: null, section: null })}><ChevronLeftIcon />Back to opportunities</Button></div>
          {workspace}
        </section>
      )}
      {comparing && <CompareDialog ids={compare} onClose={() => setComparing(false)} />}
    </div>
  );
}

function EmptyList({ location, onSaveJob, onClear }: { location: Location; onSaveJob: () => void; onClear: () => void }) {
  if (location.search || location.stage) return <EmptyState compact title="No opportunities match" action={<Button onClick={onClear}>Clear search and filters</Button>}><p>Search looks at company and role names.</p></EmptyState>;
  if (location.view === 'closed') return <EmptyState compact title="Nothing closed yet"><p>Opportunities you close as rejected, withdrawn or accepted appear here with their history.</p></EmptyState>;
  if (location.view === 'archived') return <EmptyState compact title="Nothing archived"><p>Archive a finished search to keep its records out of the way without erasing them.</p></EmptyState>;
  return <EmptyState compact title="No active opportunities" action={<Button variant="primary" onClick={onSaveJob}>Save a job</Button>}><p>Save a job with its description to start.</p></EmptyState>;
}

// ─── Board ───────────────────────────────────────────────────────────────────

function Card({ item, selected, onSelect, draggable, onDragStart }: { item: OpportunitySummary; selected: boolean; onSelect: (id: string) => void; draggable?: boolean; onDragStart?: (event: DragEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" className="js-card" aria-current={selected || undefined} onClick={() => onSelect(item.id)} draggable={draggable} onDragStart={onDragStart}
      aria-label={`${item.company}, ${item.role}, ${stageText(item.stage, item.outcome)}. ${nextText(item.next)}`}>
      <span className="js-card__company"><span className="js-mark" aria-hidden="true">{item.company.trim()[0]?.toUpperCase() ?? '?'}</span><span>{item.company}</span></span>
      <span className="js-card__role">{item.role}</span>
      <span className="js-card__place">{locationText(item)}</span>
      <span className="js-card__next">
        <span>{nextText(item.next)}</span>
        {item.note && <span className="js-card__note">{item.note}</span>}
        {item.lastActivity && item.lastActivity.label !== item.note && <span className="js-card__flag">Last activity {shortDate(item.lastActivity.at)}</span>}
        {item.openReviews > 0 && <span className="js-card__flag">{item.openReviews === 1 ? 'One item to review' : `${item.openReviews} items to review`}</span>}
        {item.stage === 'closed' && item.outcome && <span className="js-card__note">{OUTCOME_LABELS[item.outcome]}</span>}
      </span>
    </button>
  );
}

function Board({ items, view, selectedId, onSelect, onMoved }: { items: OpportunitySummary[]; view: Location['view']; selectedId: string | null; onSelect: (id: string) => void; onMoved: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const announce = useAnnounce();
  const move = useMutation<Record<string, unknown>, Write<OpportunityRecord>>('change_stage');
  const [dropError, setDropError] = useState<string | null>(null);
  const columns = width === null ? 4 : width >= 860 ? 4 : width >= 480 ? 2 : 1;
  const groups: { id: string; label: string; items: OpportunitySummary[]; stage?: Stage; outcome?: Outcome }[] = view === 'active'
    ? BOARD_STAGES.map((stage) => ({ id: stage, label: STAGE_LABELS[stage], stage, items: items.filter((item) => item.stage === stage) }))
    : view === 'closed'
      ? (['rejected', 'withdrawn', 'accepted'] as Outcome[]).map((outcome) => ({ id: outcome, label: OUTCOME_LABELS[outcome], outcome, items: items.filter((item) => item.outcome === outcome) }))
      : [{ id: 'archived', label: 'Archived', items }];
  const drop = async (event: DragEvent<HTMLElement>, stage: Stage | undefined) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const item = items.find((entry) => entry.id === id);
    if (!item || !stage || item.stage === stage) return;
    setDropError(null);
    try {
      const result = await move.run({ id, expectedRevision: item.revision, stage });
      move.reset();
      if (result.status === 'conflict') setDropError(`${item.company} changed since the board loaded. It was not moved.`);
      else announce(`Moved ${item.company} to ${STAGE_LABELS[stage]}`);
      onMoved();
    } catch (failure) {
      setDropError(errorText(failure));
    }
  };
  const active = view === 'active';
  return (
    <div ref={ref} className="ri-stack ri-stack--tight">
      {dropError && <Notice tone="warning" live>{dropError}</Notice>}
      <div className={columns === 1 ? 'js-sections' : 'js-board'} style={{ ['--js-columns' as string]: String(Math.min(columns, groups.length)) }}>
        {groups.map((group) => (
          <section key={group.id} className="js-column" aria-labelledby={`js-col-${group.id}`}
            onDragOver={active ? (event) => event.preventDefault() : undefined} onDrop={active ? (event) => void drop(event, group.stage) : undefined}>
            <h3 id={`js-col-${group.id}`} className="js-column__head"><span>{group.label}</span><span className="js-column__count" aria-label={`${group.items.length} opportunities`}>{group.items.length}</span></h3>
            {group.items.length === 0 ? <p className="js-column__empty">Nothing {active ? `in ${group.label}` : group.label.toLowerCase()} yet</p> : (
              <ul className="js-list">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Card item={item} selected={item.id === selectedId} onSelect={onSelect} draggable={active} onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; }} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {active && <p className="ri-small ri-muted">Drag a card to another stage, or open it and use Move to stage.</p>}
    </div>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

function Table({ items, selectedId, onSelect, compare, onCompare }: { items: OpportunitySummary[]; selectedId: string | null; onSelect: (id: string) => void; compare: string[]; onCompare: (ids: string[]) => void }) {
  const toggle = (id: string, on: boolean) => onCompare(on ? [...compare.filter((item) => item !== id), id].slice(-4) : compare.filter((item) => item !== id));
  return (
    <DataTable
      caption="Opportunities"
      captionHidden
      rows={items}
      rowKey="id"
      selectedKey={selectedId}
      onSelect={(key) => onSelect(key)}
      rowLabel={(row) => `${row.company}, ${row.role}, ${stageText(row.stage, row.outcome)}`}
      stickyFirstColumn
      columns={[
        { key: 'company', label: 'Company and role', render: (row) => <span className="ri-stack ri-stack--tight" style={{ gap: '0.125rem' }}><span>{row.company}</span><span className="ri-small ri-muted" style={{ fontWeight: 400 }}>{row.role}</span></span> },
        { key: 'stage', label: 'Stage', render: (row) => <StatusLabel tone={row.stage === 'offer' || row.outcome === 'accepted' ? 'success' : row.schedulingNeeded || row.openReviews ? 'warning' : 'neutral'}>{stageText(row.stage, row.outcome)}{row.schedulingNeeded ? ', scheduling needed' : ''}</StatusLabel> },
        { key: 'next', label: 'Next', render: (row) => <span>{nextText(row.next)}{row.note && <span className="ri-small ri-muted" style={{ display: 'block' }}>{row.note}</span>}</span> },
        { key: 'activity', label: 'Last activity', render: (row) => (row.lastActivity ? `${shortDate(row.lastActivity.at)} · ${row.lastActivity.label}` : 'None yet') },
        { key: 'location', label: 'Location', render: (row) => locationText(row), hideInCards: true },
        {
          key: 'compare', label: 'Compare', hideInCards: true, render: (row) => (
            <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <Checkbox label={<span className="ri-sr-only">Compare {row.company} {row.role}</span>} checked={compare.includes(row.id)} onChange={(on) => toggle(row.id, on)} />
            </span>
          ),
        },
      ]}
    />
  );
}

// ─── Inspector ───────────────────────────────────────────────────────────────

function OpportunityInspector({ item, go, onChanged }: { item: OpportunitySummary; go: Props['go']; onChanged: () => void }) {
  return (
    <Inspector
      eyebrow={item.company}
      title={item.role}
      subtitle={`${locationText(item)} · ${stageText(item.stage, item.outcome)}`}
      onClose={() => go({ selected: null })}
      actions={
        <>
          <Button onClick={() => go({ opportunityId: item.id, section: null })}>Open details</Button>
          <StageMenu opportunity={item} onChanged={onChanged} />
          <AskRiButton variant="primary" prompt={`Help me think through the ${item.role} opportunity at ${item.company}, using its saved records. Keep facts I recorded separate from suggestions.`}>Ask about this role</AskRiButton>
        </>
      }
    >
      <KeyValueList items={[
        { label: 'Next', value: nextText(item.next) },
        ...(item.note ? [{ label: 'Note', value: item.note }] : []),
        { label: 'Last activity', value: item.lastActivity ? `${shortDate(item.lastActivity.at)} · ${item.lastActivity.label}` : 'None yet' },
        { label: 'Description', value: item.hasPosting ? 'Saved, original retained' : 'Not saved yet' },
        { label: 'Stage set by', value: item.stageLocked ? 'You. Email and calendar changes wait for your review' : 'Your records, email and calendar' },
      ]} />
      {!item.hasPosting && <Notice tone="info" title="Add the description to prepare with this role" action={<Button size="sm" onClick={() => go({ opportunityId: item.id, section: 'posting' })}>Add description</Button>} />}
      {item.openReviews > 0 && <Notice tone="warning" title={item.openReviews === 1 ? 'One item about this role needs your decision' : `${item.openReviews} items about this role need your decision`} action={<Button size="sm" onClick={() => go({ tab: 'sources', selected: null })}>Review</Button>} />}
      {item.next?.kind === 'interview' && (
        <div className="js-panel js-panel--soft">
          <span className="ri-eyebrow">{item.next.title}</span>
          <p className="js-panel__title">{whenText(item.next.startAt, item.next.zone)}</p>
          <ButtonRow><Button variant="primary" size="sm" onClick={() => go({ prepare: { opportunityId: item.id, interviewId: item.next?.kind === 'interview' ? item.next.interviewId : null } })}>Open preparation</Button></ButtonRow>
        </div>
      )}
    </Inspector>
  );
}

export { useMemo };
