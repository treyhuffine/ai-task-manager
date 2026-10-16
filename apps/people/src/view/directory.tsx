import { useEffect, useMemo, useState } from 'react';
import {
  AvatarLabel, Avatar, Button, ButtonRow, Checkbox, DataTable, Dialog, EmptyState, InlineError, Menu, SearchField, Select, SplitView, TextInput, useAnnounce, useQuery,
  type DataColumn, type DataTableSort,
} from '@ri/app-kit/ui';
import type { Coverage, OrganizationSummary, PeopleFilters, PersonSummary, SavedView } from '../schemas.js';
import { coverageLines, dayLabel, meetingLabel, nextActionText } from './format.js';
import { CompanyWorkspace } from './company.js';
import { PersonWorkspace } from './person.js';
import { Failure, Loading, NameLink, useSave, usePeople } from './shared.js';

type Kind = 'person' | 'organization';
type Page<T> = { items: T[]; nextCursor: string | null; total: number; coverage: Coverage; revision: string; unavailableFilters: string[]; columns: string[] };
const PERSON_COLUMNS: Record<string, string> = { company: 'Company / role', last_exchange: 'Last exchange', next_action: 'Next action', next_meeting: 'Next meeting', primary_email: 'Primary email', lists: 'Lists', coverage: 'Sources', added: 'Date added' };
const COMPANY_COLUMNS: Record<string, string> = { people: 'People you know', last_exchange: 'Last exchange', next_action: 'Next action', domain: 'Website', lists: 'Lists', coverage: 'Sources', added: 'Date added' };
const SORT_FOR: Record<string, string> = { name: 'name', last_exchange: 'last_exchange', next_action: 'next_action', next_meeting: 'next_meeting', added: 'added' };

