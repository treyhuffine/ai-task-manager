import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppShell, AskRiButton, Button, ButtonRow, Dialog, InlineError, LoadingState, Notice, SectionPanel, SectionTabs, Select, TextInput, useAnnounce, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import type { OpenData } from '../actions/common.js';
import { Directory } from './directory.js';
import { AffiliationDialog } from './person.js';
import { OpportunityDialog, PipelinesView } from './pipelines.js';
import { AccessView, SourcesView } from './sources.js';
import { FollowUpsView, TodayView } from './today.js';
import { EvidenceDialog, FollowUpHost, UiProvider, useSave, type PeopleUi, type Route, type Section } from './shared.js';

const TITLES: Record<Section, [string, string]> = {
  today: ['Pick up where you left off.', 'The conversations, context and commitments that matter today.'],
  people: ['Your people.', 'One useful place for the people in your life and work.'],
  'follow-ups': ['Keep the conversation moving.', 'Your commitments and theirs, with the context to act.'],
  companies: ['Your companies.', 'The people, conversations and next steps around each organization. Communities, funds and schools work too.'],
  pipelines: ['Work worth following through.', 'A small pipeline for the outcomes you choose to track.'],
  sources: ['Connected, on your terms.', 'Choose what stays up to date and what gets analyzed.'],
};

function routeFrom(data: OpenData): Route {
  const query = { ...(data.query ?? {}) };
  const { section, id } = data.route;
  if (section === 'person' && id) return { section: query.from === 'today' ? 'today' : 'people', record: { kind: 'person', id }, query };
  if (section === 'company' && id) return { section: 'companies', record: { kind: 'company', id }, query };
  if (section === 'opportunity' && id) return { section: 'pipelines', record: { kind: 'opportunity', id }, query };
  if (section === 'pipelines' && id) return { section: 'pipelines', record: null, query: { ...query, pipeline: id } };
  if (section === 'access' || section === 'person' || section === 'company' || section === 'opportunity') return { section: 'today', record: null, query };
  return { section: section as Section, record: null, query };
}

function pathFor(route: Route): string {
  const query = Object.entries(route.query).filter(([, value]) => value !== undefined && value !== '');
  const search = query.length ? `?${new URLSearchParams(query).toString()}` : '';
  if (route.record) return `/${route.record.kind === 'person' ? 'people' : route.record.kind === 'company' ? 'companies' : 'opportunities'}/${route.record.id}${search}`;
  return `/${route.section}${search}`;
}

export function PeopleApp() {
  const app = useRiApp<OpenData>();
  const data = app.data;
  if (!data) return <div className="ri-app"><main className="ri-shell"><LoadingState label="Opening People" /></main></div>;
  if (data.route.section === 'access') return <AccessShell data={data} />;
  return <Main data={data} />;
}

function AccessShell({ data }: { data: OpenData }) {
  const ui = useMemo<PeopleUi>(() => ({ data, route: { section: 'sources', record: null, query: {} }, go() {}, setQuery() {}, openPerson() {}, openCompany() {}, openOpportunity() {}, showEvidence() {}, followUp() {} }), [data]);
  return <UiProvider value={ui}><AppShell eyebrow="People" title="Choose what this chat can use" context="Accounts, collections and imports, and whether it may also add records."><AccessView /></AppShell></UiProvider>;
}

