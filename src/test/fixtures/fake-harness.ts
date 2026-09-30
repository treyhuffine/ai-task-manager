/**
 * A scriptable harness for runner, delivery and ownership tests.
 *
 * `installFakeHarness('claude')` replaces the agentex provider behind a Ri
 * harness with one that spawns no process. The provider keeps the real
 * module's static capabilities, reports itself installed and logged in,
 * lists one model, and creates `FakeSession`s that follow the real event
 * order: `system` init on the first turn, then `turn_start`, whatever the
 * turn script emits, `result`, and `turn_end`.
 *
 * Each turn runs the current script. It can say things, raise a permission
 * prompt or question and wait for the host's answer, emit raw events, and
 * return a result. Tests can also interrupt, crash, or close a session to
 * exercise recovery. `restore()` puts the real provider back.
 */

import { getProvider, registerProvider } from '@agentex/agent';
import type {
  AgentSession,
  ProviderModule,
  ProviderRuntimeReport,
  SendHandle,
  SessionContext,
  SessionState,
  StreamEvent,
  TurnResult,
  UserInputRequest,
  UserInputResponse,
} from '@agentex/agent';
import { uuidv7 } from 'uuidv7';
import { HARNESS_REGISTRY, type HarnessId } from '@/lib/harness/registry';
import { clearHarnessRuntimeCache } from '@/lib/harness/runtime';
import { clearHarnessModelCache } from '@/lib/harness/model-discovery';

export const FAKE_MODEL_ID = 'fake-model';

export interface FakeTurn {
  session: FakeSession;
  message: string;
  /** Aborted when the host interrupts the turn or the session crashes. */
  signal: AbortSignal;
  say(text: string): Promise<void>;
  /** Raise a prompt through the host's `onUserInputRequest` and wait for its answer. */
  ask(req: Partial<UserInputRequest> & { toolName: string }): Promise<UserInputResponse>;
  /** Emit any stream event. Base fields are filled in. */
  emit(event: { type: StreamEvent['type'] } & Record<string, unknown>): Promise<void>;
}

export type FakeTurnScript = (turn: FakeTurn) => Promise<Partial<TurnResult> | void> | Partial<TurnResult> | void;

const defaultScript: FakeTurnScript = async (turn) => {
  await turn.say(`ok: ${turn.message}`);
};

export class FakeSession implements AgentSession {
  sessionId: string;
  state: SessionState = 'idle';
  readonly ctx: SessionContext;
  readonly messages: string[] = [];
  readonly resumed: boolean;
  private turnChain: Promise<unknown> = Promise.resolve();
  /** The turn running now, for a message folded into it. */
  private running: Promise<TurnResult> | null = null;
  private currentAbort: AbortController | null = null;
  private initialized = false;
  private turnCount = 0;

  constructor(
    private readonly harness: FakeHarness,
    ctx: SessionContext,
  ) {
    this.ctx = ctx;
    const resumeId = ctx.sessionParams?.sessionId;
    this.resumed = typeof resumeId === 'string';
    this.sessionId = this.resumed ? (resumeId as string) : `fake-${uuidv7()}`;
  }

  private base() {
    return {
      timestamp: new Date().toISOString(),
      providerType: this.harness.providerType,
      sessionId: this.sessionId,
      messageId: null,
      eventId: uuidv7(),
      parentToolCallId: null,
      raw: {},
    };
  }

  async emit(event: { type: StreamEvent['type'] } & Record<string, unknown>): Promise<void> {
    await this.ctx.onEvent?.({ ...this.base(), ...event } as unknown as StreamEvent);
  }

  async send(message: string): Promise<SendHandle> {
    if (this.state === 'closed') throw new Error('Session is closed');
    this.messages.push(message);
    const uuid = uuidv7();
    if (this.harness.coalesce && this.running) return { uuid, result: this.running };
    const result = (this.turnChain = this.turnChain.then(() => this.runTurn(message, uuid))) as Promise<TurnResult>;
    this.running = result;
    void result.finally(() => {
      if (this.running === result) this.running = null;
    }).catch(() => {});
    return { uuid, result };
  }

