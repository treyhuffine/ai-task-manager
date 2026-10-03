import type { ActionState, OpenablePr } from '@/hooks/use-execution-actions';

/**
 * The PR the git chip names, whatever state git is in. PR states carry their
 * own PR (a closed one reads as closed). Every other state falls back to the
 * session's openable PR: a linked PR GitHub hasn't confirmed, a closed PR
 * under a dirty tree, or a PR whose branch couldn't be fetched.
 */
export function narrativePr(state: ActionState, openablePr: OpenablePr | null): OpenablePr | null {
  switch (state.kind) {
    case 'prOpenInSync':
    case 'prOpenAhead':
    case 'prOpenBehindBase':
    case 'prConflictingWithBase':
    case 'prMergeable':
    case 'prMerged':
      return { number: state.prNumber, url: state.prUrl, closed: false };
    case 'prClosed':
      return { number: state.prNumber, url: state.prUrl, closed: true };
    case 'dirty':
    case 'behindRemote':
      return state.pr ? { number: state.pr.prNumber, url: state.pr.prUrl, closed: false } : openablePr;
    default:
      return openablePr;
  }
}
