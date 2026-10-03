'use client';

import type { CSSProperties } from 'react';
import { APP_NAME } from '@/constants/app';
import { useOrchestratorIdentity } from '@/hooks/use-user-state';
import { orchestratorInitial } from '@/lib/orchestrator/name';
import { textColorOn } from '@/lib/orchestrator/look';
import { cn } from '@/lib/utils';

const SIZES = {
  xs: { box: 'size-4 rounded', text: 'text-[9px]', emoji: 'text-[10px]', logo: 'size-2.5' },
  sm: { box: 'size-5 rounded-md', text: 'text-[11px]', emoji: 'text-[12px]', logo: 'size-3' },
  md: { box: 'size-7 rounded-lg', text: 'text-[13px]', emoji: 'text-[16px]', logo: 'size-4' },
  lg: { box: 'size-10 rounded-xl', text: 'text-[17px]', emoji: 'text-[22px]', logo: 'size-6' },
  xl: { box: 'size-16 rounded-2xl', text: 'text-[26px]', emoji: 'text-[34px]', logo: 'size-9' },
} as const;

export type OrchestratorMarkSize = keyof typeof SIZES;

/** The Ri mark, drawn in the current text color so it reads on any background. */
const LOGO_MASK: CSSProperties = {
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

/**
 * The orchestrator's face, wherever the user sees it: the rail's home row
 * (its initial in the skinny rail and on tablets), the main chat's header, its
 * messages in the first-run conversation, and the editor's preview. What it
 * draws, in order (src/lib/orchestrator/look.ts):
 *
 *   1. its image, uploaded or made in the app,
 *   2. its emoji, on its color,
 *   3. the Ri mark, for the default name,
 *   4. its initial.
 *
 * The emoji, mark and initial sit on the chosen color, else the theme's
 * primary. Decorative: the name or a label always travels with it. Props
 * override the stored look, which is how the editor previews a draft.
 */
export function OrchestratorMark({
  name,
  emoji = null,
  imageUrl = null,
  color = null,
  size = 'sm',
  className,
}: {
  name: string;
  emoji?: string | null;
  imageUrl?: string | null;
  color?: string | null;
  size?: OrchestratorMarkSize;
  className?: string;
}) {
  const dims = SIZES[size];
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" aria-hidden className={cn('flex-shrink-0 object-cover', dims.box, className)} />
    );
  }
  const colored = color ? { backgroundColor: color, color: textColorOn(color) } : undefined;
  return (
    <span
      aria-hidden
      style={colored}
      className={cn(
        'flex flex-shrink-0 select-none items-center justify-center font-bold leading-none',
        !colored && (emoji ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground'),
        dims.box,
        className,
      )}
    >
      {emoji ? (
        <span className={dims.emoji}>{emoji}</span>
      ) : name === APP_NAME ? (
        <span className={dims.logo} style={LOGO_MASK} />
      ) : (
        <span className={dims.text}>{orchestratorInitial(name)}</span>
      )}
    </span>
  );
}

/** The orchestrator as it's stored: name and look from user state. */
export function OrchestratorAvatar({ size, className }: { size?: OrchestratorMarkSize; className?: string }) {
  const identity = useOrchestratorIdentity();
  return <OrchestratorMark {...identity} size={size} className={className} />;
}