  private async runTurn(message: string, commandUuid: string): Promise<TurnResult> {
    if (this.state === 'closed') return this.finish('failed', 'session_closed', 'Session is closed');
    const abort = new AbortController();
    this.currentAbort = abort;
    const turnId = `turn-${++this.turnCount}`;
    if (!this.initialized) {
      this.initialized = true;
      await this.emit({
        type: 'system',
        subtype: 'init',
        model: FAKE_MODEL_ID,
        cwd: this.ctx.cwd ?? null,
        tools: [],
        permissionMode: null,
      });
    }
    this.state = 'thinking';
    // As agentex does: the turn names the message that opened it.
    await this.emit({ type: 'turn_start', turnId, trigger: 'send', raw: { command_uuid: commandUuid } });
    const turn: FakeTurn = {
      session: this,
      message,
      signal: abort.signal,
      say: (text) => this.emit({ type: 'assistant', text }),
      ask: async (req) => {
        if (!this.ctx.onUserInputRequest) throw new Error('Host did not register onUserInputRequest');
        this.state = 'waiting_for_approval';
        const response = await this.ctx.onUserInputRequest({
          input: {},
          toolUseId: `toolu_${uuidv7()}`,
          ...req,
        });
        this.state = 'thinking';
        return response;
      },
      emit: (event) => this.emit(event),
    };
    let outcome: Partial<TurnResult> | void;
    try {
      outcome = await Promise.race([
        Promise.resolve(this.harness.script(turn)),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
        }),
      ]);
    } catch (err) {
      const aborted = abort.signal.aborted;
      const status = aborted && !this.isClosed() ? 'aborted' : 'failed';
      const text = err instanceof Error ? err.message : String(err);
      await this.emit({
        type: 'result',
        text,
        costUsd: null,
        isError: status === 'failed',
        stopReason: null,
        terminalReason: status,
        numTurns: 1,
        durationMs: 0,
      }).catch(() => {});
      await this.emit({ type: 'turn_end', turnId, trigger: 'send', reason: aborted ? 'cancelled' : 'result' }).catch(
        () => {},
      );
      if (!this.isClosed()) this.state = 'idle';
      return this.finish(status, status, text);
    } finally {
      this.currentAbort = null;
    }
    const summary = outcome?.summary ?? 'done';
    await this.emit({
      type: 'result',
      text: summary,
      costUsd: outcome?.costUsd ?? 0,
      isError: false,
      stopReason: 'end_turn',
      terminalReason: null,
      numTurns: 1,
      durationMs: 0,
    });
    await this.emit({ type: 'turn_end', turnId, trigger: 'send', reason: 'result' });
    this.state = 'idle';
    return { summary, costUsd: 0, status: 'completed', errorCode: null, errorMessage: null, ...outcome };
  }

  /** A method, so a check after `state = 'thinking'` isn't narrowed away. */
  isClosed(): boolean {
    return this.state === 'closed';
  }

  private finish(status: TurnResult['status'], errorCode: string, errorMessage: string): TurnResult {
    return { summary: null, costUsd: null, status, errorCode, errorMessage };
  }

  /** The harness process died: the turn in flight fails and the session is gone. */
  crash(): void {
    this.state = 'closed';
    this.currentAbort?.abort(new Error('harness process exited'));
  }

  async interrupt(): Promise<void> {
    this.currentAbort?.abort(new Error('interrupted'));
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.currentAbort?.abort(new Error('session closed'));
  }

  async drain(): Promise<void> {
    await this.turnChain;
  }

  async cancel(): Promise<{ cancelled: boolean }> {
    return { cancelled: false };
  }

  async stopTask(): Promise<{ stopped: boolean }> {
    return { stopped: false };
  }

  async setGoal(): Promise<never> {
    throw new Error('FakeSession does not support goals');
  }

  async clearGoal(): Promise<never> {
    throw new Error('FakeSession does not support goals');
  }

  getGoal(): null {
    return null;
  }

  describe() {
    return null;
  }
}

export class FakeHarness {
  readonly sessions: FakeSession[] = [];
  script: FakeTurnScript = defaultScript;
  /**
   * Fold a message sent while a turn runs into that turn, as Claude does
   * with a message it drains mid-turn: no turn of its own, and it resolves
   * with the running turn's result. Off by default: each message is its own
   * turn, in order.
   */
  coalesce = false;
  readonly providerType: string;
  private readonly original: ProviderModule;

  constructor(readonly harness: HarnessId) {
    this.providerType = HARNESS_REGISTRY[harness].agentexProviderId;
    this.original = getProvider(this.providerType);
    const report: ProviderRuntimeReport = {
      binary: { status: 'supported', command: 'fake', version: '0.0.0-fake', protocolProfile: null },
      capabilities: {},
    };
    const fake: ProviderModule = {
      ...this.original,
      probeCapabilities: async () => report,
      listModels: async () => [{ id: FAKE_MODEL_ID, name: 'Fake model' }],
      createSession: async (ctx: SessionContext) => {
        const session = new FakeSession(this, ctx);
        this.sessions.push(session);
        return session;
      },
    };
    registerProvider(fake);
    clearHarnessRuntimeCache(harness);
    clearHarnessModelCache(harness);
  }

  /** Use `script` for every turn from now on. */
  onTurn(script: FakeTurnScript): void {
    this.script = script;
  }

  latest(): FakeSession {
    const s = this.sessions.at(-1);
    if (!s) throw new Error('No fake session has been created');
    return s;
  }

  restore(): void {
    registerProvider(this.original);
    clearHarnessRuntimeCache(this.harness);
    clearHarnessModelCache(this.harness);
  }
}

export function installFakeHarness(harness: HarnessId = 'claude'): FakeHarness {
  return new FakeHarness(harness);
}
