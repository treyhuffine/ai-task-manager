"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import {
  Search, Target, FileText, MessageSquare, X, Loader2,
  Plus, Sun, Moon, LayoutDashboard, ListTodo, StickyNote,
  Radio, MessagesSquare, Mic, Settings, Calendar,
  type LucideIcon,
} from 'lucide-react';
import { NoteIcon } from '@/components/shared/note-icon';
import { useSearch } from '@/hooks/use-search';
import { useDashboard } from '@/contexts/dashboard-context';
import { useCreateTask } from '@/hooks/use-tasks';
import { useCreateNote } from '@/hooks/use-notes';
import { useRecents } from '@/hooks/use-recents';
import {
  HOTKEYS, matchesHotkey,
  PALETTE_COMMANDS, TYPE_PREFIXES,
  type PaletteCommand, type EntityTypeFilter,
} from '@/constants/commands';
import { openSettings } from '@/components/settings/settings-store';
import type { SearchResult } from '@/lib/api/search';
import type { AnyPanelTab } from '@/types/dashboard';

// ── Icon lookup for palette commands ─────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Plus, StickyNote, LayoutDashboard, ListTodo, FileText, Radio, MessagesSquare, Sun, Moon, Mic, Settings, Calendar,
};

function CommandIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}

// ── Query parsing ────────────────────────────────────────────

function parseQuery(raw: string): { searchQuery: string; typeFilter: EntityTypeFilter | null; isCommand: boolean } {
  const trimmed = raw.trim();

  if (trimmed.startsWith('>')) {
    return { searchQuery: trimmed.slice(1).trim(), typeFilter: null, isCommand: true };
  }

  for (const [prefix, filter] of Object.entries(TYPE_PREFIXES)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return { searchQuery: trimmed.slice(prefix.length).trim(), typeFilter: filter, isCommand: false };
    }
  }

  return { searchQuery: trimmed, typeFilter: null, isCommand: false };
}

// ── Recent items hook ────────────────────────────────────────
// ── Entity icon helper ───────────────────────────────────────

function EntityIcon({ type, hasBody, className }: { type: string; hasBody?: boolean; className?: string }) {
  switch (type) {
    case 'task': return <Target size={14} className={className} />;
    case 'note': return <NoteIcon body={hasBody ? 'x' : ''} size={14} className={className} />;
    case 'stream': return <MessageSquare size={14} className={className} />;
    default: return null;
  }
}

// ── Group heading style ──────────────────────────────────────

const GROUP_CLASS = "px-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60";
const ITEM_CLASS = "flex items-center gap-3 px-2 py-2 rounded-md text-left cursor-pointer data-[selected=true]:bg-muted/50";

// ── Main component ───────────────────────────────────────────

