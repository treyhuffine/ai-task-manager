'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTIONS, GET_STARTED_SECTION, type SectionId } from './settings-sections';

/**
 * Left-hand navigation for the settings modal. Vertical sidebar on sm+, a
 * horizontally-scrolling strip on mobile. Rows derive entirely from SECTIONS,
 * so nav and content can never disagree. Search filters by label. The
 * "Get started" entry is pinned on top while setup is incomplete.
 */
export function SettingsNav({
  active,
  onSelect,
  getStarted,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  /** When set, pins the Get-started entry on top with a done/total count. */
  getStarted?: { done: number; total: number } | null;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const sections = q
    ? SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
    : SECTIONS;

  return (
    <nav
      className={cn(
        'flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/20 p-2',
        'sm:w-56 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3',
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
          aria-label="Search settings"
          className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {getStarted && !q && (
        <button
          type="button"
          onClick={() => onSelect('get-started')}
          aria-current={active === 'get-started' ? 'page' : undefined}
          className={cn(
            'mb-0.5 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
            active === 'get-started'
              ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          )}
        >
          <GET_STARTED_SECTION.icon
            size={15}
            className={cn('shrink-0', active === 'get-started' ? 'text-foreground' : 'text-muted-foreground')}
          />
          <span>{GET_STARTED_SECTION.label}</span>
          <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-primary">
            {getStarted.done}/{getStarted.total}
          </span>
        </button>
      )}

      {sections.map((section) => {
        const Icon = section.icon;
        const isActive = section.id === active;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
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

      {sections.length === 0 && (
        <p className="hidden px-2 py-3 text-[12px] text-muted-foreground sm:block">No settings match “{query}”.</p>
      )}
    </nav>
  );
}