function parse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** The People or Companies directory: views, search, filters, columns, selection and an inspector. */
export function Directory({ kind }: { kind: Kind }) {
  const ui = usePeople();
  const q = ui.route.query;
  const [text, setText] = useState(q.q ?? '');
  const [debounced, setDebounced] = useState(q.q ?? '');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'filters' | 'columns' | 'save' | 'bulk-list'>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState<'list' | 'unlist'>('list');
  const [bulkResult, setBulkResult] = useState<{ id: string; status: string; message: string | null }[]>([]);
  const announce = useAnnounce();
  useEffect(() => { const timer = setTimeout(() => setDebounced(text), 250); return () => clearTimeout(timer); }, [text]);
  useEffect(() => { if (debounced !== (q.q ?? '')) ui.setQuery({ q: debounced || null }); setPages([]); }, [debounced]);
  const viewKey = q.view ?? 'all';
  const filters = parse<PeopleFilters>(q.f, {});
  const sort = { key: q.sort ?? 'name', direction: (q.dir as 'asc' | 'desc') ?? (q.sort === 'last_exchange' || q.sort === 'added' ? 'desc' : 'asc') };
  const views = useQuery<{ items: SavedView[] }>('list_views', { recordKind: kind, limit: 100 });
  const lists = useQuery<{ items: { id: string; name: string; revision: number; memberCount: number }[] }>('list_lists', { recordKind: kind, limit: 100 });
  const viewId = viewKey.startsWith('view:') ? viewKey.slice(5) : undefined;
  const effective: PeopleFilters = { ...filters, ...(viewKey === 'pinned' ? { pinned: true } : {}), ...(viewKey === 'follow' ? { hasFollowUp: true } : {}), ...(viewKey.startsWith('list:') ? { listIds: [viewKey.slice(5)] } : {}), ...(debounced.trim() ? { text: debounced.trim() } : {}) };
  const input = { limit: 50, filters: effective, sort, ...(viewId ? { viewId } : {}) };
  const action = kind === 'person' ? 'list_people' : 'list_organizations';
  const first = useQuery<Page<PersonSummary & OrganizationSummary>>(action, kind === 'person' ? input : { ...input, filters: { ...(effective.text ? { text: effective.text } : {}), ...(effective.listIds ? { listIds: effective.listIds } : {}), ...(effective.hasFollowUp ? { hasFollowUp: true } : {}), ...(effective.lastExchange ? { lastExchange: effective.lastExchange } : {}), ...(effective.archived ? { archived: effective.archived } : {}) }, sort: { ...sort, key: sort.key === 'next_meeting' ? 'name' : sort.key } });
  const more = useQuery<Page<PersonSummary & OrganizationSummary>>(action, { ...input, limit: 100, cursor: pages.at(-1) ?? '' }, { enabled: pages.length > 0 });
  const [extra, setExtra] = useState<(PersonSummary & OrganizationSummary)[]>([]);
  useEffect(() => { setExtra([]); setPages([]); }, [JSON.stringify(input)]);
  useEffect(() => { if (more.data && pages.length) setExtra((current) => [...current, ...more.data!.items.filter((item) => !current.some((row) => row.id === item.id))]); }, [more.data]);
  const rows = useMemo(() => [...(first.data?.items ?? []), ...extra], [first.data, extra]);
  const nextCursor = pages.length ? more.data?.nextCursor ?? null : first.data?.nextCursor ?? null;
  const viewColumns = viewId ? views.data?.items.find((view) => view.id === viewId)?.columns : undefined;
  const columns = parse<string[]>(q.c, viewColumns ?? (kind === 'person' ? ['company', 'last_exchange', 'next_action'] : ['people', 'last_exchange', 'next_action']));
  const open = ui.route.record?.kind === (kind === 'person' ? 'person' : 'company') ? ui.route.record.id : null;
  const noun = kind === 'person' ? 'people' : 'companies';
  const bulk = useSave<{ results: { id: string; status: string; message: string | null }[]; saved: number }>('bulk_update_records');
  const navigation = useSave<unknown>('save_navigation');

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 50 ? current : [...current, id]);
  const table: DataColumn<PersonSummary & OrganizationSummary>[] = [
    ...(selecting ? [{ key: 'select', label: 'Select', hideInCards: false, render: (row: PersonSummary) => (
      <span className="pe-check-cell" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} />
      </span>
    ) }] : []),
    { key: 'name', label: kind === 'person' ? 'Name' : 'Company', sortable: true, render: (row) => kind === 'person'
      ? <AvatarLabel name={row.name} detail={row.role ?? (row.company ? undefined : row.pinned ? 'Pinned' : undefined)} />
      : <span className="pe-name-cell"><Avatar name={row.name} size="sm" className="pe-square" /><span className="pe-name-cell__text"><span className="pe-name-cell__name">{row.name}</span><span className="pe-name-cell__detail">{row.domain ?? (row.state === 'provisional' ? 'Provisional' : '')}</span></span></span> },
    ...columns.map((column): DataColumn<PersonSummary & OrganizationSummary> => ({
      key: column, label: (kind === 'person' ? PERSON_COLUMNS : COMPANY_COLUMNS)[column] ?? column, sortable: !!SORT_FOR[column] && !(kind === 'organization' && column === 'next_meeting'),
      render: (row) => {
        switch (column) {
          case 'company': return row.company ? <NameLink kind="company" id={row.company.id} name={row.company.name} /> : <span className="pe-unavailable">Not recorded</span>;
          case 'people': return String(row.peopleCount);
          case 'last_exchange': return row.lastExchangeAt ? dayLabel(row.lastExchangeAt) : <span className="pe-unavailable">None found</span>;
          case 'next_action': return row.nextAction ? nextActionText(row.nextAction) : <span className="pe-unavailable">No follow-up chosen</span>;
          case 'next_meeting': return row.nextMeeting ? meetingLabel(row.nextMeeting.at) : <span className="pe-unavailable">None scheduled</span>;
          case 'primary_email': return row.primaryEmail ?? <span className="pe-unavailable">Not recorded</span>;
          case 'domain': return row.domain ?? <span className="pe-unavailable">Not recorded</span>;
          case 'lists': return row.lists.length ? row.lists.map((list) => list.name).join(', ') : <span className="pe-unavailable">None</span>;
          case 'coverage': return row.sourceLabels.join(', ') || <span className="pe-unavailable">Not recorded</span>;
          case 'added': return dayLabel(row.addedAt);
          default: return null;
        }
      },
    })),
  ];
  const tableSort: DataTableSort | null = { key: sort.key === 'name' ? 'name' : Object.keys(SORT_FOR).find((key) => SORT_FOR[key] === sort.key) ?? 'name', direction: sort.direction === 'desc' ? 'descending' : 'ascending' };
  const activeCount = Object.keys(filters).length + (debounced ? 1 : 0) + (viewKey !== 'all' ? 1 : 0);
  const [line1] = coverageLines(first.data?.coverage);
  const viewOptions = [
    { value: 'all', label: kind === 'person' ? 'All people' : 'All companies' },
    ...(kind === 'person' ? [{ value: 'pinned', label: 'Pinned' }] : []),
    { value: 'follow', label: 'Has a follow-up' },
    ...(lists.data?.items ?? []).map((list) => ({ value: `list:${list.id}`, label: `List: ${list.name}` })),
    ...(views.data?.items ?? []).map((view) => ({ value: `view:${view.id}`, label: view.label })),
  ];
  const currentView = viewId ? views.data?.items.find((view) => view.id === viewId) : undefined;
  const pinned = currentView ? ui.data.pinnedViews.some((view) => view.id === currentView.id) : false;

  const list = (
    <div>
      <div className="pe-directory-toolbar" role="group" aria-label={`${kind === 'person' ? 'People' : 'Company'} directory controls`}>
        <Select className="pe-view-select" label="View" value={viewKey} onChange={(value) => { ui.setQuery({ view: value === 'all' ? null : value, f: null, c: null }); setSelected([]); }} options={viewOptions} />
        <SearchField label={kind === 'person' ? 'Search people' : 'Search companies'} hideLabel placeholder={kind === 'person' ? 'Search people, companies or notes' : 'Search companies'} value={text} onChange={setText} />
        <Button onClick={() => setDialog('filters')}>Filter{Object.keys(filters).length ? ` (${Object.keys(filters).length})` : ''}</Button>
        <Button onClick={() => setDialog('columns')}>Columns</Button>
        {ui.data.canWrite && <Button onClick={() => setDialog('save')}>Save view</Button>}
        {ui.data.canWrite && <Button variant="quiet" aria-pressed={selecting} onClick={() => { setSelecting((value) => !value); setSelected([]); }}>{selecting ? 'Done selecting' : 'Select'}</Button>}
      </div>
      {(activeCount > 0 || (first.data?.unavailableFilters.length ?? 0) > 0) && (
        <div className="pe-active-filters" role="status">
          <span>{first.data ? `${first.data.total} matching ${first.data.total === 1 ? (kind === 'person' ? 'person' : 'company') : noun}` : 'Filtering'}</span>
          {Object.entries(filters).map(([key, value]) => <span key={key} className="pe-pill">{describeFilter(key, value)}</span>)}
          {first.data?.unavailableFilters.map((item) => <span key={item} className="pe-pill">{item}. Showing fewer results, never more</span>)}
          {currentView && ui.data.owner && <Button size="sm" variant="link" onClick={async () => { await navigation.run(pinned ? { unpinViewIds: [currentView.id] } : { pinViewIds: [currentView.id] }); navigation.reset(); announce(pinned ? 'View unpinned' : 'View pinned to navigation'); }}>{pinned ? 'Unpin view' : 'Pin view'}</Button>}
          <Button size="sm" variant="link" onClick={() => { setText(''); setDebounced(''); ui.setQuery({ q: null, f: null, view: null, c: null }); }}>Clear filters</Button>
        </div>
      )}
      {selecting && (
        <div className="pe-bulk" role="group" aria-label="Selected records">
          <span>{selected.length} selected{selected.length >= 50 ? ' (most at once)' : ''}</span>
          <Button size="sm" variant="link" onClick={() => setSelected(rows.slice(0, 50).map((row) => row.id))}>Select loaded (up to 50)</Button>
          <Menu size="sm" label="Change selected" items={[
            ...(kind === 'person' ? [{ id: 'pin', label: 'Pin' }, { id: 'unpin', label: 'Unpin' }] : []),
            { id: 'list', label: 'Add to a list' }, { id: 'unlist', label: 'Remove from a list' }, { id: 'archive', label: 'Archive' },
          ].map((item) => ({ ...item, disabled: !selected.length }))} onSelect={async (choice) => {
            if (choice === 'list' || choice === 'unlist') { setDialog('bulk-list'); setBulkMode(choice); return; }
            const items = rows.filter((row) => selected.includes(row.id)).map((row) => ({ id: row.id, expectedRevision: row.revision }));
            const result = await bulk.run({ recordKind: kind, items, change: choice === 'archive' ? { archived: true } : { pinned: choice === 'pin' } });
            bulk.reset();
            setBulkResult(result.results.filter((item) => item.status !== 'saved'));
            announce(`${result.saved} of ${items.length} updated`);
            void first.reload();
          }} />
        </div>
      )}
      {bulkResult.length > 0 && (
        <InlineError>{bulkResult.length} not changed: {bulkResult.map((item) => `${rows.find((row) => row.id === item.id)?.name ?? 'A record'} (${item.message ?? item.status})`).join(', ')}</InlineError>
      )}
      {first.error && !first.data ? <Failure error={first.error} reload={first.reload} /> : !first.data ? <Loading label={`Loading ${noun}`} /> : (
        <DataTable
          caption={kind === 'person' ? 'People' : 'Companies'}
          captionHidden
          stickyFirstColumn
          columns={table}
          rows={rows}
          rowKey="id"
          selectedKey={open}
          onSelect={(id) => (selecting ? toggle(id) : kind === 'person' ? ui.openPerson(id) : ui.openCompany(id))}
          rowLabel={(row) => `${row.name}${row.company ? `, ${row.company.name}` : ''}`}
          sort={tableSort}
          onSortChange={(next) => { ui.setQuery({ sort: SORT_FOR[next.key] ?? 'name', dir: next.direction === 'descending' ? 'desc' : 'asc' }); }}
          empty={activeCount ? (
            <EmptyState compact title={`No matching ${noun}`} action={<Button onClick={() => { setText(''); setDebounced(''); ui.setQuery({ q: null, f: null, view: null }); }}>Clear filters</Button>}>
              Checked {first.data.coverage.accounts.length ? first.data.coverage.accounts.map((account) => account.label).join(' and ') : 'your records'} with these filters. {first.data.coverage.partial ? 'Coverage is partial, so some records may not be indexed yet.' : ''}
            </EmptyState>
          ) : <EmptyDirectory kind={kind} />}
        />
      )}
      {first.data && (
        <div className="pe-footer">
          <span>{rows.length < first.data.total ? `Showing ${rows.length} of ${first.data.total} ${noun}` : `${first.data.total} ${first.data.total === 1 ? (kind === 'person' ? 'person' : 'company') : noun} in this view`}</span>
          {nextCursor && <Button size="sm" busy={more.loading} onClick={() => setPages((current) => [...current, nextCursor])}>Show more</Button>}
          <span>{line1}</span>
        </div>
      )}
      <FiltersDialog kind={kind} open={dialog === 'filters'} filters={filters} onClose={() => setDialog(null)} onApply={(next) => { ui.setQuery({ f: Object.keys(next).length ? JSON.stringify(next) : null }); setDialog(null); }} />
      <ColumnsDialog kind={kind} open={dialog === 'columns'} columns={columns} onClose={() => setDialog(null)} onApply={(next) => { ui.setQuery({ c: JSON.stringify(next) }); setDialog(null); }} />
      {dialog === 'save' && <SaveViewDialog kind={kind} filters={{ ...filters, ...(viewKey.startsWith('list:') ? { listIds: [viewKey.slice(5)] } : {}), ...(viewKey === 'pinned' ? { pinned: true } : {}), ...(viewKey === 'follow' ? { hasFollowUp: true } : {}), ...(debounced.trim() ? { text: debounced.trim() } : {}) }} sort={sort} columns={columns} existing={currentView ?? null}
        onClose={(id) => { setDialog(null); if (id) { ui.setQuery({ view: `view:${id}`, f: null, q: null, c: null }); setText(''); setDebounced(''); void views.reload(); } }} />}
      {dialog === 'bulk-list' && <BulkListDialog kind={kind} mode={bulkMode} lists={lists.data?.items ?? []} items={rows.filter((row) => selected.includes(row.id)).map((row) => ({ id: row.id, expectedRevision: row.revision }))}
        onClose={(changed) => { setDialog(null); if (changed) { void first.reload(); void lists.reload(); } }} />}
    </div>
  );
  return (
    <SplitView
      className={kind === 'person' ? 'pe-directory' : undefined}
      list={list}
      detailOpen={!!open}
      onBack={() => ui.go({ record: null })}
      backLabel={kind === 'person' ? 'Back to people' : 'Back to companies'}
      detailLabel={kind === 'person' ? 'Person' : 'Company'}
      minSplitWidth={kind === 'person' ? 1000 : 100000}
      detail={open ? (kind === 'person' ? <div className="ri-inspector"><PersonWorkspace id={open} /></div> : <CompanyWorkspace id={open} />) : null}
    />
  );
}

