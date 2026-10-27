import { useEffect, useRef, useState } from 'react';
import {
  Button, ButtonRow, DataTable, Dialog, EmptyState, InlineError, Notice, Select, ShareScopeChooser, SourcesScreen, StatusLabel, TextInput, useAnnounce, useQuery, useRiApp,
  type HistoryDays, type SourceAccount,
} from '@ri/app-kit/ui';
import { localDate } from '@ri/app-kit/time';
import { dayLabel, updatedLabel, zone } from './format.js';
import { Failure, Loading, useSave, usePeople } from './shared.js';

interface Sources {
  accounts: { account: string; source: string; kind: 'mail' | 'calendar'; label: string; granted: boolean; automatic: boolean; status: string; coverage: { from: string | null; to: string | null; partial: boolean }; historyDays: number; calendars: string[]; paused: boolean; lastSuccessAt: string | null; pending: number; failed: number; lastError: string | null; records: number }[];
  imports: { id: string; source: string; label: string; format: string; fileName: string; counts: Record<string, number>; importedAt: string }[];
  extraction: { enabled: boolean; status: 'off' | 'on' | 'paused' | 'unavailable'; reason: string | null; pending: number; failed: number; briefingsPending: number };
  failedItems: { id: string; kind: string; reason: string; at: string; source: string }[];
  exclusions: { bulk: number; excluded: number; included: number; suppressed: number };
  largeEvents: number; incomingOnly: number; identityReviews: number;
  collections: { key: string; label: string }[]; scopes: number;
}
interface Review { id: string; revision: number; kind: 'person' | 'organization' | 'alias' | 'sender'; reason: string; summary: string; passage: string | null; evidenceIds: string[]; left: { id: string; name: string; detail: string | null }; right: { id: string; name: string; detail: string | null } | null; identifier: string | null }

