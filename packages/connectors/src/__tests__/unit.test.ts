import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { inputDigest, actionVersion } from '../core/digest';
import { createRedactor } from '../core/redactor';
import { createRegistry } from '../core/registry';
import { defineProvider, defineToolkit, httpAction, action } from '../core/authoring';
import { bearer } from '../auth/direct';
import { aesGcmSecretBox, plaintextSecretBox, generateSecretKey } from '../crypto/aes-gcm';

describe('inputDigest (grant key, §8)', () => {
  it('is stable under key reordering', () => {
    expect(inputDigest({ a: 1, b: 2, c: 3 })).toBe(inputDigest({ c: 3, b: 2, a: 1 }));
  });
  it('is stable under nested reordering and date re-serialization', () => {
    const d1 = { when: new Date('2026-06-18T00:00:00.000Z'), nested: { y: 2, x: 1 } };
    const d2 = { nested: { x: 1, y: 2 }, when: new Date('2026-06-18T00:00:00.000Z') };
    expect(inputDigest(d1)).toBe(inputDigest(d2));
  });
  it('changes when a value changes', () => {
    expect(inputDigest({ a: 1 })).not.toBe(inputDigest({ a: 2 }));
  });
  it('ignores undefined fields for stability', () => {
    expect(inputDigest({ a: 1, b: undefined })).toBe(inputDigest({ a: 1 }));
  });
});

describe('actionVersion (auto-invalidation, §8)', () => {
  const schema = z.object({ x: z.string() });
  it('changes when risk changes', () => {
    expect(actionVersion({ inputSchema: schema, risk: 'low', mutating: false })).not.toBe(
      actionVersion({ inputSchema: schema, risk: 'high', mutating: false }),
    );
  });
  it('changes when mutating changes', () => {
    expect(actionVersion({ inputSchema: schema, risk: 'low', mutating: false })).not.toBe(
      actionVersion({ inputSchema: schema, risk: 'low', mutating: true }),
    );
  });
  it('changes when the input schema shape changes', () => {
    const wider = z.object({ x: z.string(), y: z.number() });
    expect(actionVersion({ inputSchema: schema, risk: 'low', mutating: false })).not.toBe(
      actionVersion({ inputSchema: wider, risk: 'low', mutating: false }),
    );
  });
  it('is stable for the same shape', () => {
    expect(actionVersion({ inputSchema: z.object({ x: z.string() }), risk: 'low', mutating: false })).toBe(
      actionVersion({ inputSchema: z.object({ x: z.string() }), risk: 'low', mutating: false }),
    );
  });
});

describe('Redactor (confinement primitive, §8)', () => {
  it('scrubs a registered secret deep in a structure', () => {
    const r = createRedactor();
    r.register('super-secret-token', 'token');
    const out = r.redact({ a: { b: ['x', 'header super-secret-token y'] }, msg: 'super-secret-token' });
    expect(JSON.stringify(out)).not.toContain('super-secret-token');
    expect(JSON.stringify(out)).toContain('[redacted:token]');
  });
  it('does not register trivially short values', () => {
    const r = createRedactor();
    r.register('ab', 'short');
    expect(r.redact('about')).toBe('about');
  });
  it('returns a copy without mutating the input', () => {
    const r = createRedactor();
    r.register('secret-value-123');
    const input = { a: 'secret-value-123' };
    const out = r.redact(input);
    expect(input.a).toBe('secret-value-123');
    expect((out as { a: string }).a).toBe('[redacted]');
  });
});

