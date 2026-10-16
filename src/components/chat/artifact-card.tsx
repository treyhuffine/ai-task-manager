'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Expand } from 'lucide-react';
import { Tip } from '@/components/ui/tip';

export function ArtifactCard({ name, icon, details, children, ...props }: ComponentProps<'button'> & { name: string; icon: ReactNode; details?: ReactNode }) {
  const [overTitle, setOverTitle] = useState(false);
  return (
    <span className="relative my-1 mx-0.5 inline-flex w-60 max-w-full flex-col overflow-hidden rounded-lg border border-border bg-muted/30 align-middle text-foreground transition-colors hover:border-foreground/30 focus-within:ring-2 focus-within:ring-ring">
      <span className="relative block aspect-[3/2] w-full overflow-hidden bg-muted/40">{children}</span>
      <Tip
        label={overTitle ? details ?? name : undefined}
        side="bottom"
        onlyWhenTextHidden={details == null}
        onFocus={() => setOverTitle(true)}
        onBlur={() => setOverTitle(false)}
        onPointerLeave={() => setOverTitle(false)}
        onPointerMove={event => {
          // The button's stretched click target covers the image, but hover
          // details belong to its visible filename footer only.
          const bounds = event.currentTarget.getBoundingClientRect();
          setOverTitle(event.clientY >= bounds.top && event.clientY <= bounds.bottom && event.clientX >= bounds.left && event.clientX <= bounds.right);
        }}
      >
        <button type="button" {...props} className="flex w-full items-center gap-1.5 border-t border-border px-2 py-2 text-left text-[11px] leading-normal outline-none after:absolute after:inset-0 after:content-['']">
          {icon}<span className="min-w-0 flex-1 truncate">{name}</span><Expand size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </Tip>
    </span>
  );
}
