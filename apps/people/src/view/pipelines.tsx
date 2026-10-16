import { useEffect, useMemo, useState } from 'react';
import {
  AskRiButton, Button, ButtonRow, DataTable, DateInput, Dialog, EmptyState, InlineError, Menu, MoneyInput, Notice, RadioGroup, SegmentedControl, Select, SplitView, TextArea, TextInput,
  formatMoney, useAnnounce, useAppLayout, useQuery, type MoneyValue,
} from '@ri/app-kit/ui';
import type { Coverage, OpportunityDetail, OpportunitySummary, Pipeline } from '../schemas.js';
import { dateLabel, dayLabel } from './format.js';
import { FactRow, NotesPanel, PersonTimeline } from './person.js';
import { CoverageFooter, Failure, Loading, NameLink, TaskStatus, useSave, usePeople } from './shared.js';

type Saved<T> = { status: 'saved'; record: T } | { status: 'conflict'; current: T; message: string };

export function PipelinesView({ onCreate }: { onCreate(): void }) {
  const ui = usePeople();
  const layout = useAppLayout();
  const pipelines = useQuery<{ items: Pipeline[] }>('list_pipelines', {});
  const [setup, setSetup] = useState(false);
  const [editing, setEditing] = useState<Pipeline | null>(null);
  const navigation = useSave<unknown>('save_navigation');
  const announce = useAnnounce();
  const pipelineId = ui.route.query.pipeline ?? pipelines.data?.items[0]?.id;
  const pipeline = pipelines.data?.items.find((item) => item.id === pipelineId) ?? pipelines.data?.items[0];
  const mode = ui.route.query.layout === 'list' ? 'list' : 'board';
  const showValues = ui.route.query.values === '1';
  const opportunities = useQuery<{ items: OpportunitySummary[]; nextCursor: string | null; total: number; coverage: Coverage }>('list_opportunities', { limit: 100, filters: { pipelineId: pipeline?.id ?? '' }, sort: { key: 'stage', direction: 'asc' } }, { enabled: !!pipeline });
  const [stage, setStage] = useState<string | null>(null);
  const open = ui.route.record?.kind === 'opportunity' ? ui.route.record.id : null;
  useEffect(() => { if (pipeline && !stage) setStage(pipeline.stages.find((item) => item.kind === 'open')?.id ?? pipeline.stages[0]?.id ?? null); }, [pipeline?.id]);
  if (pipelines.error && !pipelines.data) return <Failure error={pipelines.error} reload={pipelines.reload} />;
  if (!pipelines.data) return <Loading label="Loading pipelines" />;
  const hide = async () => { await navigation.run({ pipelines: 'hidden' }); navigation.reset(); announce('Pipelines hidden. Records and follow-ups are kept'); ui.go({ section: 'today', record: null, query: {} }); };
  if (!pipeline) return (
    <div className="pe-stack">
      <EmptyState title="No pipeline yet" action={ui.data.owner ? <Button variant="primary" onClick={() => setSetup(true)}>Add pipeline</Button> : undefined}>
        A pipeline tracks a concrete outcome such as a client project, partnership or introduction. People never need a stage.
      </EmptyState>
      {ui.data.owner && <ButtonRow><Button variant="link" onClick={() => void hide()}>Hide this view</Button></ButtonRow>}
      {setup && <PipelineSetupDialog onClose={(id) => { setSetup(false); void pipelines.reload(); if (id) ui.setQuery({ pipeline: id }); }} />}
    </div>
  );
  const items = opportunities.data?.items ?? [];
  const byStage = (id: string) => items.filter((item) => item.stageId === id);
  const narrow = layout === 'narrow';
  const board = (
    <div className="pe-stack">
      <div className="pe-row pe-between">
        <div>
          <h2 className="ri-h2">{pipeline.name}</h2>
          <p className="pe-small pe-muted">{items.length} {items.length === 1 ? 'opportunity' : 'opportunities'}{items.length && items.every((item) => item.nextAction) ? ' · Each one has a clear next step' : ''}</p>
        </div>
        <ButtonRow>
          {pipelines.data.items.length > 1 && <Select hideLabel label="Pipeline" value={pipeline.id} onChange={(value) => ui.setQuery({ pipeline: value })} options={pipelines.data.items.map((item) => ({ value: item.id, label: item.name }))} />}
          {ui.data.owner && <Menu size="sm" variant="quiet" label="Pipeline" items={[{ id: 'stages', label: 'Edit stages' }, { id: 'new', label: 'Add another pipeline' }, { id: 'hide', label: 'Hide this view' }]} onSelect={(choice) => { if (choice === 'stages') setEditing(pipeline); if (choice === 'new') setSetup(true); if (choice === 'hide') void hide(); }} />}
        </ButtonRow>
      </div>
      <div className="pe-row pe-between">
        <SegmentedControl label="Pipeline layout" value={mode} onChange={(value) => ui.setQuery({ layout: value === 'board' ? null : value })} options={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List' }]} />
        <Button size="sm" aria-pressed={showValues} onClick={() => ui.setQuery({ values: showValues ? null : '1' })}>{showValues ? 'Hide values' : 'Show values'}</Button>
      </div>
      {opportunities.error && !opportunities.data ? <Failure error={opportunities.error} reload={opportunities.reload} /> : !opportunities.data ? <Loading label="Loading opportunities" /> : mode === 'board' ? (
        narrow ? (
          <div className="pe-stack">
            <Select className="pe-stage-picker" label="Stage" value={stage ?? ''} onChange={setStage} options={pipeline.stages.map((item) => ({ value: item.id, label: `${item.label} (${byStage(item.id).length})` }))} />
            {byStage(stage ?? '').length ? byStage(stage ?? '').map((item) => <OpportunityCard key={item.id} item={item} pipeline={pipeline} showValue={showValues} reload={opportunities.reload} />) : <p className="pe-column__empty">No opportunities here</p>}
          </div>
        ) : (
          <div className="pe-board" role="list" aria-label={`${pipeline.name} board`}>
            {pipeline.stages.map((column) => (
              <section key={column.id} className="pe-column" role="listitem" aria-label={`${column.label}, ${byStage(column.id).length}`}>
                <div className="pe-column__head">{column.label}<span>{byStage(column.id).length}</span></div>
                {byStage(column.id).length ? byStage(column.id).map((item) => <OpportunityCard key={item.id} item={item} pipeline={pipeline} showValue={showValues} reload={opportunities.reload} />) : <p className="pe-column__empty">No opportunities here</p>}
              </section>
            ))}
          </div>
        )
      ) : (
        <DataTable caption="Opportunities" captionHidden rows={items} rowKey="id" selectedKey={open} onSelect={(id) => ui.openOpportunity(id)}
          columns={[
            { key: 'title', label: 'Opportunity', render: (row) => row.title },
            { key: 'organization', label: 'Company', render: (row) => row.organization ? row.organization.name : <span className="pe-unavailable">Not recorded</span> },
            { key: 'stage', label: 'Stage', render: (row) => row.stageLabel },
            { key: 'next', label: 'Next action', render: (row) => row.nextAction ? `${row.nextAction}${row.nextActionDate ? ` · ${dateLabel(row.nextActionDate)}` : ''}` : <span className="pe-unavailable">None chosen</span> },
            ...(showValues ? [{ key: 'value', label: 'Value', align: 'end' as const, render: (row: OpportunitySummary) => row.value ? formatMoney(row.value.minor, row.value.currency) : <span className="pe-unavailable">Not recorded</span> }] : []),
          ]}
          empty={<EmptyState compact title="No opportunities yet" action={ui.data.canWrite ? <Button onClick={onCreate}>Add opportunity</Button> : undefined}>Add the first one when there is a concrete outcome to follow.</EmptyState>} />
      )}
      <p className="pe-small pe-muted">Stages belong to opportunities. Your people stay people. Moving a card never sends a message or completes a task. Values are never added together.</p>
      <CoverageFooter coverage={opportunities.data?.coverage} />
      {setup && <PipelineSetupDialog onClose={(id) => { setSetup(false); void pipelines.reload(); if (id) ui.setQuery({ pipeline: id }); }} />}
      {editing && <StagesDialog pipeline={editing} onClose={() => { setEditing(null); void pipelines.reload(); void opportunities.reload(); }} />}
    </div>
  );
  return (
    <SplitView list={board} detailOpen={!!open} onBack={() => ui.go({ record: null })} backLabel={`Back to ${pipeline.name}`} detailLabel="Opportunity" minSplitWidth={100000}
      detail={open ? <OpportunityWorkspace id={open} reload={() => void opportunities.reload()} /> : null} />
  );
}

function OpportunityCard({ item, pipeline, showValue, reload }: { item: OpportunitySummary; pipeline: Pipeline; showValue: boolean; reload(): void }) {
  const ui = usePeople();
  const move = useSave<Saved<OpportunitySummary>>('move_opportunity');
  const announce = useAnnounce();
  return (
    <article className="pe-opp" aria-label={item.title}>
      <span className="pe-small pe-muted">{item.organization?.name ?? item.people[0]?.name ?? 'No company or person linked'}</span>
      <button type="button" className="pe-opp__title" onClick={() => ui.openOpportunity(item.id)}>{item.title}</button>
      {showValue && item.value && <span className="pe-small">{formatMoney(item.value.minor, item.value.currency)}</span>}
      <div className="pe-opp__next">
        {item.nextAction ? <>{item.nextAction}<div className="pe-muted" style={{ marginTop: '0.25rem' }}>{item.nextActionDate ? dateLabel(item.nextActionDate) : 'No date'}</div></> : <span className="pe-muted">No next action</span>}
      </div>
      {ui.data.canWrite && (
        <Menu size="sm" variant="quiet" label="Move to stage" selectedId={item.stageId} items={pipeline.stages.map((stage) => ({ id: stage.id, label: stage.label }))} onSelect={async (stageId) => {
          if (stageId === item.stageId) return;
          const result = await move.run({ id: item.id, expectedRevision: item.revision, stageId });
          move.reset();
          announce(result.status === 'saved' ? `Moved to ${pipeline.stages.find((stage) => stage.id === stageId)?.label}. Tasks are unchanged` : 'Someone moved it first. Showing the latest stage');
          reload();
        }} />
      )}
    </article>
  );
}

function OpportunityWorkspace({ id, reload }: { id: string; reload(): void }) {
  const ui = usePeople();
  const detail = useQuery<OpportunityDetail>('get_opportunity', { id }, { keepPrevious: false });
  const [editing, setEditing] = useState(false);
  const move = useSave<Saved<OpportunitySummary>>('move_opportunity');
  const announce = useAnnounce();
  if (detail.error && !detail.data) return <Failure error={detail.error} reload={detail.reload} />;
  if (!detail.data) return <Loading label="Loading opportunity" />;
  const opp = detail.data.opportunity;
  const refresh = () => { void detail.reload(); reload(); };
  return (
    <article className="pe-record" aria-label={opp.title}>
      <header className="pe-record-head">
        <div className="pe-stack" style={{ gap: '0.25rem' }}>
          <h2 className="pe-record-title">{opp.title}</h2>
          <p className="pe-record-sub">{opp.pipelineName} · {opp.stageLabel}{opp.closed ? ' · Closed' : ''}</p>
          <p className="pe-small pe-muted">{opp.organization ? <NameLink kind="company" id={opp.organization.id} name={opp.organization.name} /> : 'No company linked'}{opp.people.length ? ' · ' : ''}{opp.people.map((person, index) => <span key={person.id}>{index ? ', ' : ''}<NameLink kind="person" id={person.id} name={person.name} /></span>)}</p>
        </div>
        <ButtonRow>
          {ui.data.canWrite && <Menu size="sm" label="Move to stage" selectedId={opp.stageId} items={detail.data.stages.map((stage) => ({ id: stage.id, label: stage.label }))} onSelect={async (stageId) => {
            if (stageId === opp.stageId) return;
            const result = await move.run({ id: opp.id, expectedRevision: opp.revision, stageId });
            move.reset();
            announce(result.status === 'saved' ? 'Stage updated. Tasks are unchanged' : 'Someone moved it first. Showing the latest stage');
            refresh();
          }} />}
          {ui.data.canWrite && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
          <AskRiButton size="sm" prompt={`Review the ${opp.title} opportunity${opp.organization ? ` at ${opp.organization.name}` : ''} in the People app. What is the next step? Cite linked records.`} />
        </ButtonRow>
      </header>
      <div className="pe-company-grid">
        <div className="pe-stack pe-stack--loose">
          <section className="pe-card pe-stack" aria-label="Next action">
            <p className="pe-section-label">Next action</p>
            <h3 className="ri-h3">{opp.nextAction ?? 'None chosen'}</h3>
            <p className="pe-small pe-muted">{opp.nextActionDate ? `Target ${dateLabel(opp.nextActionDate)}` : 'No date'}{opp.targetDate ? ` · Opportunity target ${dateLabel(opp.targetDate)}` : ''}</p>
            {opp.taskLink ? <TaskStatus link={opp.taskLink} /> : ui.data.canWrite && <ButtonRow><Button size="sm" onClick={() => ui.followUp({ subject: { kind: 'opportunity', id: opp.id }, title: opp.nextAction ?? opp.title, dueDate: opp.nextActionDate, label: opp.title })}>Create follow-up</Button></ButtonRow>}
          </section>
          {detail.data.suggestions.length > 0 && (
            <section className="pe-stack" aria-label="Stage suggestions">
              <h3 className="ri-h3">Suggested from email</h3>
              <p className="pe-small pe-muted">A suggestion never moves the card on its own.</p>
              {detail.data.suggestions.map((fact) => <FactRow key={fact.id} fact={fact} reload={refresh} />)}
            </section>
          )}
          <section className="pe-stack" aria-label="Linked activity"><h3 className="ri-h3">Linked activity</h3><PersonTimeline id={opp.id} subjectKind="opportunity" /></section>
          <section className="pe-stack" aria-label="Notes"><h3 className="ri-h3">Notes</h3><NotesPanel subjectKind="opportunity" subjectId={opp.id} notes={detail.data.notes} reload={refresh} /></section>
        </div>
        <aside className="pe-card pe-stack" aria-label="Stage history">
          <h3 className="ri-h3">Stage history</h3>
          {opp.value && <p className="pe-small">Recorded value {formatMoney(opp.value.minor, opp.value.currency)}</p>}
          <ol className="pe-list">
            {detail.data.history.map((change) => (
              <li key={change.id} className="pe-small">
                <strong>{change.fromStage ? `${change.fromStage} to ${change.toStage}` : `Created in ${change.toStage}`}</strong>
                {change.fromPipeline && change.fromPipeline !== change.toPipeline ? ` (${change.fromPipeline} to ${change.toPipeline})` : ''}
                <div className="pe-muted">{change.actor} · {dayLabel(change.at)}{change.reason && change.reason !== 'Created' ? ` · ${change.reason}` : ''}</div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      {editing && <OpportunityDialog existing={detail.data} onClose={() => { setEditing(false); refresh(); }} />}
    </article>
  );
}

export function OpportunityDialog({ existing, onClose }: { existing?: OpportunityDetail; onClose(id?: string): void }) {
  const ui = usePeople();
  const pipelines = useQuery<{ items: Pipeline[] }>('list_pipelines', {});
  const companies = useQuery<{ items: { id: string; name: string }[] }>('list_organizations', { limit: 100 });
  const people = useQuery<{ items: { id: string; name: string }[] }>('list_people', { limit: 100 });
  const opp = existing?.opportunity;
  const [title, setTitle] = useState(opp?.title ?? '');
  const [pipeline, setPipeline] = useState(opp?.pipelineId ?? ui.route.query.pipeline ?? '');
  const [stage, setStage] = useState(opp?.stageId ?? '');
  const [company, setCompany] = useState(opp?.organization?.id ?? '');
  const [person, setPerson] = useState(opp?.people[0]?.id ?? '');
  const [next, setNext] = useState(opp?.nextAction ?? '');
  const [nextDate, setNextDate] = useState<string | null>(opp?.nextActionDate ?? null);
  const [target, setTarget] = useState<string | null>(opp?.targetDate ?? null);
  const [money, setMoney] = useState<MoneyValue>({ amountMinor: opp?.value?.minor ?? null, currency: opp?.value?.currency ?? 'USD' });
  const [moneyValid, setMoneyValid] = useState(true);
  const save = useSave<Saved<OpportunitySummary>>('save_opportunity');
  const chosen = pipelines.data?.items.find((item) => item.id === (pipeline || pipelines.data?.items[0]?.id));
  return (
    <Dialog open title={opp ? `Edit ${opp.title}` : 'Add opportunity'} description="Value and currency are optional and stay hidden unless you show them." onClose={() => onClose()}
      footer={<ButtonRow align="end"><Button onClick={() => onClose()}>Cancel</Button><Button variant="primary" busy={save.pending} disabled={!title.trim() || !moneyValid || (!opp && !chosen)} onClick={async () => {
        const value = money.amountMinor === null ? null : { minor: money.amountMinor, currency: money.currency };
        const base = { title: title.trim(), organizationId: company || null, personIds: person ? [...new Set([person, ...(opp?.people.map((item) => item.id).filter((id) => id !== opp?.people[0]?.id) ?? [])])] : (opp ? [] : undefined), nextAction: next.trim() || null, nextActionDate: nextDate, targetDate: target, value };
        const result = opp ? await save.run({ id: opp.id, expectedRevision: opp.revision, ...base }, 'Saved') : await save.run({ ...base, pipelineId: chosen!.id, ...(stage ? { stageId: stage } : {}) }, 'Opportunity added');
        if (result.status === 'saved') onClose(result.record.id);
      }}>Save</Button></ButtonRow>}>
      <div className="pe-stack">
        <TextInput label="Title" value={title} onChange={setTitle} required />
        {!opp && (pipelines.data?.items.length ?? 0) > 1 && <Select label="Pipeline" value={pipeline || chosen?.id || ''} onChange={(value) => { setPipeline(value); setStage(''); }} options={pipelines.data!.items.map((item) => ({ value: item.id, label: item.name }))} />}
        {!opp && chosen && <Select label="Stage" value={stage || chosen.stages.find((item) => item.kind === 'open')?.id || ''} onChange={setStage} options={chosen.stages.map((item) => ({ value: item.id, label: item.label }))} />}
        <Select label="Company" value={company} onChange={setCompany} placeholder="No company" options={(companies.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))} />
        <Select label="Person" value={person} onChange={setPerson} placeholder="No person" options={(people.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))} />
        <TextInput label="Next action" hint="Optional" value={next} onChange={setNext} />
        <DateInput label="Next action date" hint="Optional" value={nextDate} onChange={setNextDate} />
        <DateInput label="Target date" hint="Optional" value={target} onChange={setTarget} />
        <MoneyInput label="Value" hint="Optional. Stored in whole minor units with its currency" value={money} onChange={(value, state) => { setMoney(value); setMoneyValid(state.valid); }} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

const TEMPLATES = {
  client_work: ['Exploring', 'Discussing', 'Proposal', 'Won', 'Closed'],
  introductions: ['Requested', 'Asked for consent', 'Introduced', 'Connected', 'Closed'],
  blank: ['Open', 'Done', 'Closed'],
} as const;
/** The last stage is a closed outcome and the one before it a successful one, so templates and custom lists agree. */
const stageKind = (index: number, count: number) => (count >= 3 && index === count - 1 ? 'closed' : count >= 3 && index === count - 2 ? 'succeeded' : count === 2 && index === 1 ? 'succeeded' : 'open');

export function PipelineSetupDialog({ onClose }: { onClose(id?: string): void }) {
  const [template, setTemplate] = useState<keyof typeof TEMPLATES>('client_work');
  const [name, setName] = useState('Client work');
  const [stages, setStages] = useState<string>(TEMPLATES.client_work.join('\n'));
  const save = useSave<Saved<Pipeline>>('save_pipeline');
  useEffect(() => { setStages(TEMPLATES[template].join('\n')); setName({ client_work: 'Client work', introductions: 'Introductions', blank: 'My pipeline' }[template]); }, [template]);
  const labels = stages.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <Dialog open title="Add a pipeline" description="Track a client project, partnership or introduction through simple stages. Start from a suggestion and edit freely." onClose={() => onClose()}
      footer={<ButtonRow align="end"><Button onClick={() => onClose()}>Cancel</Button><Button variant="primary" busy={save.pending} disabled={!name.trim() || !labels.length} onClick={async () => {
        const result = await save.run({ name: name.trim(), template, stages: labels.map((label, index) => ({ label, kind: stageKind(index, labels.length) })) }, 'Pipeline added');
        if (result.status === 'saved') onClose(result.record.id);
      }}>Create pipeline</Button></ButtonRow>}>
      <div className="pe-stack">
        <RadioGroup label="Start from" value={template} onChange={(value) => setTemplate(value as keyof typeof TEMPLATES)} options={[{ value: 'client_work', label: 'Client work', hint: 'Exploring, Discussing, Proposal, Won, Closed' }, { value: 'introductions', label: 'Introductions', hint: 'Requested, Asked for consent, Introduced, Connected, Closed' }, { value: 'blank', label: 'Blank', hint: 'Open, Done, Closed' }]} />
        <TextInput label="Name" value={name} onChange={setName} />
        <TextArea label="Stages, one per line" hint="The last stage is a closed outcome and the one before it a successful one. Edit them later" value={stages} onChange={setStages} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

function StagesDialog({ pipeline, onClose }: { pipeline: Pipeline; onClose(): void }) {
  const [rows, setRows] = useState(pipeline.stages.map((stage) => ({ id: stage.id as string | undefined, label: stage.label, kind: stage.kind as string, count: stage.count })));
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const save = useSave<Saved<Pipeline>>('save_pipeline_stages');
  const removed = useMemo(() => pipeline.stages.filter((stage) => !rows.some((row) => row.id === stage.id) && stage.count > 0), [rows]);
  const move = (index: number, delta: number) => setRows((current) => { const copy = [...current]; const [item] = copy.splice(index, 1); copy.splice(index + delta, 0, item!); return copy; });
  return (
    <Dialog open wide title={`Stages of ${pipeline.name}`} description="Labels and order can change at any time. Stage IDs stay the same, so history and filters keep working." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.pending} disabled={removed.some((stage) => !replacements[stage.id])} onClick={async () => {
        const result = await save.run({ pipelineId: pipeline.id, expectedRevision: pipeline.revision, stages: rows.map((row) => ({ ...(row.id ? { id: row.id } : {}), label: row.label.trim(), kind: row.kind })), replacements: removed.map((stage) => ({ stageId: stage.id, replacementStageId: replacements[stage.id] })) }, 'Stages saved');
        if (result.status === 'saved') onClose();
      }}>Save stages</Button></ButtonRow>}>
      <div className="pe-stack">
        {rows.map((row, index) => (
          <div key={row.id ?? `new-${index}`} className="pe-stage-row">
            <TextInput label={`Stage ${index + 1}`} value={row.label} onChange={(value) => setRows((current) => current.map((item, i) => i === index ? { ...item, label: value } : item))} />
            <Select label="Kind" value={row.kind} onChange={(value) => setRows((current) => current.map((item, i) => i === index ? { ...item, kind: value } : item))} options={[{ value: 'open', label: 'Open' }, { value: 'succeeded', label: 'Succeeded' }, { value: 'closed', label: 'Closed' }]} />
            <ButtonRow>
              <Button size="sm" variant="quiet" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${row.label} earlier`}>Up</Button>
              <Button size="sm" variant="quiet" disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${row.label} later`}>Down</Button>
              <Button size="sm" variant="quiet" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${row.label}`}>Remove</Button>
            </ButtonRow>
          </div>
        ))}
        <ButtonRow><Button size="sm" onClick={() => setRows((current) => [...current, { id: undefined, label: 'New stage', kind: 'open', count: 0 }])}>Add stage</Button></ButtonRow>
        {removed.map((stage) => (
          <Notice key={stage.id} tone="warning" title={`${stage.label} still has ${stage.count} ${stage.count === 1 ? 'opportunity' : 'opportunities'}`}>
            <Select label="Move them to" value={replacements[stage.id] ?? ''} placeholder="Choose a stage" onChange={(value) => setReplacements((current) => ({ ...current, [stage.id]: value }))} options={rows.filter((row) => row.id).map((row) => ({ value: row.id!, label: row.label }))} />
          </Notice>
        ))}
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}
