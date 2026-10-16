import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, type InvocationAccess } from '@ri/app-kit/contract';
import { openAppDatabase, type AppInvocation } from '@ri/app-kit/sdk';
import { createScopeStore, scopeFingerprint } from '@ri/app-kit/data';
import { gmailSyncStep, type MailCheckpoint } from '@ri/app-kit/sources';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tempFile = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-review-')); temporary.push(dir); return path.join(dir, 'records.db'); };
const access = (actorId: string, scopeRef: string | null): InvocationAccess => ({ protocol: 'ri-access-v1', actorId, scopeRef, accounts: [] });
const invocation = (id: string, kind: 'chat' | 'owner-ui', scopeRef: string | null): AppInvocation => ({
  id, principal: { kind, id: kind === 'chat' ? 'c-1' : 'owner' }, audience: kind === 'chat' ? 'agent' : 'user', grantRevision: 1, deadline: Date.now() + 30000,
  packageDigest: 'a'.repeat(64), signal: new AbortController().signal, access: access(kind === 'chat' ? 'chat:c-1' : 'owner-ui:owner', scopeRef), capability: async () => ({}),
});

describe('review fixes', () => {
  it('refuses to replay a cached write result after the caller\'s scope narrowed, without repeating the write', async () => {
    const store = await openAppDatabase(tempFile());
    const scopes = createScopeStore(store.db, () => 'instance-a');
    store.useAuthority((call) => scopeFingerprint(scopes.resolve(call, 'read')));
    store.db.exec('CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT)');
    const broad = scopes.create({ actorId: 'chat:c-1', label: 'Everything', sources: ['manual', 'private'], operations: ['read', 'write'] });
    const id = randomUUID();
    let writes = 0;
    const save = (call: AppInvocation) => store.mutate(call, 'save_person', { name: 'Fictional' }, () => { writes++; store.db.prepare('INSERT INTO people VALUES (?, ?)').run(randomUUID(), 'Fictional'); return { name: 'Fictional', privateEmail: 'hidden@example.test' }; });
    expect(save(invocation(id, 'chat', broad.id))).toEqual({ name: 'Fictional', privateEmail: 'hidden@example.test' });
    expect(save(invocation(id, 'chat', broad.id)).privateEmail).toBe('hidden@example.test');
    // The broad scope is replaced by a narrower one. A replay is refused, and nothing is written twice.
    scopes.revoke(broad.id);
    const narrow = scopes.create({ actorId: 'chat:c-1', label: 'Manual only', sources: ['manual'], operations: ['read', 'write'] });
    expect(() => save(invocation(id, 'chat', narrow.id))).toThrow(/access changed/);
    expect(() => save(invocation(id, 'chat', broad.id))).toThrow(/removed/);
    expect(writes).toBe(1);
    // The owner keeps ordinary replay.
    const ownerId = randomUUID();
    const ownerCall = invocation(ownerId, 'owner-ui', null);
    store.mutate(ownerCall, 'save_person', { name: 'Owner' }, () => ({ ok: true }));
    expect(store.mutate(ownerCall, 'save_person', { name: 'Owner' }, () => { throw new Error('repeated'); })).toEqual({ ok: true });
    store.close();
  });

  it('removes a deleted source from every scope, beyond the listing limit, in one transaction', async () => {
    const store = await openAppDatabase(tempFile());
    const scopes = createScopeStore(store.db, () => 'instance-a');
    for (let index = 0; index < 205; index++) scopes.create({ actorId: `chat:c-${index}`, label: 'Shared', sources: ['account:gone', 'manual'], operations: ['read'] });
    scopes.forgetSource('account:gone');
    const remaining = store.db.prepare("SELECT COUNT(*) AS count FROM app_data_scopes WHERE instr(sources, '\"account:gone\"') > 0").get() as { count: number };
    expect(remaining.count).toBe(0);
    expect(scopes.list().every((scope) => scope.sources.length === 1 && scope.sources[0] === 'manual')).toBe(true);
    store.close();
  });

  it('completes a history page whose added message was deleted later on the same page', async () => {
    const seen = new Set<string>(), removed: string[] = [], ingested: string[] = [];
    const capability = async (name: string, input: unknown) => {
      const value = input as Record<string, unknown>;
      if (name === 'gmail.list_history') return { historyId: '130', history: [{ messagesAdded: [{ message: { id: 'gone' } }, { message: { id: 'kept' } }] }, { messagesDeleted: [{ message: { id: 'gone' } }] }] };
      if (name === 'gmail.get_message') { if (value.messageId === 'gone') throw new AppError('not_found', 'This message is no longer in the mailbox'); return { id: value.messageId, headers: { Subject: 'Hello', From: 'maya@northstar.example' } }; }
      if (name === 'gmail.read_message') return { id: value.messageId, threadId: 't', internalDate: String(Date.parse('2026-10-14T00:00:00Z')), labelIds: [], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'maya@northstar.example' }], body: { data: Buffer.from('Hello').toString('base64url') } } };
      throw new Error(name);
    };
    const checkpoint: MailCheckpoint = { version: 1, emailAddress: null, windowDays: 30, windowStart: '2026-09-15T00:00:00.000Z', backfill: { pageToken: null, pages: 1, complete: true, completedAt: '2026-10-01T00:00:00.000Z', oldestAt: null }, history: { historyId: '120', pageToken: null, checkedAt: null }, lane: 'history', rescans: 0, lastSuccessAt: null };
    const result = await gmailSyncStep({
      invocation: { capability, signal: new AbortController().signal }, account: 'a', binding: 'mail', checkpoint, windowDays: 30, query: 'x', deadline: Date.now() + 10000,
      seen: (id) => seen.has(id), relevant: () => true, ingest: (message) => { seen.add(message.id); ingested.push(message.id); }, skip: (id) => seen.add(id), removed: (id) => removed.push(id),
    });
    expect(ingested).toEqual(['kept']);
    expect(removed).toContain('gone');
    expect(result.checkpoint.history.historyId).toBe('130');
    expect(result.yielded).toBe(false);
  });
});
