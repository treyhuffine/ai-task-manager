import { createRedactor } from '@connectors/engine';

interface RuntimeRedactionState {
  redactor: ReturnType<typeof createRedactor>;
}

const STATE_KEY = Symbol.for('@flow/agent-runtime-redactor');
const globalRef = globalThis as unknown as { [STATE_KEY]?: RuntimeRedactionState };
if (!globalRef[STATE_KEY]) globalRef[STATE_KEY] = { redactor: createRedactor() };

const state = globalRef[STATE_KEY]!;

/** Register exact secret bytes as soon as they are opened for a child process. */
export function registerAgentRuntimeSecret(value: string, label: string): void {
  state.redactor.register(value, label);
}

/** Deep-scrub provider events before logs, telemetry, realtime, or SQLite. */
export function redactAgentRuntimeValue<T>(value: T): T {
  return state.redactor.redact(value);
}