describe('Registry invariants (§3/§17)', () => {
  const provider = defineProvider({ id: 'p', displayName: 'P', auth: bearer() });
  const okAction = httpAction({ id: 'p.read', description: 'r', input: z.object({}), request: () => ({ method: 'GET', path: '/x' }) });

  it('rejects duplicate provider ids', () => {
    const reg = createRegistry();
    reg.addProvider(provider);
    expect(() => reg.addProvider(provider)).toThrow(/duplicate provider/);
  });
  it('rejects duplicate action ids', () => {
    const reg = createRegistry();
    reg.addProvider(provider);
    reg.addToolkit(defineToolkit({ id: 't1', providerId: 'p', displayName: 'T1', actions: [okAction] }));
    expect(() =>
      reg.addToolkit(defineToolkit({ id: 't2', providerId: 'p', displayName: 'T2', actions: [okAction] })),
    ).toThrow(/duplicate action/);
  });
  it('rejects a non-object action input at registration (§11)', () => {
    const reg = createRegistry();
    reg.addProvider(provider);
    const badAction = action({
      id: 'p.bad',
      description: 'b',
      input: z.string() as unknown as z.ZodObject<z.ZodRawShape>,
      async execute() {
        return null;
      },
    });
    expect(() => reg.addToolkit(defineToolkit({ id: 't', providerId: 'p', displayName: 'T', actions: [badAction] }))).toThrow(
      /must be a Zod object/,
    );
  });
  it('rejects a toolkit referencing an unknown provider', () => {
    const reg = createRegistry();
    expect(() => reg.addToolkit(defineToolkit({ id: 't', providerId: 'nope', displayName: 'T', actions: [] }))).toThrow(
      /unknown provider/,
    );
  });
  it('rejects an action whose input declares the reserved `account` field (§11)', () => {
    const reg = createRegistry();
    reg.addProvider(provider);
    const collides = httpAction({
      id: 'p.collide',
      description: 'c',
      input: z.object({ account: z.string() }),
      request: () => ({ method: 'GET', path: '/x' }),
    });
    expect(() =>
      reg.addToolkit(defineToolkit({ id: 't', providerId: 'p', displayName: 'T', actions: [collides] })),
    ).toThrow(/reserved field "account"/);
  });
});

describe('defineToolkit scope bundle (§3)', () => {
  const provider = defineProvider({ id: 'p', displayName: 'P', auth: bearer() });
  void provider;
  it('defaults the consent bundle to the union of its actions scopes', () => {
    const tk = defineToolkit({
      id: 't',
      providerId: 'p',
      displayName: 'T',
      actions: [
        httpAction({ id: 'p.a', description: 'a', scopes: ['s1'], input: z.object({}), request: () => ({ method: 'GET', path: '/a' }) }),
        httpAction({ id: 'p.b', description: 'b', scopes: ['s2', 's1'], input: z.object({}), request: () => ({ method: 'GET', path: '/b' }) }),
      ],
    });
    expect([...(tk.scopes ?? [])].sort()).toEqual(['s1', 's2']);
  });
  it('does not override an explicitly-provided bundle', () => {
    const tk = defineToolkit({
      id: 't2',
      providerId: 'p',
      displayName: 'T2',
      scopes: ['explicit'],
      actions: [httpAction({ id: 'p.c', description: 'c', scopes: ['s1'], input: z.object({}), request: () => ({ method: 'GET', path: '/c' }) })],
    });
    expect(tk.scopes).toEqual(['explicit']);
  });
});

describe('aesGcmSecretBox', () => {
  it('round-trips a value', async () => {
    const box = aesGcmSecretBox({ key: generateSecretKey() });
    const sealed = await box.seal({ token: 'abc', n: 1 });
    expect(sealed).not.toContain('abc'); // ciphertext, not plaintext
    expect(await box.open(sealed)).toEqual({ token: 'abc', n: 1 });
  });
  it('fails to open with the wrong key', async () => {
    const a = aesGcmSecretBox({ key: 'key-a' });
    const b = aesGcmSecretBox({ key: 'key-b' });
    const sealed = await a.seal({ x: 1 });
    await expect(b.open(sealed)).rejects.toThrow();
  });
  it('plaintext box is readable (tests only)', async () => {
    const box = plaintextSecretBox();
    const sealed = await box.seal({ x: 1 });
    expect(sealed).toContain('"x":1');
    expect(await box.open(sealed)).toEqual({ x: 1 });
  });
});
