/** @jsxRuntime automatic */
/**
 * The Job Search view: Today, Opportunities (board and table), the
 * opportunity workspace, interview preparation, Materials and Sources. The
 * location (section, record, filters) is remembered in Ri's URL so Back and
 * reopening return to the same place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, Button, EmptyState, LoadingState, Notice, SectionPanel, SectionTabs, useQuery, useRiApp } from '@ri/app-kit/ui';
import type { Stage } from '../domain/labels.js';
import { AccessScreen } from './access.js';
import { TodayView } from './today.js';
import { OpportunitiesView } from './opportunities.js';
import { OpportunityWorkspace } from './workspace.js';
import { PreparationView } from './preparation.js';
import { MaterialsView } from './materials.js';
import { SourcesView } from './sources.js';
import { SaveJobDialog } from './dialogs.js';
import type { SourceSummary, ViewData } from './types.js';

export type Tab = 'today' | 'opportunities' | 'materials' | 'sources';
export interface Location {
  tab: Tab;
  /** The open opportunity workspace. */
  opportunityId: string | null;
  /** The open preparation workspace. */
  prepare: { opportunityId: string | null; interviewId: string | null } | null;
  materialId: string | null;
  /** The selected card, shown in the inspector at wide widths. */
  selected: string | null;
  mode: 'board' | 'table';
  view: 'active' | 'closed' | 'archived';
  search: string;
  stage: Stage | null;
  section: string | null;
}

const STAGES: Stage[] = ['saved', 'applied', 'interviewing', 'offer', 'closed'];

export function locationFrom(path: string, query: Record<string, string>, landing: 'today' | 'opportunities'): Location {
  const parts = path.split('/').filter(Boolean);
  const base: Location = {
    tab: landing, opportunityId: null, prepare: null, materialId: null, selected: query.selected ?? null,
    mode: query.mode === 'table' ? 'table' : 'board', view: query.view === 'closed' || query.view === 'archived' ? query.view : 'active',
    search: query.q ?? '', stage: STAGES.includes(query.stage as Stage) ? (query.stage as Stage) : null, section: query.tab ?? null,
  };
  if (parts[0] === 'today') return { ...base, tab: 'today' };
  if (parts[0] === 'opportunities') {
    if (parts[1] && parts[2] === 'prepare') return { ...base, tab: 'opportunities', prepare: { opportunityId: parts[1], interviewId: query.interview ?? null } };
    if (parts[1]) return { ...base, tab: 'opportunities', opportunityId: parts[1], selected: parts[1] };
    return { ...base, tab: 'opportunities' };
  }
  if (parts[0] === 'interviews' && parts[1]) return { ...base, tab: 'opportunities', prepare: { opportunityId: null, interviewId: parts[1] } };
  if (parts[0] === 'materials') return { ...base, tab: 'materials', materialId: parts[1] ?? null };
  if (parts[0] === 'sources' || parts[0] === 'review') return { ...base, tab: 'sources' };
  return base;
}

