import path from 'node:path';
import { AppError } from '@ri/app-kit/contract';
import { actorOf, migrate, type AccessScope } from '@ri/app-kit/data';
import { openAppDatabase, type AppInvocation, type Bootstrap } from '@ri/app-kit/sdk';
import { FIXTURE_ACCOUNTS } from './fixtures/seed.js';
import { createContext, type Ctx } from './domain/context.js';
import { MIGRATIONS } from './domain/schema.js';
import { resolveScope } from './domain/scope.js';
import { ensureDefaultCollection } from './domain/sources.js';

/**
 * The app's single database context. Opened in `initialize`, never at import,
 * so the build can import the action definitions to generate the contract.
 */
let current: Ctx | null = null;

export async function openContext(boot: Pick<Bootstrap, 'dataDir' | 'instanceId'>, options: { now?: () => Date } = {}): Promise<Ctx> {
  const store = await openAppDatabase(path.join(boot.dataDir, 'records.db'));
  store.db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(store.db as never, MIGRATIONS);
  const ctx = createContext({
    raw: store.db,
    mutate: (invocation, action, input, operation) => store.mutate(invocation, action, input, operation),
    close: () => store.close(),
    blobsDir: path.join(boot.dataDir, 'blobs'),
    instanceId: boot.instanceId,
    now: options.now,
  });
  ctx.db.tx(() => ensureDefaultCollection(ctx));
  return ctx;
}

export async function initialize(boot: Bootstrap) {
  if (current) return;
  current = await openContext(boot);
  // Interrupted steps resume from their committed checkpoint on the next run.
  current.jobs.recover();
}
export function shutdown() {
  current?.close();
  current = null;
}
export function ctx(): Ctx {
  if (!current) throw new AppError('app_failed', 'People is still starting. Try again');
  return current;
}
/** Tests may run the handlers against their own context. */
export function useContext(next: Ctx | null) {
  current = next;
}

export const readScope = (invocation: AppInvocation) => resolveScope(ctx(), invocation, 'read');
export const writeScope = (invocation: AppInvocation) => resolveScope(ctx(), invocation, 'write');
export const actor = (invocation: AppInvocation) => actorOf(invocation);
/** Accounts currently granted to the owner's view, so missing ones read as disconnected. */
export function granted(invocation: AppInvocation): ReadonlySet<string> | null {
  return invocation.principal.kind === 'owner-ui' && invocation.access ? new Set(invocation.access.accounts.map((item) => item.account)) : null;
}
const FIXTURE_MAIL_ACTIONS = ['gmail.get_profile', 'gmail.search_messages', 'gmail.get_message', 'gmail.read_message', 'gmail.list_history'];
const FIXTURE_CALENDAR_ACTIONS = ['google_calendar.list_calendars', 'google_calendar.sync_events'];
/**
 * The account grants an invocation carries. The fictional preview has no
 * real grants, so its own invented accounts read as granted there: the
 * preview shows a connected app without touching any real account.
 */
export function accessOf(invocation: AppInvocation): AppInvocation['access'] {
  if (invocation.principal.kind !== 'fixture') return invocation.access;
  return {
    protocol: 'ri-access-v1', actorId: invocation.access?.actorId ?? 'fixture', scopeRef: null,
    accounts: [
      { account: FIXTURE_ACCOUNTS.personal, binding: 'mail', actions: FIXTURE_MAIL_ACTIONS, automatic: true },
      { account: FIXTURE_ACCOUNTS.personal, binding: 'calendar', actions: FIXTURE_CALENDAR_ACTIONS, automatic: true },
      { account: FIXTURE_ACCOUNTS.work, binding: 'mail', actions: FIXTURE_MAIL_ACTIONS, automatic: true },
    ],
  } as AppInvocation['access'];
}
export function requireOwner(scope: AccessScope) {
  if (scope.kind !== 'owner') throw new AppError('forbidden', 'Only the owner can do this in the People view');
}
