'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTIONS, GET_STARTED_SECTION, type SectionId } from './settings-sections';

/** Shared desktop sidebar and mobile navigation for personal and team settings. */
export interface SettingsNavItem<Id extends string> {
  id: Id;
  label: string;
  title: string;
  icon: LucideIcon;
  badge?: string;
}

export function SettingsNavigation<Id extends string>({
  active, onSelect, sections, label = 'Settings', pinned,
}: {
  active: Id;
  onSelect: (id: Id) => void;
  sections: readonly SettingsNavItem<Id>[];
  label?: string;
  pinned?: SettingsNavItem<Id> & { count: string };
}) {
  const [query, setQuery] = useState('');
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeButton.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? sections.filter((s) => s.label.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
    : sections;

  return (
    <nav
      aria-label={label}
      className={cn(
        'mr-12 flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/20 p-2',
        'sm:mr-0 sm:w-56 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3',
      )}
    >
      <div className="relative mb-1 hidden sm:block">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label={`Search ${label.toLowerCase()}`}
          className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {pinned && !q && (
        <button
          type="button"
          onClick={() => onSelect(pinned.id)}
          ref={active === pinned.id ? activeButton : undefined}
          aria-current={active === pinned.id ? 'page' : undefined}
          className={cn(
            'mb-0.5 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
            active === pinned.id
              ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          )}
        >
          <pinned.icon
            size={15}
            className={cn('shrink-0', active === pinned.id ? 'text-foreground' : 'text-muted-foreground')}
          />
          <span>{pinned.label}</span>
          <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-primary">
            {pinned.count}
          </span>
        </button>
      )}

      {matches.map((section) => {
        const Icon = section.icon;
        const isActive = section.id === active;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            ref={isActive ? activeButton : undefined}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
              isActive
                ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            <Icon size={15} className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
            <span>{section.label}</span>
            {section.badge && (
              <span className="ml-auto hidden rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline-block">
                {section.badge}
              </span>
            )}
          </button>
        );
      })}

      {matches.length === 0 && (
        <p className="hidden px-2 py-3 text-[12px] text-muted-foreground sm:block">No settings match “{query}”.</p>
      )}
    </nav>
  );
}

/** Personal settings retain their conditional, pinned setup checklist. */
export function SettingsNav({ active, onSelect, getStarted }: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  getStarted?: { done: number; total: number } | null;
}) {
  return <SettingsNavigation active={active} onSelect={onSelect} sections={SECTIONS}
    pinned={getStarted ? { ...GET_STARTED_SECTION, count: `${getStarted.done}/${getStarted.total}` } : undefined} />;
}
