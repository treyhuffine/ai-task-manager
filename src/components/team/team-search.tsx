'use client';

import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HOTKEYS, matchesHotkey, PALETTE_COMMANDS, type PaletteCommand } from '@/constants/commands';
import { CommandSearchItems } from '@/components/shared/command-search-items';
import { useRecents } from '@/hooks/use-recents';
import { parseSearchQuery } from '@/lib/client/search-query';
import { RecentSearchItems } from '@/components/shared/recent-search-items';
import { SearchPalette } from '@/components/shared/search-palette';
import { useSearch } from '@/hooks/use-search';
import { trpc } from '@/lib/trpc/client';
import { apiErrorText } from '@/lib/api/client';
import { useTeamCreateRecord } from './use-team-create-record';
import { useTeamNav } from './team-context';

/** Team context supplies destinations and its shared chat search to the common palette. */
export function TeamSearch() {
  const nav = useTeamNav();
  const open = nav.panel === 'search';
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    // cmdk selects the field on open. Leave a supplied prefix intact for typing.
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    const show = (initialQuery = '') => { setQuery(initialQuery); nav.openPanel('search'); };
    const onOpen = (event: Event) => show((event as CustomEvent<{ initialQuery?: string }>).detail?.initialQuery);
    const onKey = (event: KeyboardEvent) => { if (matchesHotkey(event, HOTKEYS.search)) { event.preventDefault(); show(); } };
    document.addEventListener('open-search', onOpen);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('open-search', onOpen); document.removeEventListener('keydown', onKey); };
  }, [nav]);
  const parsed = parseSearchQuery(query);
  const recent = useRecents(25, open);
  const deferred = useDeferredValue(open && !parsed.isCommand ? parsed.searchQuery : '');
  const results = useSearch(deferred, 'keyword', parsed.typeFilter === 'decision' ? 'decision' : undefined);
  const chats = useQuery({ ...trpc.team.ai.searchChats.queryOptions({ query: deferred }), enabled: open && deferred.length > 0 && !parsed.typeFilter && !parsed.isCommand });
  const create = useTeamCreateRecord();
  const close = () => { setQuery(''); nav.openPanel(null); };
  const execute = (command: PaletteCommand) => {
    close();
    switch (command.id) {
      case 'create-task': void create.task(); break;
      case 'create-note': void create.note(); break;
      case 'go-tasks': case 'open-board': nav.show('board'); break;
      case 'go-notes': nav.show('notes'); break;
      case 'go-chat': nav.show('chat'); break;
      case 'open-settings': nav.openPanel('settings'); break;
    }
  };
  const commands = PALETTE_COMMANDS.filter(command => ['create-task', 'create-note', 'go-tasks', 'open-board', 'go-notes', 'go-chat', 'open-settings'].includes(command.id));
  return <SearchPalette inputRef={inputRef} open={open} onOpenChange={next => { if (!next) close(); }} query={query} onQueryChange={setQuery}
    placeholder={parsed.isCommand ? 'Type a command...' : 'Search or type > for commands...'} searchQuery={parsed.isCommand ? '' : parsed.searchQuery} typeFilter={parsed.typeFilter} results={(results.data ?? []).filter(result => !parsed.typeFilter || result.entityType === (parsed.typeFilter === 'decision' ? 'note' : parsed.typeFilter))} chats={parsed.typeFilter ? [] : chats.data ?? []}
    beforeResults={parsed.isCommand ? <CommandSearchItems commands={commands} query={parsed.searchQuery} onSelect={execute}/> : !parsed.searchQuery && <RecentSearchItems items={(recent.data ?? []).filter(item => !parsed.typeFilter || item.entityType === parsed.typeFilter)} onSelect={(type, id) => { close(); if (type === 'task') nav.openTask(id); else nav.openNote(id); }} />}
    searching={!parsed.isCommand && (deferred !== parsed.searchQuery || results.isFetching || chats.isFetching)} fetching={results.isFetching || chats.isFetching}
    error={results.error || chats.error ? apiErrorText(results.error ?? chats.error) : null}
    onRetry={() => { void results.refetch(); void chats.refetch(); }}
    onSelect={(type, id) => { close(); if (type === 'task') nav.openTask(id); else if (type === 'note') nav.openNote(id); }}
    onChat={id => { setQuery(''); nav.openChat(id); }}/>;
}
