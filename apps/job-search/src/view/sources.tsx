/** @jsxRuntime automatic */
import { useEffect, useState } from 'react';
import {
  Button, ButtonRow, Checkbox, EmptyState, ErrorState, InlineError, LoadingState, Notice, ReviewCompare, Select, SourcesScreen, StatusLabel, TextInput,
  useAnnounce, useMutation, useQuery, useRiApp, type SourceAccount, type SourceStatus,
} from '@ri/app-kit/ui';
import { stageLabel, STAGE_LABELS } from '../domain/labels.js';
import type { Location } from './app.js';
import type { ListResult, OpportunityList, ReviewItem, ScopeRecord, SourceSummary, StepSummary, Write } from './types.js';
import { classificationText, dayOf, errorText, mediumDate, shortDate, stageText } from './format.js';

type Go = (patch: Partial<Location>) => void;
const STATUSES: SourceStatus[] = ['ready', 'importing', 'paused', 'reconnect', 'error', 'not_started'];

export function SourcesView({ owner, go }: { owner: boolean; go: Go }) {
  const app = useRiApp();
  useEffect(() => { app.context({ section: 'sources' }); }, [app]);
  return (
    <div className="ri-stack ri-stack--loose">
      <ReviewQueue go={go} />
      {owner ? <Accounts /> : <Notice tone="info" title="Sources are managed by the person who owns this app" />}
    </div>
  );
}

// ─── Review ──────────────────────────────────────────────────────────────────

function ReviewQueue({ go }: { go: Go }) {
  const review = useQuery<ListResult<ReviewItem>>('list_review', { limit: 50 });
  if (review.error && !review.data) return <ErrorState message={review.error} onRetry={review.reload} />;
  if (!review.data) return <LoadingState label="Loading items to review" rows={2} />;
  const items = review.data.items;
  return (
    <section className="ri-stack" aria-labelledby="js-review-title">
      <div className="ri-section-heading">
        <h2 id="js-review-title" className="ri-h2">Matching review</h2>
        <p>{items.length ? 'Nothing changes until you decide. Related messages are grouped by thread.' : ''}</p>
      </div>
      {items.length === 0 ? (
        <p className="ri-muted">Nothing to review. Email and calendar evidence that could belong to more than one role, or that suggests a stage, will wait here for you.</p>
      ) : <div className="js-review-list">{items.map((item) => <ReviewCard key={item.id} item={item} onDone={review.reload} go={go} />)}</div>}
    </section>
  );
}