function describeFilter(key: string, value: unknown): string {
  const v = value as Record<string, number | string | boolean>;
  switch (key) {
    case 'pinned': return value ? 'Pinned' : 'Not pinned';
    case 'hasFollowUp': return value ? 'Has a follow-up' : 'No follow-up';
    case 'organizationIds': return `Company (${(value as string[]).length})`;
    case 'listIds': return `List (${(value as string[]).length})`;
    case 'lastExchange': return v.olderThanDays !== undefined ? `Last exchange over ${v.olderThanDays} days ago${v.includeNone ? ' or never' : ''}` : v.withinDays !== undefined ? `Last exchange within ${v.withinDays} days` : 'Last exchange';
    case 'nextMeeting': return v.nextDays !== undefined ? `Meeting in the next ${v.nextDays} days` : 'Next meeting';
    case 'archived': return value === 'archived' ? 'Archived only' : value === 'all' ? 'Including archived' : 'Active';
    case 'sources': return `Source (${(value as string[]).length})`;
    case 'text': return `Text: ${String(value)}`;
    default: return key;
  }
}

function EmptyDirectory({ kind }: { kind: Kind }) {
  const ui = usePeople();
  if (kind === 'organization') return (
    <EmptyState compact title="No companies yet" action={ui.data.canWrite ? <Button variant="primary" onClick={() => ui.go({ query: { ...ui.route.query, create: 'company' } })}>Add company</Button> : undefined}>
      Companies, communities, funds and other organizations share one record. Creating one needs only a name.
    </EmptyState>
  );
  return (
    <EmptyState compact title="No people yet" action={ui.data.canWrite ? <Button variant="primary" onClick={() => ui.go({ query: { ...ui.route.query, create: 'person' } })}>Add person</Button> : undefined}>
      Add someone by name, import contacts in Sources, or connect email and calendar. No company, list or stage is needed.
    </EmptyState>
  );
}

