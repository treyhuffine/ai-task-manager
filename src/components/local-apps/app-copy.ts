import type { Tone } from '@/components/settings/sections/integrations/parts';
import type { LocalAppDraft, LocalAppInstance } from './app-hooks';

/** Chats that are an app's own (its builder, its try, its Ask Ri) can't also host an app beside them. */
export function isAppSurface(surfaceKind: string | null | undefined): boolean {
  return surfaceKind === 'app' || surfaceKind === 'app-builder' || surfaceKind === 'app-try';
}

/**
 * One line on an installed app's state, in the person's words, with the
 * tone the catalog tile's dot takes. A stopped app isn't broken: it starts
 * when opened, so it reads as ready and carries no dot.
 */
export function appCondition(instance: LocalAppInstance): { label: string; tone?: Tone } {
  if (instance.archived) return { label: 'Archived', tone: 'off' };
  if (!instance.enabled) {
    return instance.activation?.phase === 'failed'
      ? { label: 'Needs repair', tone: 'error' }
      : { label: 'Disabled', tone: 'off' };
  }
  switch (instance.runtime.condition) {
    case 'running':
      return { label: 'Running', tone: 'ok' };
    case 'starting':
      return { label: 'Starting' };
    case 'waiting_approval':
      return { label: 'Waiting for your approval', tone: 'warn' };
    case 'failed':
      return { label: 'Failed', tone: 'error' };
    default:
      return { label: 'Ready' };
  }
}

/** A draft has no name of its own: it's a new app, or a change to one you have. */
export function draftTitle(draft: Pick<LocalAppDraft, 'sourceInstanceId' | 'catalogSource'>, instances: readonly Pick<LocalAppInstance, 'id' | 'displayName'>[]): string {
  if (!draft.sourceInstanceId) return draft.catalogSource?.name ?? 'New app';
  const source = instances.find((item) => item.id === draft.sourceInstanceId);
  return source ? `Change ${source.displayName}` : 'Change app';
}

export function buildStatus(draft: Pick<LocalAppDraft, 'buildStatus'>): { label: string; tone?: Tone } {
  switch (draft.buildStatus) {
    case 'building':
      return { label: 'Building', tone: 'ok' };
    case 'validated':
      return { label: 'Preview ready', tone: 'ok' };
    case 'failed':
      return { label: 'Build failed', tone: 'error' };
    default:
      return { label: 'Not built yet' };
  }
}
