'use client';

import type { ReactElement } from 'react';
import { Tip } from '@/components/ui/tip';

/** Show the whole destination without letting a long path take over the screen. */
export function FileSourceTip({ source, children, onlyWhenTextHidden = false }: { source: string; children: ReactElement; onlyWhenTextHidden?: boolean }) {
  return <Tip onlyWhenTextHidden={onlyWhenTextHidden} align="start" label={
    <span className="block max-h-60 overflow-y-auto whitespace-pre-wrap wrap-anywhere font-mono text-[11px]">{source}</span>
  }>{children}</Tip>;
}
