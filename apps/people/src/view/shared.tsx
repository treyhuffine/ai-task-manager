import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Button, ButtonRow, Dialog, ErrorState, FollowUpDialog, InlineError, LoadingState, Notice, SectionTabs, SourceLine, StatusLabel, useAnnounce, useMutation, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import type { OpenData } from '../actions/common.js';
import type { Coverage, Evidence, TaskLink } from '../schemas.js';
import { coverageLines, dateLabel, isOverdue, uuid } from './format.js';

export type Section = 'today' | 'people' | 'follow-ups' | 'companies' | 'pipelines' | 'sources';
export interface Route { section: Section; record: { kind: 'person' | 'company' | 'opportunity'; id: string } | null; query: Record<string, string> }

export interface PeopleUi {
  data: OpenData;
  route: Route;
  go(next: Partial<Route> & { section?: Section }): void;
  setQuery(patch: Record<string, string | null>): void;
  openPerson(id: string): void;
  openCompany(id: string): void;
  openOpportunity(id: string): void;
  showEvidence(id: string, passage?: string | null): void;
  followUp(input: { subject: { kind: 'commitment' | 'person' | 'organization' | 'opportunity'; id: string }; title: string; dueDate?: string | null; label: string }): void;
}
const UiContext = createContext<PeopleUi | null>(null);
export const UiProvider = UiContext.Provider;
export function usePeople(): PeopleUi {
  const value = useContext(UiContext);
  if (!value) throw new Error('People UI context missing');
  return value;
}

function OnEffect({ run, dep }: { run: () => void; dep: unknown }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, [dep]);
  return null;
}

/**
 * The kit's section tabs, with the page kept where it was. The kit brings
 * the selected tab into view with `scrollIntoView`, which also scrolls the
 * page when the tab row sits below the fold (a record's Timeline, Notes and
 * Details tabs). Sibling effects run in order, so the position is read just
 * before the tabs' effect and put back just after it. Horizontal scrolling
 * of the tab row itself is unchanged.
 */
export function RecordTabs(props: ComponentProps<typeof SectionTabs>) {
  const saved = useRef<number | null>(null);
  return (
    <>
      <OnEffect dep={props.value} run={() => { saved.current = window.scrollY; }} />
      <SectionTabs {...props} />
      <OnEffect dep={props.value} run={() => { if (saved.current !== null && window.scrollY !== saved.current) window.scrollTo({ top: saved.current, left: window.scrollX }); saved.current = null; }} />
    </>
  );
}

/** A call that returns `{ status: 'saved' | 'conflict' }`, with the invocation ID kept for a retry. */
export function useSave<TResult = unknown>(action: string) {
  const mutation = useMutation<Record<string, unknown>, TResult>(action);
  const announce = useAnnounce();
  const run = useCallback(async (input: Record<string, unknown>, saved?: string) => {
    const result = await mutation.run(input);
    const status = (result as { status?: string } | null)?.status;
    if (saved && (status === undefined || status === 'saved')) announce(saved);
    return result;
  }, [mutation, announce]);
  return { ...mutation, run };
}

export function CoverageFooter({ coverage }: { coverage: Coverage | undefined }) {
  const [first, second] = coverageLines(coverage);
  if (!first) return null;
  return <p className="pe-coverage">{first}<br />{second}</p>;
}

export function Loading({ label }: { label: string }) {
  return <LoadingState label={label} rows={3} />;
}
export function Failure({ error, reload }: { error: string; reload?: () => void }) {
  const { openSources } = useRiApp();
  const access = /not chosen|may not|access/i.test(error);
  return (
    <ErrorState
      message={error}
      onRetry={access ? () => void openSources() : reload}
      retryLabel={access ? 'Open Sources' : 'Try again'}
    />
  );
}

export function NameLink({ id, name, kind }: { id: string; name: string; kind: 'person' | 'company' }) {
  const ui = usePeople();
  return <button type="button" className="pe-link" onClick={() => (kind === 'person' ? ui.openPerson(id) : ui.openCompany(id))}>{name}</button>;
}

export function DueLabel({ date }: { date: string | null }) {
  if (!date) return <span className="pe-muted">No deadline stated</span>;
  return isOverdue(date) ? <StatusLabel tone="warning">Overdue · {dateLabel(date)}</StatusLabel> : <span>Due {dateLabel(date)}</span>;
}

export function TaskStatus({ link }: { link: TaskLink }) {
  const { openSources } = useRiApp();
  if (link.status === 'linked') return <StatusLabel tone={link.taskStatus === 'done' || link.taskStatus === 'completed' ? 'success' : 'neutral'}>{link.taskStatus === 'done' || link.taskStatus === 'completed' ? 'Ri task done' : 'Linked Ri task'}</StatusLabel>;
  if (link.status === 'unavailable') return <StatusLabel tone="warning">Ri task no longer available</StatusLabel>;
  if (link.status === 'failed') return (
    <span className="pe-row">
      <StatusLabel tone="danger">Ri task not created</StatusLabel>
      <span className="pe-small pe-muted">{link.lastError}</span>
      {/Sources/.test(link.lastError ?? '') && <Button size="sm" variant="link" onClick={() => void openSources()}>Open Sources</Button>}
    </span>
  );
  return <StatusLabel tone="info">Creating Ri task</StatusLabel>;
}

