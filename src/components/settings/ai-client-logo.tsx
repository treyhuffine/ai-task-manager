'use client';

import type { CSSProperties } from 'react';
import { isDarkBrandMark } from '@/components/integrations/integration-logo';
import type { AiClientLogoId } from '@/lib/external-ai/client-config';
import { cn } from '@/lib/utils';
import { AI_CLIENT_EXTRA_LOGOS } from './ai-client-logo-data';
import { HARNESS_LOGOS, type HarnessLogo } from './harness-logo-data';

/** The Ri mark, drawn in the current text color. */
const RI_MASK: CSSProperties = {
  backgroundColor: 'currentColor',
  WebkitMaskImage: 'url(/brand/ri-mark.svg)',
  maskImage: 'url(/brand/ri-mark.svg)',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
};

function logoFor(id: Exclude<AiClientLogoId, 'ri'>): HarnessLogo {
  return id in HARNESS_LOGOS ? HARNESS_LOGOS[id as keyof typeof HARNESS_LOGOS] : AI_CLIENT_EXTRA_LOGOS[id as keyof typeof AI_CLIENT_EXTRA_LOGOS];
}

/**
 * An outside agent's real mark on a tile, the way Models draws a harness:
 * in its brand color, or the text color for a near-black mark so it shows in
 * dark mode. Decorative: its name always sits beside it.
 */
export function AiClientLogo({ id, size = 15 }: { id: AiClientLogoId; size?: number }) {
  const tile = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 ring-1 ring-inset ring-border/50';
  if (id === 'ri') {
    return <span aria-hidden className={cn(tile, 'text-foreground')}><span style={{ ...RI_MASK, width: size, height: size }} /></span>;
  }
  const logo = logoFor(id);
  const dark = isDarkBrandMark(logo.hex);
  return (
    <span aria-hidden className={cn(tile, dark && 'text-foreground')} style={dark ? undefined : { color: `#${logo.hex}` }}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className="shrink-0">
        <path d={logo.path} fillRule={logo.evenOdd ? 'evenodd' : undefined} clipRule={logo.evenOdd ? 'evenodd' : undefined} />
      </svg>
    </span>
  );
}
