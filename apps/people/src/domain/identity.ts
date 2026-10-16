import { emailDomain, isNoReply, isRoleAddress, normalizeEmail } from '@ri/app-kit/sources';
import { iso, newId, type Ctx } from './context.js';
import { domainOf } from './text.js';

export type KeyKind = 'email' | 'domain' | 'phone' | 'linkedin' | 'website';
export interface IdentityKey {
  id: string;
  kind: KeyKind;
  normalized: string;
  ownerKind: 'person' | 'organization' | 'none';
  ownerId: string | null;
  shared: boolean;
  decision: 'auto' | 'user';
  revision: number;
}
type KeyRow = { id: string; kind: string; normalized: string; owner_kind: string; owner_id: string | null; shared: number; decision: string; revision: number };
const keyOf = (row: KeyRow): IdentityKey => ({
  id: row.id, kind: row.kind as KeyKind, normalized: row.normalized, ownerKind: row.owner_kind as IdentityKey['ownerKind'],
  ownerId: row.owner_id, shared: row.shared === 1, decision: row.decision as IdentityKey['decision'], revision: row.revision,
});

/**
 * Normalization follows the identity rules: trim, lower-case the email domain
 * only, never strip dots or plus suffixes. Phones keep digits and a leading
 * plus. LinkedIn URLs keep their profile path.
 */
export function normalizeIdentifier(kind: KeyKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  switch (kind) {
    case 'email': {
      const normalized = normalizeEmail(trimmed.replace(/^mailto:/i, ''));
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 320 ? normalized : null;
    }
    case 'domain':
    case 'website':
      return domainOf(trimmed);
    case 'phone': {
      const digits = trimmed.replace(/[^\d+]/g, '');
      return digits.replace(/\D/g, '').length >= 6 ? digits.slice(0, 32) : null;
    }
    case 'linkedin': {
      const match = /linkedin\.com\/(in|pub|company)\/([^/?#\s]+)/i.exec(trimmed);
      return match ? `linkedin.com/${match[1].toLowerCase()}/${decodeURIComponent(match[2]).toLowerCase()}` : null;
    }
  }
}

/** Shared role mailboxes and automated senders are never one person. */
export function isSharedAddress(address: string): boolean {
  return isRoleAddress(address) || isNoReply(address);
}

export function getKey(ctx: Ctx, id: string): IdentityKey | null {
  const row = ctx.db.get<KeyRow>('SELECT * FROM identity_keys WHERE id = ?', id);
  return row ? keyOf(row) : null;
}
export function findKey(ctx: Ctx, kind: KeyKind, normalized: string): IdentityKey | null {
  const row = ctx.db.get<KeyRow>('SELECT * FROM identity_keys WHERE kind = ? AND normalized = ?', kind, normalized);
  return row ? keyOf(row) : null;
}

/** The key for an identifier, created unowned when new. Shared addresses are flagged at creation. */
export function ensureKey(ctx: Ctx, kind: KeyKind, value: string): IdentityKey | null {
  const normalized = normalizeIdentifier(kind, value);
  if (!normalized) return null;
  const existing = findKey(ctx, kind, normalized);
  if (existing) return existing;
  const time = iso(ctx), id = newId();
  ctx.db.run(
    'INSERT INTO identity_keys (id, created_at, updated_at, revision, kind, normalized, owner_kind, owner_id, shared, decision) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)',
    id, time, time, kind, normalized, 'none', kind === 'email' && isSharedAddress(normalized) ? 1 : 0, 'auto',
  );
  return getKey(ctx, id)!;
}

/** Record that a source observed this identifier, keeping the original value and the newest display name. */
export function observe(ctx: Ctx, input: { keyId: string; sourceKey: string; value: string; name?: string | null; at: string; evidenceId?: string | null; confirmation?: 'confirmed' | 'observed' }) {
  const time = iso(ctx);
  const name = input.name?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  ctx.db.run(
    `INSERT INTO identity_observations (id, created_at, updated_at, key_id, source_key, value, observed_name, observed_at, last_seen_at, evidence_id, confirmation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key_id, source_key) DO UPDATE SET
       updated_at = excluded.updated_at,
       observed_name = CASE WHEN excluded.observed_name IS NOT NULL AND (identity_observations.observed_name IS NULL OR excluded.last_seen_at >= identity_observations.last_seen_at) THEN excluded.observed_name ELSE identity_observations.observed_name END,
       last_seen_at = MAX(identity_observations.last_seen_at, excluded.last_seen_at),
       observed_at = MIN(identity_observations.observed_at, excluded.observed_at),
       confirmation = CASE WHEN excluded.confirmation = 'confirmed' THEN 'confirmed' ELSE identity_observations.confirmation END`,
    newId(), time, time, input.keyId, input.sourceKey, input.value.trim().slice(0, 400), name, input.at, input.at, input.evidenceId ?? null, input.confirmation ?? 'observed',
  );
}

/**
 * Point a key at its owner. An automatic association never overrides a user
 * decision, so manual corrections survive resync and re-extraction.
 * Returns the person IDs whose derived values need a refresh.
 */
export function attachKey(ctx: Ctx, keyId: string, ownerKind: IdentityKey['ownerKind'], ownerId: string | null, decision: 'auto' | 'user'): string[] {
  const key = getKey(ctx, keyId);
  if (!key) return [];
  if (decision === 'auto' && key.decision === 'user') return [];
  if (key.ownerKind === ownerKind && key.ownerId === ownerId && key.decision === decision) return [];
  const affected = new Set<string>();
  if (key.ownerKind === 'person' && key.ownerId) affected.add(key.ownerId);
  const time = iso(ctx);
  ctx.db.run('UPDATE identity_keys SET owner_kind = ?, owner_id = ?, decision = ?, revision = revision + 1, updated_at = ? WHERE id = ?', ownerKind, ownerId, decision, time, keyId);
  const personId = ownerKind === 'person' ? ownerId : null;
  ctx.db.run('UPDATE interaction_participants SET person_id = ?, updated_at = ? WHERE key_id = ?', personId, time, keyId);
  if (personId) affected.add(personId);
  return [...affected];
}

export function setShared(ctx: Ctx, keyId: string, shared: boolean) {
  ctx.db.run('UPDATE identity_keys SET shared = ?, decision = ?, revision = revision + 1, updated_at = ? WHERE id = ?', shared ? 1 : 0, 'user', iso(ctx), keyId);
}

/** The person that owns an email address, if any. */
export function personForEmail(ctx: Ctx, address: string): string | null {
  const normalized = normalizeIdentifier('email', address);
  if (!normalized) return null;
  const key = findKey(ctx, 'email', normalized);
  return key && key.ownerKind === 'person' && !key.shared ? key.ownerId : null;
}

/** Domains of shared mail providers never identify an employer. */
export { emailDomain };
