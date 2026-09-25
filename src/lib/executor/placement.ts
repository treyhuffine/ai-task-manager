/**
 * Which runner holds a chat's harness (docs/homes-build.md, P2.1 and P2.4):
 * the home's own runner for a chat that runs here, with the home's sink
 * installed to receive what it reports, or the remote runner for the
 * connected computer its placement names.
 */

import { chatPlacement } from '@/lib/db/queries';
import { localRunner } from '@/lib/runner/local-runner';
import type { ExecutionRunner } from '@/lib/runner/types';
import { installHomeSink } from './home-sink';
import { remoteRunnerFor } from './remote-runner';

export function runnerFor(chatSessionId: string): ExecutionRunner {
  const placement = chatPlacement(chatSessionId);
  if (placement && !placement.isHome) return remoteRunnerFor(placement.computerId);
  installHomeSink();
  return localRunner;
}