export function pathOf(location: Location): string {
  const query = new URLSearchParams();
  let path = `/${location.tab}`;
  if (location.prepare?.interviewId) {
    path = `/interviews/${location.prepare.interviewId}`;
  } else if (location.prepare?.opportunityId) {
    path = `/opportunities/${location.prepare.opportunityId}/prepare`;
  } else if (location.opportunityId) {
    path = `/opportunities/${location.opportunityId}`;
    if (location.section) query.set('tab', location.section);
  } else if (location.tab === 'materials' && location.materialId) path = `/materials/${location.materialId}`;
  if (location.tab === 'opportunities') {
    if (location.mode === 'table') query.set('mode', 'table');
    if (location.view !== 'active') query.set('view', location.view);
    if (location.search) query.set('q', location.search.slice(0, 100));
    if (location.stage) query.set('stage', location.stage);
    if (location.selected && !location.opportunityId && !location.prepare) query.set('selected', location.selected);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function JobSearchApp() {
  const app = useRiApp<ViewData>();
  const data = app.data;
  if (!data) return <AppShell eyebrow="Job Search" title="Your next move"><LoadingState label="Opening Job Search" /></AppShell>;
  if (data.mode === 'access') return <AccessScreen data={data} />;
  return <Main data={data} />;
}

function Main({ data }: { data: Extract<ViewData, { mode: 'app' }> }) {
  const app = useRiApp<ViewData>();
  const [location, setLocationState] = useState<Location>(() => locationFrom(data.path, data.query, data.landing));
  const [saveOpen, setSaveOpen] = useState<null | { opportunityId?: string }>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    app.setLocation(pathOf(location));
  }, [location, app]);
  const go = useCallback((patch: Partial<Location> | ((current: Location) => Partial<Location>)) => setLocationState((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) })), []);
  const sources = useQuery<{ sources: SourceSummary[] }>('list_sources', {}, { enabled: data.owner });
  const attention = useMemo(() => (sources.data?.sources ?? []).filter((source) => source.granted && (source.status === 'reconnect' || source.status === 'error')), [sources.data]);
  const empty = data.owner && data.setup.opportunities === 0 && data.setup.materials === 0;

  const tabs = [
    { id: 'today', label: 'Today' },
    { id: 'opportunities', label: 'Opportunities' },
    { id: 'materials', label: 'Materials' },
    { id: 'sources', label: 'Sources', badge: data.setup.review > 0 ? data.setup.review : undefined },
  ];
  const changeTab = (tab: string) => go({ tab: tab as Tab, opportunityId: null, prepare: null, materialId: tab === 'materials' ? location.materialId : null, section: null });

  const notice = attention.length ? (
    <Notice tone="warning" title={attention[0].status === 'reconnect' ? `${attention[0].label} needs to be reconnected in Ri` : `Updates from ${attention[0].label} stopped`} action={<Button size="sm" onClick={() => void app.openSources()}>Manage access</Button>}>
      {attention[0].status === 'reconnect' ? 'Your saved opportunities and correspondence are kept. Coverage stops at the last successful update until you reconnect.' : attention[0].lastError ?? 'The last update did not finish. Open Sources to continue.'}
    </Notice>
  ) : undefined;

  let body;
  if (empty && location.tab !== 'sources') {
    body = (
      <EmptyState
        title="Start with a job you are considering"
        action={<><Button variant="primary" onClick={() => setSaveOpen({})}>Save a job</Button><Button onClick={() => void app.openSources()}>Connect email</Button></>}
      >
        <p>Save a job with its description so it stays available even if the posting disappears. Then add your résumé, record applications and prepare for interviews in one place.</p>
        <p className="ri-small" style={{ marginTop: '0.75rem' }}>Connecting email is optional. It reads application, interview and offer mail from the last 90 days by default, and only from the account you choose.</p>
      </EmptyState>
    );
  } else if (location.prepare) {
    body = <PreparationView key={`${location.prepare.opportunityId}:${location.prepare.interviewId}`} target={location.prepare} onBack={() => go({ prepare: null })} backLabel={location.opportunityId ? 'Back to the opportunity' : 'Back to opportunities'} go={go} />;
  } else if (location.tab === 'today') {
    body = <TodayView go={go} onSaveJob={() => setSaveOpen({})} />;
  } else if (location.tab === 'opportunities') {
    body = (
      <OpportunitiesView
        location={location}
        go={go}
        onSaveJob={() => setSaveOpen({})}
        workspace={location.opportunityId ? <OpportunityWorkspace key={location.opportunityId} id={location.opportunityId} section={location.section} go={go} onAddDescription={() => setSaveOpen({ opportunityId: location.opportunityId! })} /> : null}
      />
    );
  } else if (location.tab === 'materials') {
    body = <MaterialsView selectedId={location.materialId} onSelect={(materialId) => go({ materialId })} />;
  } else {
    body = <SourcesView owner={data.owner} go={go} />;
  }

  return (
    <AppShell
      eyebrow="Job Search"
      title={empty ? 'Keep your next opportunity together' : 'Your next move'}
      context={data.fictional ? <span className="js-badge-fictional">Fictional preview records. Nothing here is real or sent anywhere.</span> : 'Your opportunities, conversations and preparation in one place.'}
      primaryAction={data.owner && !empty ? <Button variant="primary" onClick={() => setSaveOpen({})}>Save a job</Button> : undefined}
      tabs={<SectionTabs label="Job Search sections" panelId="js-panel" value={location.tab} onChange={changeTab} items={tabs} />}
      notice={notice}
    >
      <SectionPanel panelId="js-panel" value={location.tab}>{body}</SectionPanel>
      {saveOpen && (
        <SaveJobDialog
          open
          attachTo={saveOpen.opportunityId ?? null}
          onClose={() => setSaveOpen(null)}
          onSaved={(opportunityId) => {
            setSaveOpen(null);
            if (opportunityId) go({ tab: 'opportunities', opportunityId, selected: opportunityId, prepare: null, section: null });
          }}
        />
      )}
    </AppShell>
  );
}
