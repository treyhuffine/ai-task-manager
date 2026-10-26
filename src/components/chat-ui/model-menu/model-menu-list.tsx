'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CommandList } from '@/components/ui/command';

/** Keep the search and settings fixed, and make clipped choices explicit. */
export function ModelMenuList({ children }: { children: ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const above = list.scrollTop > 1;
      const below = list.scrollHeight - list.clientHeight - list.scrollTop > 1;
      setEdges(current => current.above === above && current.below === below ? current : { above, below });
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    // cmdk resizes its inner sizer when search or provider expansion changes.
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    list.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener('scroll', update);
    };
  }, []);

  const scroll = (direction: number) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({
      top: direction * Math.max(48, list.clientHeight - 64),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={(event) => {
      // cmdk treats Enter anywhere in its tree as selecting the current model.
      if (event.key === 'Enter' && (event.target as HTMLElement).closest('button')) event.stopPropagation();
    }}>
      <CommandList ref={listRef} className="min-h-0 max-h-none flex-1 scroll-py-8 p-1.5 [scrollbar-width:thin]">
        {children}
      </CommandList>
      {edges.above && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-9 items-start justify-center bg-gradient-to-b from-popover via-popover/95 to-transparent">
          <button type="button" onClick={() => scroll(-1)} className="pointer-events-auto flex items-center gap-1 rounded-full bg-popover px-3 py-1 text-[10.5px] text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronUp size={12} />
            More models above
          </button>
        </div>
      )}
      {edges.below && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-9 items-end justify-center bg-gradient-to-t from-popover via-popover/95 to-transparent">
          <button type="button" onClick={() => scroll(1)} className="pointer-events-auto flex items-center gap-1 rounded-full bg-popover px-3 py-1 text-[10.5px] text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            More models below
            <ChevronDown size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