function Main({ data }: { data: OpenData }) {
  const app = useRiApp<OpenData>();
  const announce = useAnnounce();
  const [route, setRoute] = useState<Route>(() => routeFrom(data));
  const pushed = useRef(pathFor(route));
  const [evidence, setEvidence] = useState<{ id: string; passage?: string | null } | null>(null);
  const [follow, setFollow] = useState<Parameters<PeopleUi['followUp']>[0] | null>(null);
  const [create, setCreate] = useState<null | 'person' | 'company' | 'opportunity'>(null);
  const [addView, setAddView] = useState(false);
  const [offerCompanies, setOfferCompanies] = useState(false);
  const navigation = useSave<unknown>('save_navigation');

  // A host navigation (deep link, Back in Ri) changes the opener route. Our own pushes do not reset state.
  useEffect(() => {
    const incoming = routeFrom(data);
    if (pathFor(incoming) !== pushed.current) { pushed.current = pathFor(incoming); setRoute(incoming); }
  }, [data.route.section, data.route.id, JSON.stringify(data.query)]);
  const commit = useCallback((next: Route) => {
    setRoute(next);
    const path = pathFor(next);
    pushed.current = path;
    app.setLocation(path);
  }, [app]);
  useEffect(() => {
    const selected = route.record ? [{ kind: route.record.kind === 'company' ? 'organization' : route.record.kind, id: route.record.id }] : [];
    let filters: unknown;
    try { filters = route.query.f ? JSON.parse(route.query.f) : undefined; } catch { filters = undefined; }
    const section = route.record ? (route.record.kind === 'company' ? 'company' : route.record.kind) : route.section;
    app.context({ section, selected, ...(filters && (route.section === 'people' || route.section === 'companies') ? { filters: { ...(filters as object), ...(route.query.q ? { text: route.query.q } : {}) } } : route.query.q && (route.section === 'people' || route.section === 'companies') ? { filters: { text: route.query.q } } : {}), ...(route.query.view?.startsWith('view:') ? { viewId: route.query.view.slice(5) } : {}), ...(route.section === 'follow-ups' ? { followUps: (route.query.filter ?? 'i_owe') as 'i_owe' } : {}) });
  }, [route]);
  useEffect(() => { if (route.query.create === 'person' || route.query.create === 'company') { setCreate(route.query.create); commit({ ...route, query: Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== 'create')) }); } }, [route.query.create]);

  const ui = useMemo<PeopleUi>(() => ({
    data, route,
    go(next) { commit({ section: next.section ?? route.section, record: next.record === undefined ? route.record : next.record, query: next.query ?? (next.section && next.section !== route.section ? {} : route.query) }); },
    setQuery(patch) { const query = { ...route.query }; for (const [key, value] of Object.entries(patch)) { if (value === null) delete query[key]; else query[key] = value; } commit({ ...route, query }); },
    openPerson(id) { commit({ section: route.section === 'today' ? 'today' : 'people', record: { kind: 'person', id }, query: route.section === 'today' ? { from: 'today' } : route.section === 'people' ? { ...route.query, tab: '' } : {} }); },
    openCompany(id) { commit({ section: 'companies', record: { kind: 'company', id }, query: route.section === 'companies' ? route.query : {} }); },
    openOpportunity(id) { commit({ section: 'pipelines', record: { kind: 'opportunity', id }, query: route.section === 'pipelines' ? route.query : {} }); },
    showEvidence(id, passage) { setEvidence({ id, passage }); },
    followUp(input) { setFollow(input); },
  }), [data, route, commit]);

  const showCompanies = data.navigation.companies === 'shown' || route.section === 'companies';
  const showPipelines = data.navigation.pipelines === 'shown' || route.section === 'pipelines';
  const pinned = data.pinnedViews.filter((view) => view.recordKind !== 'opportunity');
  const tabs = [
    { id: 'today', label: 'Today' }, { id: 'people', label: 'People' }, { id: 'follow-ups', label: 'Follow-ups' },
    ...(showCompanies ? [{ id: 'companies', label: 'Companies' }] : []),
    ...(showPipelines ? [{ id: 'pipelines', label: 'Pipelines' }] : []),
    ...pinned.map((view) => ({ id: `pin:${view.id}`, label: view.label })),
    { id: 'sources', label: 'Sources' },
  ];
  const activeTab = route.query.view?.startsWith('view:') && pinned.some((view) => `view:${view.id}` === route.query.view) && !route.record ? `pin:${route.query.view.slice(5)}` : route.section;
  const onTab = (id: string) => {
    if (id.startsWith('pin:')) { const view = pinned.find((item) => item.id === id.slice(4)); commit({ section: view?.recordKind === 'organization' ? 'companies' : 'people', record: null, query: { view: `view:${id.slice(4)}` } }); return; }
    commit({ section: id as Section, record: null, query: {} });
  };
  const [title, context] = TITLES[route.section];
  const primary = route.section === 'companies' ? 'company' : route.section === 'pipelines' ? 'opportunity' : 'person';
  const ask = {
    today: 'Using the People app, what needs my attention today? Cover upcoming meetings, what I offered to do and what I am waiting on. Cite sources.',
    people: 'Using the People app, look at the people in my current view and suggest who I should reconnect with and why. Cite sources. Do not send anything.',
    'follow-ups': 'What am I waiting on, and what did I offer to do? Use the People app and cite the evidence.',
    companies: 'Using the People app, which companies have open next actions or opportunities? Cite linked records.',
    pipelines: 'Using the People app, review my pipeline. What is each opportunity\'s next step? Values are per opportunity and must not be added together.',
    sources: 'What does the People app have access to, and is any coverage partial?',
  }[route.section];
  const notice = data.fixture
    ? <Notice tone="info" title="Fictional preview">These people, companies and messages are invented. Nothing here reads an account or sends anything.</Notice>
    : data.attention.reconnect > 0 ? <Notice tone="warning" title={`${data.attention.reconnect} account${data.attention.reconnect === 1 ? ' needs' : 's need'} reconnecting`} action={<Button size="sm" onClick={() => void app.manageAccess()}>Reconnect</Button>}>Saved records stay available. Updates resume after you reconnect in Ri.</Notice>
      : offerCompanies ? <Notice tone="info" title="Show Companies in navigation?" action={<ButtonRow><Button size="sm" onClick={async () => { await navigation.run({ companies: 'shown', companiesOffered: true }); navigation.reset(); setOfferCompanies(false); announce('Companies added to navigation'); }}>Show Companies</Button><Button size="sm" variant="quiet" onClick={async () => { await navigation.run({ companiesOffered: true }); navigation.reset(); setOfferCompanies(false); }}>Not now</Button></ButtonRow>}>You can always open a company from a person.</Notice>
        : undefined;
  const panelId = 'pe-section';
  return (
    <UiProvider value={ui}>
      <AppShell
        eyebrow="People"
        title={title}
        context={context}
        notice={notice}
        secondaryActions={<AskRiButton prompt={ask} />}
        primaryAction={data.canWrite && route.section !== 'sources' ? <Button variant="primary" onClick={() => setCreate(primary)}>{primary === 'company' ? 'Add company' : primary === 'opportunity' ? 'Add opportunity' : 'Add person'}</Button> : undefined}
        tabs={(
          <div className="pe-tabs-row">
            <SectionTabs label="People sections" panelId={panelId} value={activeTab} onChange={onTab} items={tabs} />
            {data.owner && <Button size="sm" variant="quiet" className="pe-add-view" onClick={() => setAddView(true)}>Add view</Button>}
          </div>
        )}
      >
        <SectionPanel panelId={panelId} value={activeTab}>
          {route.section === 'today' && <TodayView />}
          {route.section === 'people' && <Directory kind="person" />}
          {route.section === 'follow-ups' && <FollowUpsView />}
          {route.section === 'companies' && (
            <>
              <Directory kind="organization" />
              {data.owner && data.navigation.companies === 'shown' && !route.record && <ButtonRow><Button variant="link" size="sm" onClick={async () => { await navigation.run({ companies: 'hidden' }); navigation.reset(); announce('Companies hidden. Records are still available'); commit({ section: 'today', record: null, query: {} }); }}>Hide this view</Button></ButtonRow>}
            </>
          )}
          {route.section === 'pipelines' && <PipelinesView onCreate={() => setCreate('opportunity')} />}
          {route.section === 'sources' && <SourcesView />}
        </SectionPanel>
      </AppShell>
      <EvidenceDialog request={evidence} onClose={() => setEvidence(null)} />
      <FollowUpHost request={follow} onClose={() => setFollow(null)} />
      {create === 'person' && <AddPersonDialog onClose={(id) => { setCreate(null); if (id) ui.openPerson(id); }} />}
      {create === 'company' && <AddCompanyDialog onClose={(id) => { setCreate(null); if (id) { if (data.navigation.companies !== 'shown' && !data.navigation.companiesOffered) setOfferCompanies(true); ui.openCompany(id); } }} />}
      {create === 'opportunity' && <OpportunityDialog onClose={(id) => { setCreate(null); if (id) ui.openOpportunity(id); }} />}
      {addView && <AddViewDialog onClose={() => setAddView(false)} onOpen={(section) => { setAddView(false); commit({ section, record: null, query: {} }); }} />}
    </UiProvider>
  );
}