function FiltersDialog({ kind, open, filters, onClose, onApply }: { kind: Kind; open: boolean; filters: PeopleFilters; onClose(): void; onApply(next: PeopleFilters): void }) {
  const ui = usePeople();
  const companies = useQuery<{ items: { id: string; name: string }[] }>('list_organizations', { limit: 100 }, { enabled: open && kind === 'person' });
  const lists = useQuery<{ items: { id: string; name: string }[] }>('list_lists', { recordKind: kind, limit: 100 }, { enabled: open });
  const [draft, setDraft] = useState<PeopleFilters>(filters);
  useEffect(() => { if (open) setDraft(filters); }, [open]);
  const toggleIn = (key: 'organizationIds' | 'listIds', id: string, on: boolean) => setDraft((current) => {
    const next = new Set(current[key] ?? []);
    if (on) next.add(id); else next.delete(id);
    const copy = { ...current, [key]: [...next] };
    if (!copy[key]!.length) delete copy[key];
    return copy;
  });
  const lastMode = draft.lastExchange?.olderThanDays !== undefined ? `older:${draft.lastExchange.olderThanDays}` : draft.lastExchange?.withinDays !== undefined ? `within:${draft.lastExchange.withinDays}` : '';
  return (
    <Dialog open={open} title="Filter" description="Filters combine with AND. Several values in one field mean OR. Filters never widen what a chat may see." onClose={onClose}
      footer={<ButtonRow align="end"><Button variant="quiet" onClick={() => setDraft({})}>Clear all</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onApply(draft)}>Apply</Button></ButtonRow>}>
      <div className="pe-stack">
        {kind === 'person' && (
          <>
            <Checkbox label="Pinned only" checked={draft.pinned === true} onChange={(on) => setDraft((current) => { const copy = { ...current }; if (on) copy.pinned = true; else delete copy.pinned; return copy; })} />
            <Select label="Next meeting" value={draft.nextMeeting?.nextDays !== undefined ? String(draft.nextMeeting.nextDays) : ''} onChange={(value) => setDraft((current) => { const copy = { ...current }; if (value) copy.nextMeeting = { nextDays: Number(value) }; else delete copy.nextMeeting; return copy; })}
              options={[{ value: '', label: 'Any' }, { value: '7', label: 'In the next 7 days' }, { value: '30', label: 'In the next 30 days' }]} />
          </>
        )}
        <Checkbox label="Has a follow-up" checked={draft.hasFollowUp === true} onChange={(on) => setDraft((current) => { const copy = { ...current }; if (on) copy.hasFollowUp = true; else delete copy.hasFollowUp; return copy; })} />
        <Select label="Last direct exchange" value={lastMode} onChange={(value) => setDraft((current) => { const copy = { ...current }; if (!value) delete copy.lastExchange; else { const [mode, days] = value.split(':'); copy.lastExchange = mode === 'older' ? { olderThanDays: Number(days), includeNone: true } : { withinDays: Number(days) }; } return copy; })}
          options={[{ value: '', label: 'Any time' }, { value: 'within:7', label: 'Within a week' }, { value: 'within:30', label: 'Within a month' }, { value: 'older:30', label: 'Not in the last month' }, { value: 'older:90', label: 'Not in the last 3 months' }]} />
        <Select label="Archive" value={draft.archived ?? 'active'} onChange={(value) => setDraft((current) => { const copy = { ...current }; if (value === 'active') delete copy.archived; else copy.archived = value as 'archived' | 'all'; return copy; })}
          options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived only' }, { value: 'all', label: 'Active and archived' }]} />
        {(lists.data?.items.length ?? 0) > 0 && (
          <fieldset className="ri-fieldset"><legend>Lists</legend>
            {lists.data!.items.map((list) => <Checkbox key={list.id} label={list.name} checked={!!draft.listIds?.includes(list.id)} onChange={(on) => toggleIn('listIds', list.id, on)} />)}
          </fieldset>
        )}
        {kind === 'person' && (companies.data?.items.length ?? 0) > 0 && (
          <fieldset className="ri-fieldset"><legend>Company</legend>
            {companies.data!.items.slice(0, 40).map((company) => <Checkbox key={company.id} label={company.name} checked={!!draft.organizationIds?.includes(company.id)} onChange={(on) => toggleIn('organizationIds', company.id, on)} />)}
          </fieldset>
        )}
        {!ui.data.owner && <p className="pe-small pe-muted">This chat sees only the records it was given.</p>}
      </div>
    </Dialog>
  );
}

