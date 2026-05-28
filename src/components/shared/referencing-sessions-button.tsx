'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Link as LinkIcon, MessageSquare, ChevronRight } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ReferencingSession {
  id: string;
  label: string | null;
  workspaceId: string | null;
  type: string;
  status: string;
  startedAt: string;
  lastOutcomeEventAt: string | null;
}

interface ReferencingSessionsResponse {
  sessions: ReferencingSession[];
}

interface ReferencingSessionsButtonProps {
  entityType: 'task' | 'note' | 'area';
  entityId: string;
}

/**
 * Compact `🔗 N` button rendered on task / note slideout headers.
 * Hits the reverse-lookup endpoint to count sessions that reference
 * this entity, opens a popover listing them on click. Each row jumps
 * the user to that execution session.
 *
 * The query runs lazily — N is only fetched on first mount of the
 * button, not every time the slideout opens (per-entity React Query
 * cache lives for the page).
 */
export function ReferencingSessionsButton({ entityType, entityId }: ReferencingSessionsButtonProps) {
  const { setActiveView } = useDashboard();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ['entity-sessions', entityType, entityId] as const,
    queryFn: () =>
      api.get<ReferencingSessionsResponse>('/entities/sessions', {
        query: { type: entityType, id: entityId },
      }),
    enabled: !!entityId,
    staleTime: 30_000,
  });

  const count = query.data?.sessions.length ?? 0;
  if (query.isLoading && count === 0) return null; // initial-load suppression — avoids a flash
  if (count === 0) return null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors',
          )}
          title={`Referenced in ${count} session${count === 1 ? '' : 's'}`}
          aria-label={`${count} sessions reference this`}
        >
          <LinkIcon size={11} />
          <span>{count}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover shadow-xl pointer-events-auto outline-none"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold border-b border-border">
            Referenced in {count} session{count === 1 ? '' : 's'}
          </div>
          <ul className="max-h-[300px] overflow-y-auto py-1">
            {query.data?.sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setActiveView(s.id);
                  }}
                  className={cn(
                    'group flex items-center gap-2 w-full px-3 py-1.5 text-left',
                    'hover:bg-muted/60 transition-colors',
                  )}
                >
                  <MessageSquare size={11} className="text-muted-foreground/70 shrink-0" />
                  <span className="flex-1 min-w-0 text-[12px] text-foreground truncate">
                    {s.label || 'Untitled session'}
                  </span>
                  <ChevronRight
                    size={11}
                    className="text-muted-foreground/40 group-hover:text-foreground shrink-0"
                  />
                </button>
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
