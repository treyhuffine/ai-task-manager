'use client';

import type { MouseEventHandler, ReactNode, RefCallback } from 'react';
import { Expand, ExternalLink } from 'lucide-react';
import { Tip } from '@/components/ui/tip';

interface ArtifactCardProps {
  name: string;
  icon: ReactNode;
  children: ReactNode;
  ref?: RefCallback<HTMLElement>;
  'aria-label': string;
  'aria-description'?: string;
  /** Open an outside address in a new tab instead of a preview here. */
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const ACTION_CLASS = "flex w-full items-center gap-1.5 border-t border-border px-2 py-2 text-left text-[11px] leading-normal outline-none after:absolute after:inset-0 after:content-['']";

export function ArtifactCard({ name, icon, children, ref, href, onClick, ...labels }: ArtifactCardProps) {
  return (
    <Tip label={name} onlyWhenTextHidden>
      <span className="relative my-1 mx-0.5 inline-flex w-60 max-w-full flex-col overflow-hidden rounded-lg border border-border bg-muted/30 align-middle text-foreground transition-colors hover:border-foreground/30 focus-within:ring-2 focus-within:ring-ring">
        <span className="relative block aspect-[3/2] w-full overflow-hidden bg-muted/40">{children}</span>
        {href
          ? (
            <a ref={ref} href={href} target="_blank" rel="noreferrer noopener" {...labels} className={ACTION_CLASS}>
              {icon}<span className="min-w-0 flex-1 truncate">{name}</span><ExternalLink size={12} className="shrink-0 text-muted-foreground" />
            </a>
          )
          : (
            <button ref={ref} type="button" onClick={onClick} {...labels} className={ACTION_CLASS}>
              {icon}<span className="min-w-0 flex-1 truncate">{name}</span><Expand size={12} className="shrink-0 text-muted-foreground" />
            </button>
          )}
      </span>
    </Tip>
  );
}
