/**
 * Which runner holds a chat's harness. Every chat runs on the home's own
 * computer until sessions run on connected computers (P2.4), so this is the
 * local runner, with the home's sink installed to receive what it reports.
 */

import { localRunner } from '@/lib/runner/local-runner';
import type { ExecutionRunner } from '@/lib/runner/types';
import { installHomeSink } from './home-sink';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the chat picks the runner from P2.4
export function runnerFor(_chatSessionId: string): ExecutionRunner {
  installHomeSink();
  return localRunner;
}