function ReviewCard({ item, onDone, go }: { item: ReviewItem; onDone: () => void; go: Go }) {
  const announce = useAnnounce();
  const resolve = useMutation<Record<string, unknown>, Write<{ review: ReviewItem; opportunityId: string | null }>>('resolve_match');
  const opportunities = useQuery<OpportunityList>('list_opportunities', { limit: 100, view: 'all' }, { enabled: item.kind !== 'stage' });
  const [applyStage, setApplyStage] = useState(Boolean(item.proposal.stage));
  const [company, setCompany] = useState(item.proposal.company ?? '');
  const [role, setRole] = useState(item.proposal.role ?? '');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const proposed = item.proposal.stage ? stageLabel(item.proposal.stage, item.proposal.outcome) : null;
  const decide = async (key: string, input: Record<string, unknown>, done: string) => {
    setBusy(key);
    setError(null);
    try {
      const result = await resolve.run({ reviewId: item.id, expectedRevision: item.revision, ...input });
      resolve.reset();
      if (result.status === 'conflict') { setError(result.message); onDone(); return; }
      announce(done);
      onDone();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };
  const evidence = (
    <div className="ri-stack ri-stack--tight">
      {item.evidence.map((message) => (
        <div key={message.id} className="ri-stack ri-stack--tight">
          <p className="ri-small"><strong>{message.subject || 'No subject'}</strong> <span className="ri-muted">· {message.from ?? 'Unknown sender'} · {mediumDate(message.receivedAt)} · {classificationText(message.classification)}</span></p>
          {message.unavailable ? <p className="ri-small ri-muted">Source unavailable. It was deleted or moved at the source</p> : <blockquote className="js-quote">{message.excerpt}</blockquote>}
        </div>
      ))}
    </div>
  );

  if (item.kind === 'stage') {
    const current = item.candidates[0];
    return (
      <ReviewCompare
        title={item.title}
        reason={item.summary}
        rows={[{ label: 'Stage', before: current ? stageText(current.stage, null) : 'Current stage', after: proposed ?? 'No change' }]}
        evidence={<>{evidence}{item.opportunityId && <Button variant="link" size="sm" onClick={() => go({ tab: 'opportunities', opportunityId: item.opportunityId, selected: item.opportunityId })}>Open the opportunity</Button>}{error && <InlineError>{error}</InlineError>}</>}
        acceptLabel={proposed ? `Use ${proposed}` : 'Accept'}
        busy={busy === 'accept' ? 'accept' : busy === 'keep' ? 'dismiss' : null}
        onAccept={() => decide('accept', { decision: 'accept_stage' }, `Moved to ${proposed}`)}
        onDismiss={() => decide('keep', { decision: 'keep_stage' }, 'Kept your stage')}
        beforeLabel="Recorded"
        afterLabel="Suggested"
      />
    );
  }

  const choices = (opportunities.data?.items ?? []).filter((opportunity) => !item.candidates.some((candidate) => candidate.opportunityId === opportunity.id));
  return (
    <article className="js-panel" aria-labelledby={`js-review-${item.id}`}>
      <div className="ri-section-heading">
        <h3 id={`js-review-${item.id}`} className="ri-h3">{item.title}</h3>
        <StatusLabel tone="warning">{item.kind === 'new_opportunity' ? 'No matching role' : 'Which role?'}</StatusLabel>
      </div>
      <p className="ri-small">{item.summary}</p>
      {evidence}
      {proposed && (
        <Checkbox label={`Also move the chosen role to ${proposed}`} hint="Leave this off to only link the evidence" checked={applyStage} onChange={setApplyStage} />
      )}
      {item.candidates.length > 0 && (
        <div className="ri-stack ri-stack--tight" role="group" aria-label="Candidate roles">
          {item.candidates.map((candidate) => (
            <div key={candidate.opportunityId} className="js-candidate">
              <div className="ri-section-heading">
                <p><strong>{candidate.company} · {candidate.role}</strong> <span className="ri-small ri-muted">{STAGE_LABELS[candidate.stage]}</span></p>
                <Button size="sm" variant="primary" busy={busy === candidate.opportunityId} onClick={() => void decide(candidate.opportunityId, { decision: 'attach', opportunityId: candidate.opportunityId, applyStage }, `Attached to ${candidate.company}`)}>Attach to this role</Button>
              </div>
              <ul className="js-evidence" aria-label={`Evidence for ${candidate.company} ${candidate.role}`}>
                {candidate.evidence.map((entry, index) => <li key={index} className="js-tag">{entry.detail}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {item.kind === 'new_opportunity' && (
        <div className="ri-stack ri-stack--tight">
          <div className="js-fields">
            <TextInput label="Company" value={company} onChange={setCompany} />
            <TextInput label="Role" value={role} onChange={setRole} />
          </div>
          <ButtonRow><Button variant="primary" busy={busy === 'create'} onClick={() => { if (!company.trim() || !role.trim()) return setError('Add the company and the role'); void decide('create', { decision: 'create', company: company.trim(), role: role.trim(), applyStage }, `${company} added`); }}>Add as an opportunity</Button></ButtonRow>
        </div>
      )}
      {choices.length > 0 && (
        <div className="js-toolbar-row">
          <Select label="Or attach to another role" value={other} onChange={setOther} placeholder="Choose a role" options={choices.map((opportunity) => ({ value: opportunity.id, label: `${opportunity.company} · ${opportunity.role}` }))} />
          <Button busy={busy === 'other'} disabled={!other} onClick={() => void decide('other', { decision: 'attach', opportunityId: other, applyStage }, 'Attached')}>Attach</Button>
        </div>
      )}
      <ButtonRow>
        <Button variant="quiet" busy={busy === 'ignore'} onClick={() => void decide('ignore', { decision: 'ignore' }, 'Ignored. Later messages in this thread stay quiet')}>Ignore</Button>
      </ButtonRow>
      <InlineError>{error}</InlineError>
    </article>
  );
}

// ─── Accounts, files and access ─────────────────────────────────────────────

function Accounts() {
  const app = useRiApp();
  const announce = useAnnounce();
  const sources = useQuery<{ sources: SourceSummary[] }>('list_sources', {});
  const imports = useQuery<{ items: { id: string; name: string; kind: string; importedAt: string; records: number; status: string }[] }>('list_imports', {});
  const scopes = useQuery<{ scopes: ScopeRecord[] }>('list_scopes', {});
  const set = useMutation<Record<string, unknown>, { source: SourceSummary }>('set_source');
  const step = useMutation<Record<string, unknown>, StepSummary>('continue_import');
  const remove = useMutation<Record<string, unknown>, unknown>('delete_source_data');
  const removeImport = useMutation<Record<string, unknown>, { message: string }>('delete_import');
  const revoke = useMutation<Record<string, unknown>, unknown>('revoke_scope');
  const exporter = useMutation<Record<string, unknown>, { fileName: string; mimeType: string; text: string; opportunities: number; materials: number }>('export_records');
  const [exportError, setExportError] = useState<string | null>(null);
  if (sources.error && !sources.data) return <ErrorState message={sources.error} onRetry={sources.reload} />;
  if (!sources.data) return <LoadingState label="Loading sources" rows={2} />;
  const all = sources.data.sources;
  const accounts = all.filter((source) => source.kind !== 'collection');
  const byId = new Map(accounts.map((source) => [`${source.kind}:${source.account}`, source]));
  const kitAccounts: SourceAccount[] = accounts.map((source) => ({
    id: `${source.kind}:${source.account}`,
    label: source.label,
    detail: source.kind === 'calendar' ? (source.calendars.length ? `Calendars: ${source.calendars.join(', ')}` : 'Primary calendar') : 'Application, recruiter, interview and offer mail, received and sent',
    kind: source.kind as 'mail' | 'calendar',
    granted: source.granted,
    automatic: source.automatic && !source.paused,
    status: (STATUSES.includes(source.status as SourceStatus) ? source.status : source.granted ? 'not_started' : 'paused') as SourceStatus,
    coverage: source.coverage.from && source.coverage.to ? { from: dayOf(source.coverage.from), to: dayOf(source.coverage.to), partial: source.coverage.partial } : undefined,
    historyDays: (source.historyDays === 30 || source.historyDays === 90 || source.historyDays === 365 ? source.historyDays : undefined),
    lastSuccessAt: source.lastSuccessAt,
    pending: source.pending,
    failed: source.failed,
    error: source.lastError,
  }));
  const target = (id: string) => byId.get(id)!;
  const labels = new Map(all.map((source) => [source.key, source.label]));
  const calendars = accounts.filter((source) => source.kind === 'calendar' && source.granted);
  const mailboxes = accounts.filter((source) => source.kind === 'mail' && source.granted);
  return (
    <div className="ri-stack ri-stack--loose">
      <SourcesScreen
        accounts={kitAccounts}
        imports={imports.data?.items ?? []}
        shares={(scopes.data?.scopes ?? []).filter((scope) => !scope.revokedAt).map((scope) => ({ id: scope.id, label: scope.label, actor: scope.actorId.startsWith('chat:') ? 'A Ri chat' : scope.actorId.startsWith('workspace:') ? 'A Ri agent' : 'A scheduled caller', sources: scope.sources.map((source) => labels.get(source) ?? 'A removed source'), createdAt: scope.createdAt }))}
        onConnect={() => app.openSources()}
        onManageAccess={() => app.manageAccess()}
        onPause={async (id) => { await set.run({ account: target(id).account, kind: target(id).kind, paused: true }); set.reset(); sources.reload(); }}
        onResume={async (id) => {
          const source = target(id);
          if (source.paused) { await set.run({ account: source.account, kind: source.kind, paused: false }); set.reset(); sources.reload(); }
          else await app.openSources();
        }}
        onContinue={async (id) => { const result = await step.run({ source: target(id).key }); step.reset(); announce(result.message); sources.reload(); }}
        onDeleteImported={async (id) => {
          if (byId.has(id)) { await remove.run({ source: target(id).key, confirm: 'delete' }); remove.reset(); }
          else { const result = await removeImport.run({ id, confirm: 'delete' }); removeImport.reset(); announce(result.message); imports.reload(); }
          sources.reload();
        }}
        onChangeHistory={async (id, days) => { await set.run({ account: target(id).account, kind: target(id).kind, historyDays: days }); set.reset(); sources.reload(); }}
        onRevokeShare={async (id) => { await revoke.run({ scopeRef: id }); revoke.reset(); scopes.reload(); }}
        note={<p>Job Search reads only the accounts you grant. Email covers application, recruiter, interview and offer messages, including ones you sent. Calendar access is chosen separately and is used only to find interviews. Nothing is ever sent from this app.</p>}
      />
      {mailboxes.map((source) => <MailPreview key={source.key} source={source} />)}
      {calendars.map((source) => <CalendarChoice key={source.key} source={source} onSaved={sources.reload} />)}
      <section className="js-panel" aria-labelledby="js-export-title">
        <h2 id="js-export-title" className="js-panel__title">Your records</h2>
        <p className="ri-small ri-muted">{all.filter((source) => source.kind === 'collection').map((source) => `${source.label}: ${source.records}`).join(' · ')}</p>
        <p className="ri-small">Download your opportunities, stage history, descriptions, interviews, submissions, preparation and materials as a JSON file. Email bodies are not included.</p>
        <ButtonRow>
          <Button busy={exporter.pending} busyLabel="Preparing export" onClick={async () => {
            setExportError(null);
            try {
              const file = await exporter.run({});
              exporter.reset();
              await app.download({ name: file.fileName, mimeType: file.mimeType, text: file.text });
              announce(`Exported ${file.opportunities} opportunities and ${file.materials} materials`);
            } catch (failure) {
              setExportError(errorText(failure));
            }
          }}>Export your records</Button>
        </ButtonRow>
        <InlineError>{exportError}</InlineError>
      </section>
    </div>
  );
}

function MailPreview({ source }: { source: SourceSummary }) {
  const [open, setOpen] = useState(false);
  const preview = useQuery<{ matches: { subject: string; from: string | null; date: string | null; label: string }[]; query: string }>('preview_source', { account: source.account, historyDays: source.historyDays === 30 || source.historyDays === 365 ? source.historyDays : 90 }, { enabled: open });
  return (
    <section className="js-panel" aria-labelledby={`js-preview-${source.account}`}>
      <div className="ri-section-heading">
        <h2 id={`js-preview-${source.account}`} className="js-panel__title">What {source.label} would import</h2>
        {!open && <Button size="sm" onClick={() => setOpen(true)}>Preview matching mail</Button>}
      </div>
      {!open ? <p className="ri-small ri-muted">See up to ten recent messages the search finds, by subject and sender. Nothing is stored.</p>
        : preview.error ? <InlineError>{preview.error}</InlineError>
          : !preview.data ? <p className="ri-small ri-muted">Searching</p>
            : preview.data.matches.length === 0 ? <p className="ri-small ri-muted">No application mail found in this range.</p> : (
              <ul className="js-items">
                <li className="ri-small ri-muted">{preview.data.query}</li>
                {preview.data.matches.map((match, index) => <li key={index} className="ri-small"><strong>{match.subject}</strong> <span className="ri-muted">· {match.from ?? 'Unknown sender'}{match.date ? ` · ${shortDate(match.date)}` : ''} · {match.label}</span></li>)}
              </ul>
            )}
    </section>
  );
}

function CalendarChoice({ source, onSaved }: { source: SourceSummary; onSaved: () => void }) {
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const list = useQuery<{ calendars: { id: string; summary: string; primary: boolean }[] }>('list_source_calendars', { account: source.account }, { enabled: open });
  const [chosen, setChosen] = useState<string[]>(source.calendars.length ? source.calendars : ['primary']);
  const save = useMutation<Record<string, unknown>, unknown>('set_source');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="js-panel" aria-labelledby={`js-cal-${source.account}`}>
      <div className="ri-section-heading">
        <h2 id={`js-cal-${source.account}`} className="js-panel__title">Calendars read for interviews</h2>
        {!open && <Button size="sm" onClick={() => setOpen(true)}>Choose calendars</Button>}
      </div>
      <p className="ri-small ri-muted">{source.label}: {source.calendars.length ? source.calendars.join(', ') : 'primary calendar'}. Only events that look like interviews for your saved roles are kept.</p>
      {open && (list.error ? <InlineError>{list.error}</InlineError> : !list.data ? <p className="ri-small ri-muted">Loading calendars</p> : (
        <div className="ri-stack ri-stack--tight">
          {list.data.calendars.map((calendar) => (
            <Checkbox key={calendar.id} label={calendar.summary} hint={calendar.primary ? 'Primary' : undefined} checked={chosen.includes(calendar.id) || (calendar.primary && chosen.includes('primary'))}
              onChange={(on) => setChosen((current) => (on ? [...current.filter((id) => id !== calendar.id), calendar.id] : current.filter((id) => id !== calendar.id && !(calendar.primary && id === 'primary'))))} />
          ))}
          <ButtonRow>
            <Button variant="primary" busy={save.pending} onClick={async () => {
              setError(null);
              if (!chosen.length) return setError('Choose at least one calendar');
              try { await save.run({ account: source.account, kind: 'calendar', calendars: chosen }); save.reset(); announce('Calendars saved'); setOpen(false); onSaved(); } catch (failure) { setError(errorText(failure)); }
            }}>Save calendars</Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
          </ButtonRow>
          <InlineError>{error}</InlineError>
        </div>
      ))}
    </section>
  );
}

export { EmptyState };
