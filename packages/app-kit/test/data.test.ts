import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod/v4';
import { accountSource, allows, allowsAll, boundText, createBlobStore, createJobQueue, createScopeStore, createSettings, decodeCursor, encodeCursor, migrate, pageOf, redact, scopeFingerprint, transaction } from '@ri/app-kit/data';
import type { InvocationAccess } from '@ri/app-kit/contract';

const temporary: string[] = [];
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-app-data-')); temporary.push(dir); return dir; }
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const open = () => new DatabaseSync(path.join(tempDir(), 'records.db'));
const access = (actorId: string, scopeRef: string | null, accounts: string[] = []): InvocationAccess => ({ protocol: 'ri-access-v1', actorId, scopeRef, accounts: accounts.map(account => ({ account, binding: 'mail', actions: [], automatic: false })) });

describe('forward migrations', () => {
  it('applies in order, refuses edited history and data from a newer version', () => {
    const db = open();
    const v1 = [{ version: 1, name: 'trips', sql: 'CREATE TABLE trips (id TEXT PRIMARY KEY)' }];
    expect(migrate(db, v1)).toEqual({ applied: [1], version: 1 });
    expect(migrate(db, v1)).toEqual({ applied: [], version: 1 });
    const v2 = [...v1, { version: 2, name: 'bookings', sql: 'CREATE TABLE bookings (id TEXT PRIMARY KEY)' }];
    expect(migrate(db, v2).applied).toEqual([2]);
    expect(() => migrate(db, v1)).toThrow(/newer version/);
    expect(() => migrate(db, [{ ...v1[0], sql: 'CREATE TABLE trips (id TEXT)' }, v2[1]])).toThrow(/changed after/);
    expect(() => migrate(db, [{ version: 2, name: 'x', sql: '' }])).toThrow(/numbered/);
  });
  it('rolls back a failed migration without recording it', () => {
    const db = open();
    expect(() => migrate(db, [{ version: 1, name: 'broken', sql: 'CREATE TABLE ok (id TEXT); NOT SQL' }])).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_schema_migrations').get()).toEqual({ count: 0 });
  });
});

describe('cursors and pages', () => {
  it('round-trips an opaque cursor and rejects a tampered one with a reload message', () => {
    const schema = z.object({ at: z.string(), id: z.string() }).strict();
    const cursor = encodeCursor({ at: '2026-10-12', id: 'b' });
    expect(decodeCursor(schema, cursor)).toEqual({ at: '2026-10-12', id: 'b' });
    expect(decodeCursor(schema, undefined)).toBeNull();
    expect(() => decodeCursor(schema, 'garbage')).toThrow(/Reload the list/);
    const page = pageOf([1, 2, 3], 2, value => ({ value }));
    expect(page.items).toEqual([1, 2]);
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toEqual({ value: 2 });
    expect(pageOf([1], 2, value => value).nextCursor).toBeNull();
  });
});