function ColumnsDialog({ kind, open, columns, onClose, onApply }: { kind: Kind; open: boolean; columns: string[]; onClose(): void; onApply(next: string[]): void }) {
  const all = kind === 'person' ? PERSON_COLUMNS : COMPANY_COLUMNS;
  const [draft, setDraft] = useState(columns);
  useEffect(() => { if (open) setDraft(columns); }, [open]);
  return (
    <Dialog open={open} title="Columns" description="The name column always shows. A missing value is shown as unavailable, never guessed." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onApply(Object.keys(all).filter((key) => draft.includes(key)))}>Apply</Button></ButtonRow>}>
      <fieldset className="ri-fieldset"><legend>Show columns</legend>
        {Object.entries(all).map(([key, label]) => <Checkbox key={key} label={label} checked={draft.includes(key)} onChange={(on) => setDraft((current) => on ? [...current, key] : current.filter((item) => item !== key))} />)}
      </fieldset>
    </Dialog>
  );
}

function SaveViewDialog({ kind, filters, sort, columns, existing, onClose }: { kind: Kind; filters: PeopleFilters; sort: { key: string; direction: string }; columns: string[]; existing: SavedView | null; onClose(id?: string): void }) {
  const [label, setLabel] = useState(existing?.label ?? (filters.text ? `Matching ${filters.text}` : kind === 'person' ? 'My people' : 'My companies'));
  const save = useSave<{ status: string; record: SavedView }>('save_view');
  const allowed = kind === 'person' ? filters : Object.fromEntries(Object.entries(filters).filter(([key]) => ['text', 'listIds', 'hasFollowUp', 'lastExchange', 'archived', 'sources'].includes(key)));
  return (
    <Dialog open title="Save this view" description="Keeps the current filters, sort and columns. Records and permissions are unchanged." onClose={() => onClose()}
      footer={<ButtonRow align="end"><Button onClick={() => onClose()}>Cancel</Button>
        {existing && <Button busy={save.pending} onClick={async () => { const result = await save.run({ id: existing.id, expectedRevision: existing.revision, label, filters: allowed, sort, columns }, 'View updated'); onClose(result.record.id); }}>Update view</Button>}
        <Button variant="primary" busy={save.pending} onClick={async () => { const result = await save.run({ label, recordKind: kind, filters: allowed, sort, columns }, 'View saved'); onClose(result.record.id); }}>Save as new view</Button></ButtonRow>}>
      <div className="pe-stack">
        <TextInput label="View name" value={label} onChange={setLabel} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

function BulkListDialog({ kind, mode, lists, items, onClose }: { kind: Kind; mode: 'list' | 'unlist'; lists: { id: string; name: string }[]; items: { id: string; expectedRevision: number }[]; onClose(changed: boolean): void }) {
  const [listId, setListId] = useState('');
  const [name, setName] = useState('');
  const bulk = useSave<{ results: { status: string }[]; saved: number }>('bulk_update_records');
  const create = useSave<{ status: string; record: { id: string } }>('save_list');
  const announce = useAnnounce();
  return (
    <Dialog open title={mode === 'list' ? `Add ${items.length} to a list` : `Remove ${items.length} from a list`} description="Lists hold one kind of record. They copy nothing and share nothing." onClose={() => onClose(false)}
      footer={<ButtonRow align="end"><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" busy={bulk.pending || create.pending} disabled={!items.length || (!listId && !name.trim())} onClick={async () => {
        let id = listId;
        if (!id && mode === 'list') id = (await create.run({ name: name.trim(), recordKind: kind })).record.id;
        const result = await bulk.run({ recordKind: kind, items, change: mode === 'list' ? { addToListId: id } : { removeFromListId: id } });
        announce(`${result.saved} of ${items.length} updated`);
        onClose(true);
      }}>{mode === 'list' ? 'Add' : 'Remove'}</Button></ButtonRow>}>
      <div className="pe-stack">
        <Select label="List" value={listId} onChange={setListId} placeholder={mode === 'list' ? 'New list' : 'Choose a list'} options={lists.map((list) => ({ value: list.id, label: list.name }))} />
        {mode === 'list' && !listId && <TextInput label="New list name" value={name} onChange={setName} />}
        {(bulk.error || create.error) && <InlineError>{bulk.error ?? create.error}</InlineError>}
      </div>
    </Dialog>
  );
}
