'use client';
import { useState } from 'react';
import { Bot } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useWorkspace, useWorkspaces, useUpdateWorkspace } from '@/hooks/use-workspaces';
import { IntegrationScopePicker } from '@/components/workspaces/integration-scope-picker';
import { AgentIcon } from '@/components/agents/agent-icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AppGrantEditor } from '../../grant-editor';
import { useReview } from '../context';
import { ItemDetails } from '../details';
import { ItemRow } from '../items';
import { Header, Discovery, SectionTitle, Empty } from '../shared';
import s from '../review.module.css';

export function AgentTools() {
  const review = useReview();
  const dashboard = useDashboard();
  const agents = useWorkspaces({ status: 'active' });
  const selectedId = review.query.reviewAgent ?? agents.data?.[0]?.id ?? null;
  const agent = useWorkspace(selectedId);
  const update = useUpdateWorkspace();
  const [accessId, setAccessId] = useState<string | null>(null);
  const skills = review.sources.skills.data?.skills.filter(skill => skill.location.kind === 'ri' || skill.location.kind === 'global' || (skill.location.kind === 'project' && skill.location.workspaceId === selectedId)) ?? [];
  const skillRefs = new Set(skills.map(skill => skill.ref));
  const apps = review.library.filter(item => item.target.kind === 'app');
  return <><Header title="Agent tools" subtitle="Give an agent the right context and tools." /><div className={s.agentBanner}>
    {agent.data ? <AgentIcon workspace={agent.data} /> : <Bot size={18} />}<label className="min-w-0"><span className="sr-only">Agent</span><select aria-label="Agent" value={selectedId ?? ''} onChange={event => review.patch({ reviewAgent: event.target.value })}>{!agents.data?.length && <option value="">Choose an agent</option>}{agents.data?.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><span className={`${s.muted} min-w-0 flex-1`}>{agent.data?.purpose}</span>{agent.data && <Button size="xs" variant="outline" onClick={() => dashboard.openAgent(agent.data!.id)}>Open agent</Button>}
  </div><div className={s.columns}><section className={s.owned}>
    {agents.error || agent.error ? <Empty>Could not load agents.<Button size="xs" onClick={() => { void agents.refetch(); void agent.refetch(); }}>Retry</Button></Empty> : !selectedId ? <Empty>Create an agent from Ri’s Agents view to choose its tools here.</Empty> : !agent.data ? <p role="status" className={s.muted}>Loading agent…</p> : <>
      <SectionTitle>{agent.data.name} can use</SectionTitle><p className={`${s.muted} mb-4`}>Choose the connected accounts this agent can access.</p>
      <IntegrationScopePicker scopes={agent.data.integrationScopes} disabled={update.isPending} onChange={integrationScopes => update.mutate({ id: agent.data!.id, integrationScopes })} />
      <section className={s.section}><SectionTitle>App access</SectionTitle>{apps.map(item => <ItemRow key={item.key} item={item}><Button size="xs" variant="outline" onClick={() => { if (item.target.kind === 'app') setAccessId(item.target.id); }}>Access</Button></ItemRow>)}{!apps.length && <p className={s.muted}>Install an app to give this agent access to it.</p>}</section>
      <section className={s.section}><SectionTitle count={skills.length}>Skills</SectionTitle>{review.library.filter(item => item.target.kind === 'skill' && skillRefs.has(item.target.ref)).map(item => <ItemRow key={item.key} item={item} />)}{!skills.length && <p className={s.muted}>Install a skill for Ri or this agent’s project to make it available here.</p>}</section>
      <section className={s.section}><SectionTitle>Standing instructions</SectionTitle><p className={`${s.muted} whitespace-pre-wrap`}>{agent.data.instructions || 'No standing instructions yet.'}</p></section>
    </>}
  </section><section className={s.catalogPane}>{review.selected ? <ItemDetails item={review.selected} /> : <Discovery heading={agent.data ? `Discover for ${agent.data.name}` : 'Discover'} initial={8} />}</section></div>
    <Dialog open={!!accessId} onOpenChange={open => { if (!open) setAccessId(null); }}><DialogContent className="max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>App access for {agent.data?.name}</DialogTitle></DialogHeader>{accessId && selectedId && <AppGrantEditor key={`${accessId}:${selectedId}`} instanceId={accessId} principal={{ kind: 'workspace', id: selectedId }} onSaved={() => setAccessId(null)} />}</DialogContent></Dialog>
  </>;
}