/** The source inspector: account, participants, date, exact passage and the original link. */
export function EvidenceDialog({ request, onClose }: { request: { id: string; passage?: string | null } | null; onClose(): void }) {
  const evidence = useQuery<Evidence>('get_evidence', request ? { id: request.id, ...(request.passage ? { passage: request.passage } : {}) } : {}, { enabled: !!request, keepPrevious: false });
  const { openExternal } = useRiApp();
  const value = evidence.data;
  return (
    <Dialog open={!!request} title={value?.title ?? 'Source'} description={value ? `${value.sourceLabel}${value.sourceDate ? ` · ${dateLabel(value.sourceDate.slice(0, 10))}` : ''}` : undefined} onClose={onClose}
      footer={<ButtonRow align="end">{value?.link && <Button onClick={() => void openExternal(value.link!)}>Open original</Button>}<Button variant="primary" onClick={onClose}>Done</Button></ButtonRow>}>
      {evidence.error ? <InlineError>{evidence.error}</InlineError> : !value ? <Loading label="Loading source" /> : (
        <div className="pe-stack">
          {value.status !== 'available' && <Notice tone="warning" title="Source unavailable">{value.statusLabel}</Notice>}
          {value.passage && (
            <div className="pe-stack">
              <p className="pe-section-label">Exact passage</p>
              <blockquote className="pe-quote">{value.passage}</blockquote>
            </div>
          )}
          {value.excerpt && (
            <div className="pe-stack">
              <p className="pe-section-label">{value.passage ? 'Nearby text' : 'Excerpt'}</p>
              <p className="pe-small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{value.excerpt}</p>
            </div>
          )}
          {value.participants.length > 0 && <p className="pe-small pe-muted">Participants: {value.participants.join(', ')}</p>}
          <SourceLine label={`${value.kind === 'event' ? 'Calendar entry' : value.kind === 'email' ? 'Email' : 'Imported row'} in ${value.sourceLabel}`} observedAt={value.sourceDate} availability={value.status === 'available' ? 'available' : 'unavailable'} />
          <p className="pe-small pe-muted">{value.statusLabel}. A correction keeps this evidence.</p>
        </div>
      )}
    </Dialog>
  );
}

/** Wraps the kit's follow-up dialog with an operation ID that survives a retry. */
export function FollowUpHost({ request, onClose }: { request: Parameters<PeopleUi['followUp']>[0] | null; onClose(): void }) {
  const create = useMutation<Record<string, unknown>, { link: TaskLink; created: boolean }>('create_follow_up');
  const operation = useRef<string | null>(null);
  const [failed, setFailed] = useState<TaskLink | null>(null);
  const { openSources } = useRiApp();
  if (request && !operation.current) operation.current = uuid();
  const close = () => { operation.current = null; setFailed(null); create.reset(); onClose(); };
  return (
    <>
      <FollowUpDialog
        open={!!request && !failed}
        defaultTitle={request?.title ?? ''}
        allowDueDate
        defaultDueDate={request?.dueDate ?? null}
        subject={request?.label}
        onClose={close}
        onCreate={async (title, dueDate) => {
          const result = await create.run({ subject: request!.subject, title, ...(dueDate ? { dueAt: dueDate } : {}), operationId: operation.current! });
          if (result.link.status === 'failed') { setFailed(result.link); throw new Error(result.link.lastError ?? 'The task was not created'); }
          return result;
        }}
      />
      <Dialog open={!!failed} title="The Ri task was not created" onClose={close}
        footer={<ButtonRow align="end"><Button onClick={close}>Close</Button>{/Sources/.test(failed?.lastError ?? '') ? <Button variant="primary" onClick={() => void openSources()}>Open Sources</Button> : <Button variant="primary" onClick={() => setFailed(null)}>Try again</Button>}</ButtonRow>}>
        <p>{failed?.lastError}</p>
        <p className="pe-small pe-muted">The follow-up is saved with its operation ID, so trying again never creates a second task.</p>
      </Dialog>
    </>
  );
}

export function Section({ title, action, children, label }: { title: ReactNode; action?: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <section className="pe-stack" aria-label={label}>
      <div className="pe-row pe-between"><h3 className="ri-h3">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

export function useStable<T>(value: T): T {
  const ref = useRef(value);
  const key = JSON.stringify(value);
  const last = useRef(key);
  if (last.current !== key) { last.current = key; ref.current = value; }
  return useMemo(() => ref.current, [key]);
}
