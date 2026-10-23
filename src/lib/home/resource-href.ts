import { spacePath } from '@/lib/spaces/document';

/** Public resource routes retain their owning Home in new tabs and document links. */
export function homeResourceHref(kind: 'task' | 'note' | 'session' | 'agent', id: string, context?: { kind: 'personal' | 'team'; spaceId?: string | null }) {
  if (context?.kind === 'team') return `${context.spaceId ? spacePath(context.spaceId) : '/'}?${kind === 'agent' ? 'view=agents&agent' : kind}=${encodeURIComponent(id)}`;
  return kind === 'task' || kind === 'note' ? `/${kind}/${encodeURIComponent(id)}` : `/?${kind}=${encodeURIComponent(id)}`;
}
