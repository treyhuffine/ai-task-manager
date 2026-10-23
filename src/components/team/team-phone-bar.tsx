'use client';

import { Bot, FileText, KanbanSquare, MessageCircle, Plus, Settings } from 'lucide-react';
import { HomePhoneBar } from '@/components/mobile/mobile-tab-bar';
import { useTeamCreateRecord } from './use-team-create-record';
import { useTeamNav } from './team-context';

/** Team creation defaults around the shared phone navigation. */
export function TeamPhoneBar({ showChat, showAgents }: { showChat: boolean; showAgents: boolean }) {
  const nav = useTeamNav();
  const create = useTeamCreateRecord();
  const add = () => nav.view === 'notes' ? create.note() : create.task();
  return <HomePhoneBar tabs={[
    { id: 'tasks', label: 'Tasks', icon: KanbanSquare, active: nav.view === 'board', onClick: () => nav.show('board') },
    { id: 'notes', label: 'Notes', icon: FileText, active: nav.view === 'notes', onClick: () => nav.show('notes') },
    ...(showChat ? [{ id: 'chat', label: 'Chat', icon: MessageCircle, active: nav.view === 'chat', onClick: () => nav.show('chat') }] : []),
    ...(showAgents ? [{ id: 'agents', label: 'Agents', icon: Bot, active: nav.view === 'agents', onClick: () => nav.show('agents') }] : []),
    ...(['board', 'notes'].includes(nav.view) ? [{ id: 'create', label: '', ariaLabel: nav.view === 'notes' ? nav.decisions ? 'New decision' : 'New note' : 'New task', icon: Plus, onClick: () => void add() }] : []),
    { id: 'settings', label: 'Settings', icon: Settings, active: nav.panel === 'settings', onClick: () => nav.openPanel('settings') },
  ]}/>;
}
