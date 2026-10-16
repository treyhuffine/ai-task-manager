import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, ContractValidator, type InvocationAccess } from '@ri/app-kit/contract';
import { generateContract, type AppInvocation } from '@ri/app-kit/sdk';
import { definition } from '../src/actions.js';
import { openContext, useContext } from '../src/runtime.js';
import type { Ctx } from '../src/domain/context.js';

const created: string[] = [];
/** A directory created with mkdtemp. Only these are ever removed. */
export function tempDir(prefix = 'ri-people-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}
export function cleanup() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export const state = { dataDir: '' };
export const INSTANCE = '0194d7a0-0000-4000-8000-0000000000ff';
export const clock = { now: new Date('2026-10-15T15:00:00.000Z') };
export function advance(ms: number) { clock.now = new Date(clock.now.getTime() + ms); }

export async function setup(options: { now?: string; realTime?: boolean } = {}): Promise<Ctx> {
  clock.now = new Date(options.now ?? '2026-10-15T15:00:00.000Z');
  const dir = tempDir();
  state.dataDir = dir;
  const ctx = await openContext({ dataDir: dir, instanceId: INSTANCE }, { now: options.realTime ? () => new Date() : () => clock.now });
  useContext(ctx);
  return ctx;
}
export function teardown(ctx: Ctx | null) {
  ctx?.close();
  useContext(null);
  cleanup();
}

export type Capability = (name: string, input: unknown, target?: unknown) => Promise<unknown>;
export interface Caller { principal: AppInvocation['principal']; audience: AppInvocation['audience']; access: InvocationAccess | null; capability?: Capability }
const noCapability: Capability = async (name) => { throw new AppError('forbidden', `No capability ${name} in this test`); };

export const owner = (accounts: string[] = [], capability?: Capability, automatic = false): Caller => ({
  principal: { kind: 'owner-ui', id: 'owner' }, audience: 'user', capability,
  access: { protocol: 'ri-access-v1', actorId: 'owner-ui:owner', scopeRef: null, accounts: accounts.flatMap((account) => [{ account, binding: 'mail', actions: [], automatic }, { account, binding: 'calendar', actions: [], automatic }]) },
});
export const fixture = (audience: 'user' | 'agent' = 'user'): Caller => ({
  principal: { kind: 'fixture', id: INSTANCE, fixtureAudience: audience }, audience,
  access: { protocol: 'ri-access-v1', actorId: `fixture:${INSTANCE}`, scopeRef: null, accounts: [{ account: 'fixture-account', binding: 'mail', actions: [], automatic: false }] },
});
export const chat = (id: string, scopeRef: string | null, capability?: Capability): Caller => ({
  principal: { kind: 'chat', id }, audience: 'agent', capability,
  access: { protocol: 'ri-access-v1', actorId: `chat:${id}`, scopeRef, accounts: [] },
});
export const job = (accounts: { account: string; binding?: 'mail' | 'calendar' }[], capability?: Capability): Caller => ({
  principal: { kind: 'job', id: 'schedule-1' }, audience: 'schedule', capability,
  access: { protocol: 'ri-access-v1', actorId: 'job:schedule-1', scopeRef: null, accounts: accounts.map((item) => ({ account: item.account, binding: item.binding ?? 'mail', actions: [], automatic: true })) },
});

const contract = generateContract(definition);
const validator = new ContractValidator();
export const calls: { name: string; input: unknown; principal: string }[] = [];

/**
 * Invoke a handler the way the runtime does: check the audience, validate the
 * input against the generated contract, parse it with the action's schema,
 * run it, and validate the output against the contract.
 */
export async function call<T = any>(name: string, input: unknown, caller: Caller, invocationId: string = randomUUID()): Promise<T> {
  const action = definition.actions.find((item) => item.name === name);
  const descriptor = contract.actions.find((item) => item.name === name);
  if (!action || !descriptor) throw new Error(`Unknown action ${name}`);
  if (!descriptor.audience.includes(caller.audience)) throw new AppError('forbidden', 'This action is unavailable to this caller');
  validator.check(descriptor.inputSchema, input, `Invalid input for ${name}`);
  const parsed = action.input.parse(input);
  const controller = new AbortController();
  const invocation: AppInvocation = {
    id: invocationId, principal: caller.principal, audience: caller.audience, grantRevision: 1, deadline: Date.now() + descriptor.timeoutMs,
    packageDigest: 'a'.repeat(64), access: caller.access, signal: controller.signal,
    capability: (capabilityName, capabilityInput, target) => (caller.capability ?? noCapability)(capabilityName, capabilityInput, target),
  };
  calls.push({ name, input, principal: `${caller.principal.kind}:${caller.principal.id}` });
  const result = await action.handler(parsed, invocation);
  try {
    validator.check(descriptor.outputSchema, JSON.parse(JSON.stringify(result)), `Invalid output for ${name}`);
  } catch (error) {
    const detail = action.output.safeParse(result);
    throw new Error(`Invalid output for ${name}: ${detail.success ? 'schema mismatch' : JSON.stringify(detail.error.issues).slice(0, 1500)}`);
  }
  return result as T;
}

export async function expectCode(promise: Promise<unknown>, code: string) {
  try { await promise; } catch (error) {
    if ((error as AppError).code !== code) throw new Error(`Expected ${code}, got ${(error as AppError).code}: ${(error as Error).message}`);
    return error as AppError;
  }
  throw new Error(`Expected ${code}, but the call succeeded`);
}

export { contract, definition };