export function SourcesView() {
  const ui = usePeople();
  const app = useRiApp();
  const sources = useQuery<Sources>('list_sources', {});
  const scopes = useQuery<{ items: { scopeRef: string; actorId: string; label: string; sources: { key: string; label: string }[]; createdAt: string; revokedAt: string | null }[] }>('list_scopes', {});
  const pause = useSave<unknown>('pause_source');
  const step = useSave<{ summary: string }>('continue_import');
  const remove = useSave<unknown>('delete_source_data');
  const configure = useSave<unknown>('configure_source');
  const revoke = useSave<unknown>('revoke_scope');
  const announce = useAnnounce();
  const reviewRef = useRef<HTMLElement>(null);
  const importRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sources.data) return;
    if (ui.route.query.panel === 'review') reviewRef.current?.scrollIntoView({ block: 'start' });
    if (ui.route.query.panel === 'import') importRef.current?.scrollIntoView({ block: 'start' });
  }, [ui.route.query.panel, !!sources.data]);
  if (sources.error && !sources.data) return <Failure error={sources.error} reload={sources.reload} />;
  if (!sources.data) return <Loading label="Loading sources" />;
  const data = sources.data;
  const local = (instant: string | null) => (instant ? localDate(instant, zone) : null);
  const accounts: SourceAccount[] = data.accounts.map((item) => ({
    id: `${item.source}|${item.kind}`, label: item.label, detail: item.kind === 'calendar' ? `${item.calendars.length || 1} calendar${item.calendars.length > 1 ? 's' : ''}` : `${item.records} conversation${item.records === 1 ? '' : 's'} kept`,
    kind: item.kind, granted: item.granted, automatic: item.automatic,
    status: (item.status === 'disconnected' ? 'reconnect' : item.status) as SourceAccount['status'],
    coverage: item.coverage.from ? { from: local(item.coverage.from)!, to: local(item.coverage.to ?? new Date().toISOString())!, partial: item.coverage.partial } : undefined,
    historyDays: ([30, 90, 365].includes(item.historyDays) ? item.historyDays : 90) as HistoryDays, lastSuccessAt: item.lastSuccessAt, pending: item.pending, failed: item.failed, error: item.lastError,
  }));
  const source = (id: string) => id.split('|')[0]!;
  const account = (id: string) => data.accounts.find((item) => `${item.source}|${item.kind}` === id)!;
  const reload = () => { void sources.reload(); void scopes.reload(); };
  return (
    <div className="pe-stack pe-stack--loose">
      <SourcesScreen
        accounts={accounts}
        imports={data.imports.map((item) => ({ id: item.source, name: item.label, kind: item.format === 'linkedin' ? 'LinkedIn export' : item.format === 'vcard' ? 'vCard' : 'CSV', importedAt: item.importedAt, records: (item.counts.created ?? 0) + (item.counts.updated ?? 0) + (item.counts.merged ?? 0), status: 'imported' }))}
        shares={(scopes.data?.items ?? []).filter((item) => !item.revokedAt).map((item) => ({ id: item.scopeRef, label: item.label, actor: item.actorId.startsWith('chat:') ? 'A chat' : item.actorId, sources: item.sources.map((entry) => entry.label), createdAt: item.createdAt }))}
        onConnect={() => app.openSources()}
        onManageAccess={() => app.manageAccess()}
        onPause={async (id) => { await pause.run({ account: account(id).account, paused: true }); pause.reset(); reload(); }}
        onResume={async (id) => { await pause.run({ account: account(id).account, paused: false }); pause.reset(); reload(); }}
        onContinue={async (id) => { const result = await step.run({ source: source(id) }); step.reset(); announce(result.summary); reload(); }}
        onDeleteImported={async (id) => { await remove.run({ source: source(id), confirm: true }); remove.reset(); announce('Imported data deleted. Your notes were kept'); reload(); }}
        onChangeHistory={async (id, days) => { const item = account(id); await configure.run({ account: item.account, kind: item.kind, historyDays: days }); configure.reset(); reload(); }}
        onRevokeShare={async (id) => { await revoke.run({ scopeRef: id }); revoke.reset(); reload(); }}
        note={<>People reads sent mail, replies and small meetings to find the people you actually correspond with. Bulk, list and no-reply mail is left out before anything else happens, and nothing is ever sent or changed in your accounts. {data.accounts.length ? '' : 'Without an account, add people by hand or import a file.'}</>}
      />
      <Extraction data={data} reload={reload} />
      <div ref={importRef} className="pe-anchor"><Imports reload={reload} collections={data.collections} /></div>
      <section ref={reviewRef} className="pe-stack" aria-labelledby="pe-review-heading" tabIndex={-1}>
        <h2 id="pe-review-heading" className="ri-h2">Identity review</h2>
        <p className="pe-small pe-muted">Possible duplicates, addresses seen in signatures and incoming-only senders. Nothing is merged or added automatically.</p>
        <Reviews reload={reload} />
      </section>
      <LeftOut data={data} reload={reload} />
      <Collections data={data} reload={reload} />
      <ExportPanel />
      {data.failedItems.length > 0 && (
        <section className="pe-stack" aria-label="Held failures">
          <h2 className="ri-h2">Held failures</h2>
          <ul className="pe-list">{data.failedItems.map((item) => <li key={item.id} className="pe-small">{item.kind === 'extract' ? 'Extraction' : item.kind === 'briefing' ? 'Briefing' : 'Linking'} for {item.source}: {item.reason} <span className="pe-muted">({dayLabel(item.at)})</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Extraction({ data, reload }: { data: Sources; reload(): void }) {
  const [confirm, setConfirm] = useState(false);
  const toggle = useSave<{ status: string }>('set_extraction');
  const { openSources } = useRiApp();
  const announce = useAnnounce();
  const on = data.extraction.status === 'on';
  return (
    <section className="pe-stack" aria-labelledby="pe-extract-heading">
      <div className="pe-source-row">
        <div className="pe-stack" style={{ gap: '0.25rem' }}>
          <h2 id="pe-extract-heading" className="ri-h3">Extract relationship context</h2>
          <p className="pe-small pe-muted">Finds sourced facts and possible commitments in new relevant conversations, each with its exact passage. Separate from sync. Manual records, timelines, search and briefings from saved records all work without it.</p>
          <div className="pe-row">
            <StatusLabel tone={on ? 'success' : data.extraction.status === 'unavailable' ? 'warning' : 'neutral'}>{on ? 'On' : data.extraction.status === 'unavailable' ? 'Extraction unavailable' : data.extraction.status === 'paused' ? 'Paused' : 'Off'}</StatusLabel>
            {on && <span className="pe-small pe-muted">{data.extraction.pending} waiting · {data.extraction.failed} held · {data.extraction.briefingsPending} briefing{data.extraction.briefingsPending === 1 ? '' : 's'} queued</span>}
          </div>
          {data.extraction.reason && <p className="pe-small">{data.extraction.reason}</p>}
        </div>
        <ButtonRow>
          {on ? <Button busy={toggle.pending} onClick={async () => { await toggle.run({ enabled: false }); toggle.reset(); announce('Extraction paused. Queued work was cancelled. Sync continues'); reload(); }}>Pause extraction</Button>
            : <Button variant="primary" onClick={() => setConfirm(true)}>{data.extraction.status === 'unavailable' ? 'Try again' : 'Enable extraction'}</Button>}
          {data.extraction.status === 'unavailable' && <Button variant="quiet" onClick={() => void openSources()}>Allow AI in Ri</Button>}
        </ButtonRow>
      </div>
      <Dialog open={confirm} title="Enable relationship extraction" onClose={() => setConfirm(false)}
        footer={<ButtonRow align="end"><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" busy={toggle.pending} onClick={async () => { await toggle.run({ enabled: true }); toggle.reset(); setConfirm(false); announce('Extraction enabled'); reload(); }}>Enable</Button></ButtonRow>}>
        <div className="pe-stack">
          <p>Ri will process bounded excerpts of new relevant conversations from the accounts you granted to People: direct mail with people you know, never bulk or list mail. Each excerpt is marked as untrusted text and checked against a strict format.</p>
          <p>Results are suggestions with their exact passages. Nothing becomes a commitment, task or company link until you choose, and nothing is ever sent.</p>
          <p className="pe-small pe-muted">This uses Ri's separately allowed bounded AI. Read-only sync stays on its own switch. Pause any time.</p>
        </div>
      </Dialog>
    </section>
  );
}

interface Preview {
  previewId: string; digest: string; format: string; fileName: string; counts: { create: number; update: number; proposedMerge: number; skipped: number; unsupported: number };
  rows: { row: number; name: string | null; emails: string[]; company: string | null; role: string | null; action: string; reason: string | null; match: { id: string; name: string } | null; candidates: { id: string; name: string }[] }[];
  moreRows: number; companies: { key: string; name: string; action: string; organization: { id: string; name: string } | null; candidates: { id: string; name: string }[] }[];
  unmapped: string[]; note: string; previouslyImported: string | null;
}
function Imports({ reload, collections }: { reload(): void; collections: { key: string; label: string }[] }) {
  const app = useRiApp();
  const preview = useSave<Preview & { status?: string }>('preview_import');
  const apply = useSave<{ status: string; label: string; counts: Record<string, number> }>('apply_import');
  const [plan, setPlan] = useState<Preview | null>(null);
  const [collection, setCollection] = useState('manual');
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [companyDecisions, setCompanyDecisions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  const choose = async () => {
    setError(null);
    try {
      const file = await app.selectFile();
      if (!file) return;
      const result = await preview.run({ fileName: file.name, mimeType: file.mimeType || 'text/csv', base64: file.base64, format: 'auto', collection });
      preview.reset();
      setPlan(result); setDecisions({}); setCompanyDecisions({});
    } catch (failure) { setError((failure as Error).message); preview.reset(); }
  };
  return (
    <section className="pe-stack" aria-labelledby="pe-import-heading">
      <div className="pe-source-row">
        <div className="pe-stack" style={{ gap: '0.25rem' }}>
          <h2 id="pe-import-heading" className="ri-h3">Import contacts</h2>
          <p className="pe-small pe-muted">CSV, vCard or a LinkedIn connections export, up to 512 KiB. You review every row before anything is written. Imported roles keep their date and are never treated as current employment.</p>
        </div>
        <ButtonRow>
          {collections.length > 1 && <Select hideLabel label="Collection" value={collection} onChange={setCollection} options={collections.map((item) => ({ value: item.key, label: item.label }))} />}
          <Button onClick={() => void choose()} busy={preview.pending}>Choose file</Button>
        </ButtonRow>
      </div>
      {error && <InlineError>{error}</InlineError>}
      <Dialog open={!!plan} wide title={`Review ${plan?.fileName ?? 'import'}`} description={plan ? `${plan.counts.create} new, ${plan.counts.update} updates, ${plan.counts.proposedMerge} possible duplicates, ${plan.counts.skipped} skipped, ${plan.counts.unsupported} unsupported` : undefined} onClose={() => setPlan(null)}
        footer={<ButtonRow align="end"><Button onClick={() => setPlan(null)}>Cancel</Button><Button variant="primary" busy={apply.pending} disabled={!plan || plan.counts.create + plan.counts.update + plan.counts.proposedMerge === 0} onClick={async () => {
          const result = await apply.run({ previewId: plan!.previewId, digest: plan!.digest, decisions: Object.entries(decisions).map(([row, value]) => value.startsWith('merge:') ? { row: Number(row), action: 'merge', personId: value.slice(6) } : { row: Number(row), action: value }), companyDecisions: Object.entries(companyDecisions).map(([key, value]) => value.startsWith('existing:') ? { key, action: 'existing', organizationId: value.slice(9) } : { key, action: value }) });
          apply.reset(); setPlan(null); announce(`Imported as ${result.label}`); reload();
        }}>Import</Button></ButtonRow>}>
        {plan && (
          <div className="pe-stack">
            {plan.previouslyImported && <Notice tone="info">{plan.previouslyImported}. Rows already imported with the same details are skipped.</Notice>}
            <p className="pe-small pe-muted">{plan.note}</p>
            <div className="pe-import-table">
              <DataTable caption="Rows" rows={plan.rows} rowKey={(row) => String(row.row)} columns={[
                { key: 'row', label: 'Row', render: (row) => String(row.row) },
                { key: 'name', label: 'Name', render: (row) => row.name ?? <span className="pe-unavailable">Not provided</span> },
                { key: 'company', label: 'Company / role', render: (row) => [row.company, row.role].filter(Boolean).join(' · ') || <span className="pe-unavailable">Not provided</span> },
                { key: 'action', label: 'Plan', render: (row) => row.action === 'proposed_merge' ? (
                  <Select hideLabel label={`Plan for row ${row.row}`} value={decisions[row.row] ?? 'create'} onChange={(value) => setDecisions((current) => ({ ...current, [row.row]: value }))} options={[{ value: 'create', label: 'Keep separate' }, ...row.candidates.map((candidate) => ({ value: `merge:${candidate.id}`, label: `Same as ${candidate.name}` })), { value: 'skip', label: 'Skip' }]} />
                ) : row.action === 'create' || row.action === 'update' ? (
                  <Select hideLabel label={`Plan for row ${row.row}`} value={decisions[row.row] ?? row.action} onChange={(value) => setDecisions((current) => ({ ...current, [row.row]: value }))} options={[{ value: row.action, label: row.action === 'create' ? 'Add' : `Update ${row.match?.name ?? ''}`.trim() }, { value: 'skip', label: 'Skip' }]} />
                ) : <span className="pe-muted">{row.reason ?? row.action}</span> },
              ]} />
            </div>
            {plan.moreRows > 0 && <p className="pe-small pe-muted">{plan.moreRows} more rows follow the same plan.</p>}
            {plan.companies.length > 0 && (
              <fieldset className="ri-fieldset"><legend>Companies</legend>
                {plan.companies.map((company) => (
                  <Select key={company.key} label={company.name} value={companyDecisions[company.key] ?? (company.organization ? `existing:${company.organization.id}` : 'new')} onChange={(value) => setCompanyDecisions((current) => ({ ...current, [company.key]: value }))}
                    options={[{ value: 'new', label: 'New provisional company' }, ...company.candidates.map((candidate) => ({ value: `existing:${candidate.id}`, label: `Existing ${candidate.name} (matched by name)` })), { value: 'none', label: 'Do not record a company' }]} />
                ))}
              </fieldset>
            )}
            {plan.unmapped.length > 0 && <p className="pe-small pe-muted">Kept but not mapped: {plan.unmapped.join(', ')}.</p>}
            {apply.error && <InlineError>{apply.error}</InlineError>}
          </div>
        )}
      </Dialog>
    </section>
  );
}

export function Reviews({ reload }: { reload(): void }) {
  const ui = usePeople();
  const reviews = useQuery<{ items: Review[] }>('list_reviews', { limit: 20 });
  const resolve = useSave<{ status: string }>('resolve_identity');
  const announce = useAnnounce();
  const [merging, setMerging] = useState<Review | null>(null);
  if (reviews.error && !reviews.data) return <Failure error={reviews.error} reload={reviews.reload} />;
  if (!reviews.data) return <Loading label="Loading reviews" />;
  if (!reviews.data.items.length) return <EmptyState compact headingLevel={3} title="Nothing to review">Possible duplicates and new addresses appear here with their evidence.</EmptyState>;
  const decide = async (review: Review, decision: string, done: string) => { await resolve.run({ reviewId: review.id, expectedRevision: review.revision, decision }); resolve.reset(); announce(done); void reviews.reload(); reload(); };
  return (
    <ul className="pe-stack">
      {reviews.data.items.map((review) => (
        <li key={review.id} className="pe-review">
          <p>{review.summary}</p>
          <div className="pe-review__records">
            <div className="pe-review__record"><strong>{review.left.name}</strong><div className="pe-small pe-muted">{review.left.detail ?? 'No address recorded'}</div></div>
            {review.right && <div className="pe-review__record"><strong>{review.right.name}</strong><div className="pe-small pe-muted">{review.right.detail ?? 'No address recorded'}</div></div>}
            {review.kind === 'alias' && review.identifier && <div className="pe-review__record"><strong>{review.identifier}</strong><div className="pe-small pe-muted">Seen in a signature</div></div>}
          </div>
          {review.passage && <blockquote className="pe-quote">{review.passage}</blockquote>}
          <ButtonRow>
            {review.evidenceIds[0] && <Button size="sm" variant="link" onClick={() => ui.showEvidence(review.evidenceIds[0]!, review.passage)}>View evidence</Button>}
            {(review.kind === 'person' || review.kind === 'organization') && <><Button size="sm" onClick={() => setMerging(review)}>Merge</Button><Button size="sm" variant="quiet" busy={resolve.pending} onClick={() => void decide(review, 'keep_separate', 'Kept separate. This pair will not be proposed again')}>Keep separate</Button></>}
            {review.kind === 'alias' && <><Button size="sm" onClick={() => void decide(review, 'accept', 'Address added')}>Add address</Button><Button size="sm" variant="quiet" onClick={() => void decide(review, 'reject', 'Not added')}>Not theirs</Button></>}
            {review.kind === 'sender' && <><Button size="sm" onClick={() => void decide(review, 'include', 'Included as a person')}>Include as a person</Button><Button size="sm" variant="quiet" onClick={() => void decide(review, 'exclude', 'Kept out')}>Keep out</Button></>}
          </ButtonRow>
        </li>
      ))}
      {merging && <MergeDialog review={merging} onClose={() => { setMerging(null); void reviews.reload(); reload(); }} />}
    </ul>
  );
}

function MergeDialog({ review, onClose }: { review: Review; onClose(): void }) {
  const kind = review.kind === 'organization' ? 'organization' : 'person';
  const left = useQuery<{ person?: { revision: number }; organization?: { revision: number } }>(kind === 'person' ? 'get_person' : 'get_organization', { id: review.left.id }, { keepPrevious: false });
  const right = useQuery<{ person?: { revision: number }; organization?: { revision: number } }>(kind === 'person' ? 'get_person' : 'get_organization', { id: review.right!.id }, { keepPrevious: false });
  const [survivor, setSurvivor] = useState(review.left.id);
  const merge = useSave<{ status: string; message: string | null }>(kind === 'person' ? 'merge_people' : 'merge_organizations');
  const [message, setMessage] = useState<string | null>(null);
  const announce = useAnnounce();
  const rev = (value: typeof left.data) => (value?.person ?? value?.organization)?.revision ?? 0;
  return (
    <Dialog open title="Merge these records" description="Every moved reference is recorded so you can undo the merge. The other record and its evidence are kept." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={merge.pending} disabled={!left.data || !right.data} onClick={async () => {
        const mergedId = survivor === review.left.id ? review.right!.id : review.left.id;
        const result = await merge.run({ survivorId: survivor, mergedId, survivorRevision: rev(survivor === review.left.id ? left.data : right.data), mergedRevision: rev(survivor === review.left.id ? right.data : left.data), reviewId: review.id });
        merge.reset();
        if (result.status === 'conflict') { setMessage(result.message); void left.reload(); void right.reload(); return; }
        announce('Merged. Undo is available on the record');
        onClose();
      }}>Merge</Button></ButtonRow>}>
      <div className="pe-stack">
        {message && <Notice tone="warning">{message}</Notice>}
        <Select label="Keep this record's name and details" value={survivor} onChange={setSurvivor} options={[{ value: review.left.id, label: review.left.name }, { value: review.right!.id, label: review.right!.name }]} />
        <p className="pe-small pe-muted">{review.summary}</p>
      </div>
    </Dialog>
  );
}

function LeftOut({ data, reload }: { data: Sources; reload(): void }) {
  const [filter, setFilter] = useState<'auto' | 'excluded' | 'included' | 'suppressed'>('auto');
  const list = useQuery<{ items: { id: string; kind: 'sender' | 'domain'; value: string; decision: string; reason: string; seenCount: number; lastSeenAt: string | null }[] }>('list_exclusions', { decision: filter, limit: 50 });
  const save = useSave<unknown>('save_exclusion');
  const [value, setValue] = useState('');
  const announce = useAnnounce();
  const act = async (target: string, kind: 'sender' | 'domain', decision: string, done: string) => { await save.run({ value: target, kind, decision }); save.reset(); announce(done); void list.reload(); reload(); };
  return (
    <section className="pe-stack" aria-labelledby="pe-leftout-heading">
      <h2 id="pe-leftout-heading" className="ri-h2">Left out of relationships</h2>
      <p className="pe-small pe-muted">{data.exclusions.bulk} bulk or automated sender{data.exclusions.bulk === 1 ? '' : 's'}, {data.largeEvents} large event{data.largeEvents === 1 ? '' : 's'} and {data.incomingOnly} incoming-only sender{data.incomingOnly === 1 ? '' : 's'} were not added. Your exclusions persist across syncs.</p>
      <div className="pe-row">
        <Select hideLabel label="Show" value={filter} onChange={(next) => setFilter(next as typeof filter)} options={[{ value: 'auto', label: `Left out automatically (${data.exclusions.bulk})` }, { value: 'excluded', label: `Excluded by you (${data.exclusions.excluded})` }, { value: 'included', label: `Included by you (${data.exclusions.included})` }, { value: 'suppressed', label: `Not rediscovered (${data.exclusions.suppressed})` }]} />
        <TextInput hideLabel label="Sender or domain to exclude" placeholder="news@example.com or example.com" value={value} onChange={setValue} />
        <Button disabled={!value.trim()} onClick={() => { void act(value.trim(), value.includes('@') ? 'sender' : 'domain', 'excluded', 'Excluded'); setValue(''); }}>Exclude</Button>
      </div>
      {list.data && (list.data.items.length ? (
        <ul className="pe-list">
          {list.data.items.map((item) => (
            <li key={item.id} className="pe-row pe-between">
              <span><strong>{item.value}</strong> <span className="pe-small pe-muted">· {item.reason}{item.seenCount ? ` · seen ${item.seenCount} time${item.seenCount === 1 ? '' : 's'}` : ''}{item.lastSeenAt ? ` · last ${dayLabel(item.lastSeenAt)}` : ''}</span></span>
              <ButtonRow>
                {item.decision !== 'included' && <Button size="sm" onClick={() => void act(item.value, item.kind, 'included', 'Included. Future mail from them is used')}>Include</Button>}
                {item.decision !== 'excluded' && item.decision !== 'suppressed' && <Button size="sm" variant="quiet" onClick={() => void act(item.value, item.kind, 'excluded', 'Excluded')}>Exclude</Button>}
                {item.decision !== 'auto' && <Button size="sm" variant="quiet" onClick={() => void act(item.value, item.kind, 'clear', 'Decision cleared')}>Clear</Button>}
              </ButtonRow>
            </li>
          ))}
        </ul>
      ) : <p className="pe-small pe-muted">Nothing here.</p>)}
    </section>
  );
}

function Collections({ data, reload }: { data: Sources; reload(): void }) {
  const [label, setLabel] = useState('');
  const save = useSave<{ key: string }>('save_collection');
  const announce = useAnnounce();
  return (
    <section className="pe-stack" aria-labelledby="pe-collections-heading">
      <h2 id="pe-collections-heading" className="ri-h2">Collections</h2>
      <p className="pe-small pe-muted">Your own records live in collections. You can share a collection with a chat separately from your accounts.</p>
      <div className="pe-row">{data.collections.map((item) => <span key={item.key} className="pe-pill">{item.label}</span>)}</div>
      <div className="pe-row">
        <TextInput hideLabel label="New collection name" placeholder="Such as Work or Family" value={label} onChange={setLabel} />
        <Button disabled={!label.trim()} busy={save.pending} onClick={async () => { await save.run({ label: label.trim() }); save.reset(); setLabel(''); announce('Collection added'); reload(); }}>Add collection</Button>
      </div>
    </section>
  );
}

const TABLES = [
  ['people', 'People'], ['companies', 'Companies'], ['affiliations', 'Affiliations'], ['lists', 'Lists'], ['opportunities', 'Opportunities'], ['stages', 'Stages'], ['stage_history', 'Stage history'], ['notes', 'Notes'], ['evidence', 'Evidence references'], ['decisions', 'Corrections and decisions'],
] as const;
function ExportPanel() {
  const app = useRiApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  const run = async (table: string) => {
    setBusy(table); setError(null);
    try {
      let cursor: string | null = null, part = 0;
      do {
        const result: { fileName: string; mimeType: string; content: string; nextCursor: string | null } = await app.call('export_records', { table, ...(cursor ? { cursor } : {}) });
        part++;
        await app.download({ name: part > 1 ? result.fileName.replace(/(\.\w+)$/, `-${part}$1`) : result.fileName, mimeType: result.mimeType, text: result.content });
        cursor = result.nextCursor;
      } while (cursor && part < 40);
      announce('Export ready');
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(null); }
  };
  return (
    <section className="pe-stack" aria-labelledby="pe-export-heading">
      <h2 id="pe-export-heading" className="ri-h2">Export</h2>
      <p className="pe-small pe-muted">CSV and JSON files with stable IDs and a format version. Message bodies are never exported. This is not a full backup: a whole Ri backup keeps everything, including sources and decisions.</p>
      <div className="pe-row">{TABLES.map(([table, label]) => <Button key={table} size="sm" busy={busy === table} onClick={() => void run(table)}>{label}</Button>)}</div>
      {error && <InlineError>{error}</InlineError>}
    </section>
  );
}

export function AccessView() {
  const ui = usePeople();
  const create = useSave<{ scopeRef: string }>('create_scope');
  const [done, setDone] = useState(false);
  const access = ui.data.access;
  if (!access) return <Failure error="Open this from Ri's access dialog for a chat." />;
  if (done) return <EmptyState title="Access chosen">Ri saves it when you confirm the grant. You can change or remove it later in Sources or in Ri.</EmptyState>;
  return (
    <ShareScopeChooser
      actorLabel="this chat"
      sources={access.sources.map((source) => ({ id: source.key, label: source.label, textLabel: source.label, description: source.detail }))}
      operations={[{ id: 'read', label: 'Read these records', description: 'People, companies, timelines, notes and briefings from the chosen sources' }, { id: 'write', label: 'Add and change records', description: 'Notes, follow-ups, lists and opportunities in a chosen collection. Merges, imports and sources stay yours' }]}
      busy={create.pending}
      error={create.error}
      onCreate={async (sources, operations) => { await create.run({ actorId: access.actorId, sources, operations }); setDone(true); }}
    />
  );
}
export { updatedLabel };