describe('app data scopes', () => {
  it('gives the owner and previews everything, jobs only their accounts and chats only their saved scope', () => {
    const db = open();
    const scopes = createScopeStore(db, () => 'instance-a');
    const owner = scopes.resolve({ principal: { kind: 'owner-ui', id: 'owner' }, access: access('owner-ui:owner', null) }, 'write');
    expect(owner.kind).toBe('owner');
    expect(allows(owner, 'account:anything')).toBe(true);
    const job = scopes.resolve({ principal: { kind: 'job', id: 'sched' }, access: access('job:sched', null, ['acct-1']) }, 'write');
    expect(allows(job, accountSource('acct-1'))).toBe(true);
    expect(allows(job, accountSource('acct-2'))).toBe(false);
    expect(allows(job, 'manual')).toBe(false);

    const scope = scopes.create({ actorId: 'chat:c-1', label: 'Personal mail', sources: ['account:acct-1', 'manual', 'manual'], operations: ['read'] });
    expect(scope.sources).toEqual(['account:acct-1', 'manual']);
    const chat = scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-1', scope.id) }, 'read');
    expect(allows(chat, 'manual')).toBe(true);
    expect(allows(chat, 'account:acct-2')).toBe(false);
    expect(allowsAll(chat, ['manual', 'account:acct-2'])).toBe(false);
    expect(scopeFingerprint(chat)).not.toBe(scopeFingerprint(owner));
    expect(scopeFingerprint(chat)).toBe(scopeFingerprint(scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-1', scope.id) }, 'read')));

    // A chat with no selected scope, another caller's scope, a forged actor and a write on a read scope are all denied.
    expect(() => scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-1', null) }, 'read')).toThrow(/not chosen/);
    expect(() => scopes.resolve({ principal: { kind: 'chat', id: 'c-2' }, access: access('chat:c-2', scope.id) }, 'read')).toThrow(/different caller/);
    expect(() => scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-9', scope.id) }, 'read')).toThrow(/could not be verified/);
    expect(() => scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: null }, 'read')).toThrow(/could not be verified/);
    expect(() => scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-1', scope.id) }, 'write')).toThrow(/may read but not change/);
    // A scope created in another instance's database is invisible here.
    expect(() => createScopeStore(db, () => 'instance-b').resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-1', scope.id) }, 'read')).toThrow(/different caller/);
    scopes.revoke(scope.id);
    expect(() => scopes.resolve({ principal: { kind: 'chat', id: 'c-1' }, access: access('chat:c-1', scope.id) }, 'read')).toThrow(/removed/);
    expect(() => scopes.create({ actorId: 'owner-ui:owner', label: 'x', sources: ['manual'], operations: ['read'] })).toThrow();
    expect(() => scopes.create({ actorId: 'chat:c-1', label: 'x', sources: [], operations: ['read'] })).toThrow(/at least one/);
    const second = scopes.create({ actorId: 'chat:c-3', label: 'x', sources: ['account:acct-1', 'manual'], operations: ['read', 'write'] });
    scopes.forgetSource('account:acct-1');
    expect(scopes.get(second.id)!.sources).toEqual(['manual']);
  });
});

describe('bounded job queue', () => {
  it('rotates sources, alternates kinds, backs off failures and recovers interrupted steps', () => {
    const db = open();
    const jobs = createJobQueue(db);
    const now = '2026-10-15T12:00:00.000Z';
    const a = jobs.ensure('sync', 'account:a', { idempotent: true, eligibleAt: now });
    const b = jobs.ensure('sync', 'account:b', { idempotent: true, eligibleAt: now });
    const e = jobs.ensure('enrich', 'account:a', { idempotent: true, eligibleAt: now });
    expect(jobs.ensure('sync', 'account:a', { idempotent: true }).id).toBe(a.id);

    const first = jobs.next(now)!; jobs.claim(first.id); jobs.finish(first.id, { more: true, now: new Date(now) });
    const second = jobs.next(now)!;
    expect(second.kind).not.toBe(first.kind);
    jobs.claim(second.id); jobs.finish(second.id, { more: true, now: new Date(now) });
    const third = jobs.next(now)!;
    expect([first.id, second.id]).not.toContain(third.id);
    expect(new Set([first.id, second.id, third.id])).toEqual(new Set([a.id, b.id, e.id]));
    expect(() => jobs.claim(third.id) && jobs.claim(third.id)).toThrow(/no longer pending/);

    jobs.fail(third.id, new Error('Gmail said no for maya@example.test token abcdefghijklmnopqrstuvwxyz0123456789'), { retryable: true, now: new Date(now) });
    const failed = jobs.get(third.id)!;
    expect(failed.state).toBe('pending');
    expect(failed.lastError).toBe('Gmail said no for [address] token [token]');
    expect(failed.nextEligibleAt > now).toBe(true);
    expect(jobs.next(now, { sources: new Set(['account:zzz']) })).toBeNull();

    jobs.pause('account:a');
    expect(jobs.list().filter(job => job.sourceKey === 'account:a').every(job => job.state === 'paused')).toBe(true);
    jobs.resume('account:a');
    expect(jobs.find('sync', 'account:a')!.state).toBe('pending');

    const once = jobs.ensure('import', 'manual', { idempotent: false });
    jobs.claim(jobs.find('sync', 'account:b')!.id); jobs.claim(once.id);
    jobs.recover();
    expect(jobs.find('sync', 'account:b')!.state).toBe('pending');
    expect(jobs.get(once.id)!.state).toBe('failed');
    expect(jobs.counts()).toMatchObject({ failed: 1, running: 0 });
    jobs.remove('account:b');
    expect(jobs.find('sync', 'account:b')).toBeNull();
  });
});

describe('evidence, settings and text', () => {
  it('stores content once by digest and keeps settings typed', () => {
    const blobs = createBlobStore(path.join(tempDir(), 'blobs'));
    const one = blobs.put('Booking RH-4821'), two = blobs.put(Buffer.from('Booking RH-4821'));
    expect(one).toEqual(two);
    expect(blobs.readText(one.digest)).toBe('Booking RH-4821');
    blobs.remove(one.digest);
    expect(blobs.read(one.digest)).toBeNull();
    expect(() => blobs.read('../../etc/passwd')).toThrow();
    const db = open(), settings = createSettings(db);
    settings.set('history', { days: 90 });
    expect(settings.get('history', z.object({ days: z.number() }), { days: 30 })).toEqual({ days: 90 });
    expect(settings.get('missing', z.number(), 7)).toBe(7);
    expect(boundText('one two three four', 9)).toEqual({ text: 'one two…', truncated: true });
    expect(redact('see https://mail.example/x?token=1')).toBe('see [link]');
  });
  it('joins an outer transaction and rolls back on failure', () => {
    const db = open();
    db.exec('CREATE TABLE t (v INTEGER)');
    expect(() => transaction(db, () => { db.prepare('INSERT INTO t VALUES (1)').run(); transaction(db, () => db.prepare('INSERT INTO t VALUES (2)').run()); throw new Error('stop'); })).toThrow('stop');
    expect(db.prepare('SELECT COUNT(*) AS count FROM t').get()).toEqual({ count: 0 });
  });
});
