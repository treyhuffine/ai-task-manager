/**
 * The runner's one sink, installed by whoever hosts the runner: the home's
 * sink in the home's server, a worker's journal on a connected computer.
 * Kept on `globalThis`, like the rest of the runner's state, so Next.js
 * module re-evaluation doesn't lose it.
 */

import type { RunnerSink } from './types';

const SINK_KEY = Symbol.for('@ri/runner-sink');
const globalRef = globalThis as unknown as { [SINK_KEY]?: RunnerSink };

export function installRunnerSink(sink: RunnerSink): void {
  globalRef[SINK_KEY] = sink;
}

export function runnerSink(): RunnerSink {
  const sink = globalRef[SINK_KEY];
  if (!sink) throw new Error('No runner sink installed. The runner has nowhere to report.');
  return sink;
}

export function hasRunnerSink(): boolean {
  return globalRef[SINK_KEY] !== undefined;
}
