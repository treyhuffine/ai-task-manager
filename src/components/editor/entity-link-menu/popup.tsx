'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import { Square, StickyNote } from 'lucide-react';
import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import { cn } from '@/lib/utils';
import type { SuggestionPopupRef } from '@/components/chat/editor/suggestion/renderer';
import type { EntityLinkItem } from './types';

interface Props {
  items: EntityLinkItem[];
  command: (item: EntityLinkItem) => void;
}

/**
 * `[[` picker list. Reuses the chat suggestion renderer's imperative
 * key-handling contract (SuggestionPopupRef) but renders a task/note menu.
 */
export const EntityLinkMenuList = forwardRef<SuggestionPopupRef, Props>(
  function EntityLinkMenuList({ items, command }, ref) {
    const [selected, setSelected] = useState(0);
    // Reset the highlight to the top whenever the result set changes. Done
    // during render (React's "adjust state on prop change" pattern) rather
    // than in an effect, to avoid a cascading re-render each keystroke.
    const [prevItems, setPrevItems] = useState(items);
    if (items !== prevItems) {
      setPrevItems(items);
      setSelected(0);
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    return (
      <div className="max-w-md rounded-lg border border-border bg-popover shadow-lg overflow-hidden py-1 text-sm">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground text-xs">Search tasks and notes...</div>
        ) : (
          items.map((item, i) => {
            const Icon = item.kind === 'task' ? Square : StickyNote;
            const label =
              item.title.trim() || (item.kind === 'task' ? 'Untitled task' : 'Untitled note');
            return (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  command(item);
                }}
                onMouseEnter={() => setSelected(i)}
                className={cn(
                  'flex items-center gap-2 w-full text-left px-3 py-1.5',
                  i === selected ? 'bg-accent text-accent-foreground' : 'text-foreground/90',
                )}
              >
                <Icon size={13} className="shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">{label}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                  {item.kind}
                </span>
              </button>
            );
          })
        )}
      </div>
    );
  },
);
