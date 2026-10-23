'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useSpace } from '@/components/spaces/space-root';
import { spacePath } from '@/lib/spaces/document';

/** A saved resource stays in its owning document when viewed through a connection. */
export function HomeLink({ href, ...props }: ComponentProps<typeof Link>) {
  const space = useSpace();
  const destination = space && typeof href === 'string' && (href === '/' || href.startsWith('/?') || href === '/results' || href.startsWith('/results/'))
    ? spacePath(space.id) + (href === '/' ? '' : href.startsWith('/?') ? href.slice(1) : href) : href;
  return <Link {...props} href={destination} />;
}