function AddViewDialog({ onClose, onOpen }: { onClose(): void; onOpen(section: Section): void }) {
  const app = useRiApp<OpenData>();
  const data = app.data!;
  const save = useSave<unknown>('save_navigation');
  const announce = useAnnounce();
  const [landing, setLanding] = useState(data.navigation.landing);
  const show = async (key: 'companies' | 'pipelines') => { await save.run({ [key]: 'shown' }); save.reset(); announce(`${key === 'companies' ? 'Companies' : 'Pipelines'} added`); onOpen(key); };
  return (
    <Dialog open title="Make room for what you need" description="Start with people. Add a view when it helps your work. Hiding a view later keeps its records and permissions." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Done</Button></ButtonRow>}>
      <div className="pe-stack pe-stack--loose">
        <div className="pe-source-row"><div><h3 className="ri-h3">Companies</h3><p className="pe-small pe-muted">See people, shared conversations and next actions around an organization.</p></div>
          {data.navigation.companies === 'shown' ? <Button onClick={() => onOpen('companies')}>Open</Button> : <Button variant="primary" busy={save.pending} onClick={() => void show('companies')}>Add view</Button>}</div>
        <div className="pe-source-row"><div><h3 className="ri-h3">Pipeline</h3><p className="pe-small pe-muted">Track a client project, partnership or introduction through simple stages. Your people never need a stage.</p></div>
          {data.navigation.pipelines === 'shown' ? <Button onClick={() => onOpen('pipelines')}>Open</Button> : <Button variant="primary" busy={save.pending} onClick={() => void show('pipelines')}>Try client work</Button>}</div>
        <div className="pe-source-row"><div><h3 className="ri-h3">Saved people view</h3><p className="pe-small pe-muted">Filter the People directory, then Save view. Pin a saved view to keep it here. Nothing is copied or reclassified.</p></div>
          <Button onClick={() => onOpen('people')}>Open people</Button></div>
        <Select label="Open People on" value={landing} onChange={async (value) => { setLanding(value); await save.run({ landing: value }); save.reset(); announce('Landing view saved'); }}
          options={[{ value: 'today', label: 'Today' }, { value: 'people', label: 'People' }, { value: 'follow-ups', label: 'Follow-ups' }, ...(data.navigation.companies === 'shown' ? [{ value: 'companies', label: 'Companies' }] : []), ...(data.navigation.pipelines === 'shown' ? [{ value: 'pipelines', label: 'Pipelines' }] : [])]} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

function AddPersonDialog({ onClose }: { onClose(id?: string): void }) {
  const app = useRiApp<OpenData>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [headline, setHeadline] = useState('');
  const [collection, setCollection] = useState(app.data?.collections[0]?.key ?? 'manual');
  const save = useSave<{ status: string; record: { id: string } }>('save_person');
  return (
    <Dialog open title="Add a person" description="Only a name is needed. No company, list or stage." onClose={() => onClose()}
      footer={<ButtonRow align="end"><Button onClick={() => onClose()}>Cancel</Button><Button variant="primary" busy={save.pending} disabled={!name.trim()} onClick={async () => {
        try {
          const result = await save.run({ name: name.trim(), ...(headline.trim() ? { headline: headline.trim() } : {}), ...(email.trim() ? { identifiers: [{ kind: 'email', value: email.trim() }] } : {}), collection }, 'Person added');
          onClose(result.record.id);
        } catch { /* shown below */ }
      }}>Add person</Button></ButtonRow>}>
      <div className="pe-stack">
        <TextInput label="Name" value={name} onChange={setName} required autoFocus />
        <TextInput label="Email" type="email" hint="Optional. Conversations with this address will appear on the timeline" value={email} onChange={setEmail} />
        <TextInput label="Short description" hint="Optional, such as Neighbor or Independent consultant" value={headline} onChange={setHeadline} />
        {(app.data?.collections.length ?? 0) > 1 && <Select label="Collection" value={collection} onChange={setCollection} options={app.data!.collections.map((item) => ({ value: item.key, label: item.label }))} />}
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}

function AddCompanyDialog({ onClose }: { onClose(id?: string): void }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [kind, setKind] = useState('company');
  const save = useSave<{ status: string; record: { id: string } }>('save_organization');
  return (
    <Dialog open title="Add a company" description="Only a name is needed. Nonprofits, communities, funds and schools use the same record. Nothing is looked up online." onClose={() => onClose()}
      footer={<ButtonRow align="end"><Button onClick={() => onClose()}>Cancel</Button><Button variant="primary" busy={save.pending} disabled={!name.trim()} onClick={async () => {
        try { const result = await save.run({ name: name.trim(), ...(website.trim() ? { website: website.trim() } : {}), kind }, 'Company added'); onClose(result.record.id); } catch { /* shown below */ }
      }}>Add company</Button></ButtonRow>}>
      <div className="pe-stack">
        <TextInput label="Name" value={name} onChange={setName} required autoFocus />
        <TextInput label="Website" hint="Optional" value={website} onChange={setWebsite} />
        <Select label="Type" value={kind} onChange={setKind} options={['company', 'nonprofit', 'community', 'fund', 'school', 'public', 'other'].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} />
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}
export { AffiliationDialog, useQuery };
