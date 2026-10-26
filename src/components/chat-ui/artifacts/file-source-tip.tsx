'use client';

import type { ComponentProps } from 'react';
import { Tip } from '@/components/ui/tip';

/** Show the whole destination without letting a long path take over the screen. */
export function FileSourceTip({ source, children, ...props }: Omit<ComponentProps<typeof Tip>, 'label'> & { source: string }) {
  return <Tip align="start" {...props} label={
    <span className="block max-h-60 overflow-y-auto whitespace-pre-wrap wrap-anywhere font-mono text-[11px]">{source}</span>
  }>{children}</Tip>;
}
