import { useEffect, useState } from 'react';
import { AskRiButton, Avatar, Button, ButtonRow, Dialog, EmptyState, InlineError, Menu, SectionPanel, Select, TextInput, formatMoney, useAnnounce, useQuery, useRiApp } from '@ri/app-kit/ui';
import type { Affiliation, OrganizationDetail } from '../schemas.js';
import { dateLabel, dayLabel } from './format.js';
import { CommitmentRow, NotesPanel, PersonTimeline, RemoveDialog, UndoMergeDialog } from './person.js';
import { CoverageFooter, Failure, Loading, NameLink, RecordTabs, TaskStatus, useSave, usePeople } from './shared.js';

type Detail = OrganizationDetail & { merges: { id: string; revision: number; survivorId: string; mergedId: string; createdAt: string }[] };

export function CompanyWorkspace({ id }: { id: string }) {
  const ui = usePeople();
  const detail = useQuery<Detail>('get_organization', { id }, { keepPrevious: false });
  const [tab, setTab] = useState(ui.route.query.tab ?? 'overview');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(false);
  const { ask } = useRiApp();
  useEffect(() => { setTab(ui.route.query.tab ?? 'overview'); }, [id]);
  if (detail.error && !detail.data) return <Failure error={detail.error} reload={detail.reload} />;
  if (!detail.data) return <Loading label="Loading company" />;
  const org = detail.data.organization;
  const all = [...detail.data.people.current, ...detail.data.people.uncertain];
  const domain = detail.data.domains.find((item) => item.kind === 'domain')?.value ?? org.website;
  const select = (next: string) => { setTab(next); ui.setQuery({ tab: next === 'overview' ? null : next }); };
  const prompt = `What is happening with ${org.name}? Using the People app's permitted company records, summarize the people I know there (current, former and uncertain, with dates), explicitly linked conversations, opportunities and next actions. Cite sources.`;
  return (
    <article className="pe-record" aria-label={org.name}>
      <header className="pe-record-head">
        <div className="pe-record-head__who">
          <Avatar name={org.name} size="lg" className="pe-square" />
          <div className="pe-stack" style={{ gap: '0.25rem' }}>
            <h2 className="pe-record-title">{org.name}</h2>
            <p className="pe-record-sub">{domain ?? 'No website recorded'}{org.kind && org.kind !== 'company' ? ` · ${org.kind[0]!.toUpperCase()}${org.kind.slice(1)}` : ''}</p>
            <p className="pe-small pe-muted">{org.stateLabel}{org.archived ? ' · Archived' : ''}</p>
          </div>
        </div>
        <ButtonRow>
          {ui.data.canWrite && <Button size="sm" onClick={() => select('notes')}>Add note</Button>}
          <AskRiButton size="sm" variant="primary" prompt={prompt}>Ask about company</AskRiButton>
          <Menu size="sm" variant="quiet" label="More" items={[
            ...(ui.data.canWrite ? [{ id: 'edit', label: 'Edit company' }] : []),
            ...(ui.data.canWrite ? [{ id: 'follow', label: 'Create follow-up' }] : []),
            { id: 'who', label: `Who do I know at ${org.name}?` },
            ...(ui.data.owner ? [{ id: 'remove', label: 'Archive or remove' }] : []),
            ...(ui.data.owner ? detail.data.merges.map((merge) => ({ id: `undo:${merge.id}`, label: `Undo merge from ${dayLabel(merge.createdAt)}` })) : []),
          ]} onSelect={(choice) => {
            if (choice === 'edit') setEditing(true);
            if (choice === 'follow') ui.followUp({ subject: { kind: 'organization', id: org.id }, title: detail.data!.nextAction?.label ?? `Follow up with ${org.name}`, label: org.name });
            if (choice === 'remove') setRemoving(true);
            if (choice === 'who') void ask(`Who do I know at ${org.name}? Using the People app, separate current, former and date-uncertain affiliations and give each one's date and source.`);
            if (choice.startsWith('undo:')) setUndo(choice.slice(5));
          }} />
        </ButtonRow>
      </header>
      <RecordTabs label={`${org.name} sections`} panelId={`pe-company-${id}`} value={tab} onChange={select} items={[
        { id: 'overview', label: 'Overview' }, { id: 'people', label: 'People', badge: all.length || undefined }, { id: 'activity', label: 'Activity' },
        { id: 'opportunities', label: 'Opportunities', badge: detail.data.opportunities.length || undefined }, { id: 'notes', label: 'Notes' },
      ]} />
      <SectionPanel panelId={`pe-company-${id}`} value={tab}>
        {tab === 'overview' && (
          <div className="pe-company-grid">
            <div className="pe-stack pe-stack--loose">
              <section className="pe-card pe-stack" aria-label="Next action">
                <p className="pe-section-label">Next action</p>
                {detail.data.nextAction ? (
                  <>
                    <h3 className="ri-h3">{detail.data.nextAction.label}</h3>
                    <p className="pe-small pe-muted">{detail.data.nextAction.dueDate ? dateLabel(detail.data.nextAction.dueDate) : 'No date chosen'}{detail.data.taskLinks[0] ? ' · ' : ''}{detail.data.taskLinks[0] && <TaskStatus link={detail.data.taskLinks[0]} />}</p>
                  </>
                ) : <p className="pe-muted">No next action chosen.</p>}
                {ui.data.canWrite && <ButtonRow><Button size="sm" onClick={() => ui.followUp({ subject: { kind: 'organization', id: org.id }, title: detail.data!.nextAction?.label ?? `Follow up with ${org.name}`, dueDate: detail.data!.nextAction?.dueDate ?? null, label: org.name })}>Create follow-up</Button></ButtonRow>}
              </section>
              <section className="pe-stack" aria-label="Relationship context">
                <h3 className="ri-h3">Relationship context</h3>
                {detail.data.commitments.length ? detail.data.commitments.map((commitment) => <CommitmentRow key={commitment.id} commitment={commitment} reload={detail.reload} showSubject />)
                  : <p className="pe-muted">No commitments from linked conversations. Only conversations you link to {org.name}, or that an attribution rule covers, count here.</p>}
              </section>
              <section className="pe-stack" aria-label="Recent activity">
                <h3 className="ri-h3">Recent activity</h3>
                <PersonTimeline id={id} subjectKind="organization" />
              </section>
            </div>
            <aside className="pe-stack pe-stack--loose">
              <section className="pe-card pe-stack" aria-label="People you know">
                <div className="pe-row pe-between"><h3 className="ri-h3">People you know</h3><span className="pe-small pe-muted">{all.length}</span></div>
                {all.length ? <PeopleList items={all.slice(0, 8)} /> : <p className="pe-muted">No known contacts yet. A company without contacts is still useful.</p>}
                {all.length > 8 && <Button size="sm" variant="link" onClick={() => select('people')}>All {all.length} people</Button>}
                <p className="pe-small pe-muted">Observed affiliations show their dates. Old roles keep theirs.</p>
              </section>
              <section className="pe-card pe-stack" aria-label="Related opportunities">
                <div className="pe-row pe-between"><h3 className="ri-h3">Related opportunities</h3>{detail.data.opportunities.some((item) => item.value) && <Button size="sm" variant="link" onClick={() => setShowValues((value) => !value)}>{showValues ? 'Hide values' : 'Show values'}</Button>}</div>
                {detail.data.opportunities.length ? (
                  <ul className="pe-list">
                    {detail.data.opportunities.map((item) => (
                      <li key={item.id} className="pe-stack" style={{ gap: '0.25rem' }}>
                        <button type="button" className="pe-opp__title" onClick={() => ui.openOpportunity(item.id)}>{item.title}</button>
                        <span className="pe-small pe-muted">{item.pipelineName} · {item.stageLabel}{showValues && item.value ? ` · ${formatMoney(item.value.minor, item.value.currency)}` : ''}</span>
                        {item.nextAction && <span className="pe-small">{item.nextAction}{item.nextActionDate ? ` · ${dateLabel(item.nextActionDate)}` : ''}</span>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="pe-small pe-muted">No opportunities recorded. Company context works without a pipeline.</p>}
              </section>
            </aside>
          </div>
        )}
        {tab === 'people' && (
          <div className="pe-stack pe-stack--loose">
            <PeopleGroup title="Current" empty="No current affiliation confirmed by you." items={detail.data.people.current} />
            <PeopleGroup title="Date uncertain" empty="None." items={detail.data.people.uncertain} hint="Observed in correspondence or an import. Not confirmed as current employment." />
            <PeopleGroup title="Former" empty="None." items={detail.data.people.former} />
            {detail.data.attributionRules.length > 0 && (
              <section className="pe-stack" aria-label="Attribution rules"><h3 className="ri-h3">Attribution rules</h3>
                <ul className="pe-list">{detail.data.attributionRules.map((rule) => <li key={rule.id} className="pe-small">Work conversations with {rule.identity} in {rule.account}{rule.from ? ` from ${rule.from}` : ''}{rule.to ? ` until ${rule.to}` : ''}. {rule.state === 'active' ? 'Active.' : 'Disabled.'} {rule.state === 'active' && ui.data.owner && <DisableRule rule={rule} reload={detail.reload} />}</li>)}</ul>
              </section>
            )}
          </div>
        )}
        {tab === 'activity' && <PersonTimeline id={id} subjectKind="organization" />}
        {tab === 'opportunities' && (
          detail.data.opportunities.length ? (
            <ul className="pe-list">{detail.data.opportunities.map((item) => <li key={item.id}><button type="button" className="pe-link" onClick={() => ui.openOpportunity(item.id)}>{item.title}</button> <span className="pe-small pe-muted">· {item.pipelineName} · {item.stageLabel}</span></li>)}</ul>
          ) : <EmptyState compact headingLevel={3} title="No opportunities recorded">Add a pipeline from Add view when you want to track a concrete outcome with this company.</EmptyState>
        )}
        {tab === 'notes' && <NotesPanel subjectKind="organization" subjectId={id} notes={detail.data.notes} reload={detail.reload} />}
      </SectionPanel>
      <CoverageFooter coverage={detail.data.coverage} />
      {editing && <EditCompanyDialog detail={detail.data} onClose={() => { setEditing(false); void detail.reload(); }} />}
      {removing && <RemoveDialog kind="organization" id={org.id} name={org.name} revision={org.revision} onClose={() => setRemoving(false)} />}
      {undo && <UndoMergeDialog mergeId={undo} onClose={() => { setUndo(null); void detail.reload(); }} />}
    </article>
  );
}

function PeopleList({ items }: { items: Affiliation[] }) {
  return (
    <ul className="pe-list">
      {items.map((item) => (
        <li key={item.id} className="pe-name-cell">
          <Avatar name={item.personName} size="sm" />
          <span className="pe-name-cell__text">
            <NameLink kind="person" id={item.personId} name={item.personName} />
            <span className="pe-name-cell__detail">{item.role ?? 'Role not recorded'}{item.confidence !== 'confirmed' ? ` · observed ${dayLabel(item.observedAt)}` : ''}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
function PeopleGroup({ title, items, empty, hint }: { title: string; items: Affiliation[]; empty: string; hint?: string }) {
  return (
    <section className="pe-stack" aria-label={title}>
      <h3 className="ri-h3">{title} <span className="pe-small pe-muted">{items.length}</span></h3>
      {hint && <p className="pe-small pe-muted">{hint}</p>}
      {items.length ? <PeopleList items={items} /> : <p className="pe-muted">{empty}</p>}
    </section>
  );
}

function DisableRule({ rule, reload }: { rule: { id: string; revision: number }; reload(): void }) {
  const apply = useSave<{ status: string }>('apply_company_attribution');
  return <Button size="sm" variant="link" busy={apply.pending} onClick={async () => { await apply.run({ ruleId: rule.id, expectedRevision: rule.revision, disable: true }, 'Rule disabled. Its links were removed and manual links kept'); apply.reset(); reload(); }}>Disable</Button>;
}

function EditCompanyDialog({ detail, onClose }: { detail: Detail; onClose(): void }) {
  const org = detail.organization;
  const [name, setName] = useState(org.name);
  const [website, setWebsite] = useState(org.website ?? '');
  const [kind, setKind] = useState<string>(org.kind ?? 'company');
  const save = useSave<{ status: string }>('save_organization');
  const announce = useAnnounce();
  return (
    <Dialog open title={`Edit ${org.name}`} description="Companies, nonprofits, communities, funds and schools all use the same record." onClose={onClose}
      footer={<ButtonRow align="end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.pending} onClick={async () => {
        const result = await save.run({ id: org.id, expectedRevision: org.revision, name: name.trim() || null, website: website.trim() || null, kind, ...(org.state === 'provisional' ? { confirm: true } : {}) });
        announce(result.status === 'saved' ? 'Saved' : 'This company changed. Reopen to try again');
        onClose();
      }}>Save</Button></ButtonRow>}>
      <div className="pe-stack">
        <TextInput label="Name" value={name} onChange={setName} />
        <TextInput label="Website" hint="Optional. A domain is a hint, not proof two records are the same" value={website} onChange={setWebsite} />
        <Select label="Type" value={kind} onChange={setKind} options={['company', 'nonprofit', 'community', 'fund', 'school', 'public', 'other'].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} />
        {org.state === 'provisional' && <p className="pe-small pe-muted">Saving confirms this provisional company from an import.</p>}
        {save.error && <InlineError>{save.error}</InlineError>}
      </div>
    </Dialog>
  );
}