export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const { searchQuery, typeFilter, isCommand } = parseQuery(rawQuery);
  const { data: results, isLoading } = useSearch(isCommand ? '' : searchQuery);
  const { openTask, openNote, toggleTheme, theme, setPanelTab, triggerVoiceChat } = useDashboard();
  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const { data: recents } = useRecents(25, open);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter results by type if prefix is active
  const filteredResults = typeFilter
    ? results?.filter((r) => r.entityType === typeFilter)
    : results;

  const handleSelect = useCallback((entityType: string, id: string) => {
    if (entityType === 'task') openTask(id);
    else if (entityType === 'note') openNote(id);
    setOpen(false);
  }, [openTask, openNote]);

  const handleNavigate = useCallback((tab: AnyPanelTab) => {
    setPanelTab('a', tab);
    setOpen(false);
  }, [setPanelTab]);

  // Command handlers keyed by command id
  const executeCommand = useCallback((cmd: PaletteCommand) => {
    switch (cmd.id) {
      case 'create-task':
        setOpen(false);
        createTask.mutate(
          { title: ' ', rawInput: ' ' },
          { onSuccess: (task) => openTask(task.id) },
        );
        break;
      case 'create-note':
        setOpen(false);
        createNote.mutate(
          { body: ' ' },
          { onSuccess: (note) => openNote(note.id) },
        );
        break;
      case 'open-settings':
        setOpen(false);
        openSettings();
        break;
      case 'toggle-theme':
        toggleTheme();
        setOpen(false);
        break;
      case 'voice-chat':
        setOpen(false);
        triggerVoiceChat();
        break;
      default:
        // go-* navigation commands
        if (cmd.id.startsWith('go-')) {
          handleNavigate(cmd.id.replace('go-', '') as AnyPanelTab);
        }
        break;
    }
  }, [createTask, createNote, openTask, openNote, toggleTheme, handleNavigate, triggerVoiceChat]);

  // Hotkey + custom event listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.search)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.initialQuery) {
        setRawQuery(detail.initialQuery);
        // Collapse selection to end after cmdk focuses and selects the input
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            const len = detail.initialQuery.length;
            el.setSelectionRange(len, len);
          }
        });
      }
      setOpen(true);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('open-search', handleOpen);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('open-search', handleOpen);
    };
  }, []);

  // Reset query when closed so next open starts fresh
  useEffect(() => {
    if (!open) setRawQuery('');
  }, [open]);

  // Scroll list to top when results change
  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
  }, [filteredResults]);

  // Resolve theme-aware icon name for toggle-theme command
  const getCommandIcon = (cmd: PaletteCommand) => {
    if (cmd.id === 'toggle-theme') return theme === 'dark' ? 'Sun' : 'Moon';
    return cmd.icon;
  };

  const getCommandLabel = (cmd: PaletteCommand) => {
    if (cmd.id === 'toggle-theme') return `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
    return cmd.label;
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search"
      shouldFilter={false}
      className="fixed inset-0 z-50"
    >
      <VisuallyHidden.Root>
        <DialogPrimitive.Title>Search</DialogPrimitive.Title>
        <DialogPrimitive.Description>Search tasks, notes, and stream or run commands</DialogPrimitive.Description>
      </VisuallyHidden.Root>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="relative mx-auto mt-[15vh] w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground flex-shrink-0" />
          <Command.Input
            ref={inputRef}
            value={rawQuery}
            onValueChange={setRawQuery}
            placeholder={isCommand ? 'Type a command...' : 'Search or type > for commands...'}
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
          />
          {isLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          {typeFilter && (
            <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-wider rounded">
              {typeFilter}
            </span>
          )}
          <button onClick={() => setOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <Command.List ref={listRef} className="max-h-[60vh] overflow-y-auto">
          <Command.Empty className="p-8 text-center text-muted-foreground text-[11px]">
            {searchQuery.length > 0
              ? `No results for \u201c${searchQuery}\u201d`
              : isCommand
                ? 'No matching commands'
                : 'Type to search across tasks, notes, and stream'}
          </Command.Empty>

          {/* ── Commands (> prefix) ─────────────────────────── */}
          {isCommand && (
            <Command.Group heading="Actions" className={GROUP_CLASS}>
              {PALETTE_COMMANDS
                .filter((cmd) =>
                  !searchQuery ||
                  `${cmd.label} ${cmd.keywords}`.toLowerCase().includes(searchQuery.toLowerCase()),
                )
                .map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.id}
                    onSelect={() => executeCommand(cmd)}
                    className={ITEM_CLASS}
                  >
                    <span className="text-muted-foreground flex-shrink-0">
                      <CommandIcon name={getCommandIcon(cmd)} />
                    </span>
                    <span className="text-[12px] font-medium flex-1">{getCommandLabel(cmd)}</span>
                    {cmd.shortcut && (
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-[9px] text-muted-foreground/60">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
            </Command.Group>
          )}

          {/* ── Recent items (empty query, no command mode) ── */}
          {!isCommand && searchQuery.length === 0 && recents && recents.length > 0 && (
            <Command.Group heading="Recent" className={GROUP_CLASS}>
              {recents.map((item) => (
                <Command.Item
                  key={`recent-${item.entityType}-${item.id}`}
                  value={`recent-${item.entityType}-${item.id}`}
                  onSelect={() => handleSelect(item.entityType, item.id)}
                  className={ITEM_CLASS}
                >
                  <EntityIcon type={item.entityType} hasBody={item.hasBody} className="text-primary/60 flex-shrink-0" />
                  <span className="text-[12px] font-medium leading-tight line-clamp-1 flex-1">
                    {item.title || '(untitled)'}
                  </span>
                  <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    {item.entityType}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {/* ── Search results ────────────────────────────── */}
          {!isCommand && filteredResults && filteredResults.length > 0 && (
            <Command.Group heading="Results" className={GROUP_CLASS}>
              {filteredResults.map((result) => (
                <SearchResultItem
                  key={`${result.entityType}-${result.id}`}
                  result={result}
                  onSelect={handleSelect}
                />
              ))}
            </Command.Group>
          )}
        </Command.List>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[9px] text-muted-foreground/50 flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">{'\u2191\u2193'}</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">{'\u23CE'}</kbd> open</span>
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">ESC</kbd> close</span>
          <div className="flex-1" />
          <span className="text-muted-foreground/40">
            <kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">&gt;</kbd> commands
            <span className="mx-1.5">&middot;</span>
            <kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">task:</kbd> filter
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}

// ── Search result item ───────────────────────────────────────

function SearchResultItem({
  result, onSelect,
}: {
  result: SearchResult;
  onSelect: (entityType: string, id: string) => void;
}) {
  const title = result.title || result.body || '(untitled)';

  return (
    <Command.Item
      value={`${result.entityType}-${result.id}`}
      onSelect={() => onSelect(result.entityType, result.id)}
      className="flex items-start gap-3 px-2 py-2 rounded-md text-left cursor-pointer data-[selected=true]:bg-muted/50"
    >
      <div className="mt-0.5 flex-shrink-0">
        <EntityIcon type={result.entityType} hasBody={!!result.body?.trim()} className="text-primary/60" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium leading-tight line-clamp-1">{title}</p>
        {result.description && (
          <p className="mt-0.5 text-[10.5px] text-muted-foreground leading-snug line-clamp-2">
            {result.description}
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {result.entityType}
          </span>
          <span className="text-[8px] text-muted-foreground/60">
            {new Date(result.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          {result.score != null && (
            <span className="text-[8px] text-muted-foreground/40">
              {(result.score * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </Command.Item>
  );
}
