/**
 * Test harness: a fresh app in a temporary directory and fake invocations
 * for each kind of caller. Inputs are parsed by the action schema and every
 * output is validated against the generated contract, as the runtime does.
 * All data is fictional.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach } from 'vitest';
import { AppError, ContractValidator, type InvocationAccess } from '@ri/app-kit/contract';
import { generateContract, type AppInvocation } from '@ri/app-kit/sdk';
import { definition, initialize, shutdown } from '../src/actions.js';
import { setClock } from '../src/server/state.js';

const temporary: string[] = [];
export function tempDir(prefix = 'ri-job-search-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  shutdown();
  setClock(null);
  for (const dir of temporary.splice(0)) {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(os.tmpdir())) && !resolved.startsWith(fs.realpathSync(os.tmpdir()))) throw new Error(`Refusing to remove ${dir}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

export const contract = generateContract(definition);
const validator = new ContractValidator();

export async function setup(options: { now?: string } = {}) {
  const dir = tempDir();
  const instanceId = randomUUID();
  if (options.now) {
    const fixed = new Date(options.now);
    setClock(() => new Date(fixed));
  }
  await initialize({ dataDir: path.join(dir, 'data'), instanceId });
  return { dir, instanceId, dataDir: path.join(dir, 'data') };
}

export type Capability = (name: string, input: unknown, target?: { binding?: string; account?: string }) => Promise<unknown> | unknown;
export interface CallerOptions {
  scopeRef?: string | null;
  accounts?: InvocationAccess['accounts'];
  capability?: Capability;
  id?: string;
}
type Kind = 'owner' | 'chat' | 'job' | 'fixture';

export function caller(kind: Kind, name = kind === 'owner' ? 'owner' : kind === 'chat' ? 'c-1' : kind === 'job' ? 'schedule-1' : 'preview', options: CallerOptions = {}): AppInvocation {
  const principal = kind === 'owner' ? { kind: 'owner-ui' as const, id: name } : kind === 'chat' ? { kind: 'chat' as const, id: name } : kind === 'job' ? { kind: 'job' as const, id: name } : { kind: 'fixture' as const, id: name, fixtureAudience: 'user' as const };
  const audience = kind === 'owner' || kind === 'fixture' ? 'user' : kind === 'job' ? 'schedule' : 'agent';
  const capability = options.capability ?? (async (capabilityName: string) => { throw new AppError('unsupported', `No fake for ${capabilityName}`); });
  return {
    id: options.id ?? randomUUID(),
    principal,
    audience,
    grantRevision: 1,
    deadline: Date.now() + 40_000,
    packageDigest: 'a'.repeat(64),
    signal: new AbortController().signal,
    access: { protocol: 'ri-access-v1', actorId: `${principal.kind}:${principal.id}`, scopeRef: options.scopeRef ?? null, accounts: options.accounts ?? [] },
    capability: async (capabilityName, input, target) => capability(capabilityName, input, typeof target === 'string' ? { binding: target } : target),
  };
}

/** Call an action as the runtime would: audience check, input parse, handler, output contract check. */
export async function call<T = any>(name: string, input: unknown, invocation: AppInvocation): Promise<T> {
  const action = definition.actions.find((item) => item.name === name);
  if (!action) throw new Error(`Unknown action ${name}`);
  if (!action.audience.includes(invocation.audience)) throw new AppError('forbidden', 'This action is unavailable to this caller');
  const descriptor = contract.actions.find((item) => item.name === name)!;
  validator.check(descriptor.inputSchema, input, `Invalid input for ${name}`);
  const result = await action.handler(action.input.parse(input), invocation);
  const parsed = action.output.safeParse(JSON.parse(JSON.stringify(result)));
  if (!parsed.success) throw new Error(`Output of ${name} is outside its schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  validator.check(descriptor.outputSchema, JSON.parse(JSON.stringify(result)), `Output of ${name} is outside its contract`);
  return result as T;
}

export const owner = (options: CallerOptions = {}) => caller('owner', 'owner', options);
export const fixture = (options: CallerOptions = {}) => caller('fixture', 'preview', options);
export const chat = (name: string, scopeRef: string | null, options: CallerOptions = {}) => caller('chat', name, { ...options, scopeRef });
export const job = (accounts: InvocationAccess['accounts'], options: CallerOptions = {}) => caller('job', 'schedule-1', { ...options, accounts });
export const mailAccount = (account: string, automatic = true) => ({ account, binding: 'mail', actions: ['gmail.get_profile', 'gmail.search_messages', 'gmail.get_message', 'gmail.read_message', 'gmail.list_history'], automatic });
export const calendarAccount = (account: string, automatic = true) => ({ account, binding: 'calendar', actions: ['google_calendar.list_calendars', 'google_calendar.sync_events'], automatic });
