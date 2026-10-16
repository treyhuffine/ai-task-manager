import { AppError } from '@ri/app-kit/contract';
import { sha256, type AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx } from '../context.js';
import { affiliationKey, observeAffiliation } from '../affiliations.js';
import { attachKey, ensureKey, findKey, normalizeIdentifier, observe } from '../identity.js';
import { senderDecision } from '../exclusions.js';
import { addDomain, createOrganizationRecord, refreshOrganization } from '../organizations.js';
import { createPersonRecord, refreshPerson } from '../people.js';
import { propose, proposeOrganizationMatches, proposeSameName } from '../reviews.js';
import { touch, writableCollection } from '../scope.js';
import { setSearchRow } from '../search.js';
import { cleanName, cleanText, domainOf, json, organizationKey, sortKey } from '../text.js';
import { MAX_ROWS, decodeText, detectFormat, parseCsv, parseVcards, rowsFromTable, type ImportFormat, type ParsedRow } from './parse.js';

const PREVIEW_MS = 60 * 60_000;
export const MAX_FILE_BYTES = 512 * 1024;

type RowAction = 'create' | 'update' | 'proposed_merge' | 'skipped' | 'unsupported';
interface PlannedRow {
  row: ParsedRow;
  action: RowAction;
  reason: string | null;
  personId: string | null;
  candidates: string[];
  key: string;
  digest: string;
  companyKey: string | null;
  invalid: string[];
}
interface PreviewPayload {
  format: ImportFormat; fileName: string; fileDigest: string; collection: string; listName: string | null;
  rows: PlannedRow[]; companies: { key: string; name: string; candidates: string[]; action: 'new' | 'existing'; organizationId: string | null }[];
  mapping: Record<string, string>; truncated: boolean;
}

function rowKey(format: ImportFormat, row: ParsedRow): string {
  const email = row.emails.map((value) => normalizeIdentifier('email', value)).find(Boolean);
  const linkedin = row.linkedin ? normalizeIdentifier('linkedin', row.linkedin) : null;
  if (row.externalId) return `ext:${format}:${row.externalId}`;
  if (email) return `email:${email}`;
  if (linkedin) return `linkedin:${linkedin}`;
  return `name:${sortKey(row.name ?? '')}:${sortKey(row.company ?? '')}`;
}
function rowDigest(row: ParsedRow) {
  return sha256(JSON.stringify([row.name, row.emails, row.phones, row.linkedin, row.company, row.role, row.website, row.notes, row.lists, row.externalId, row.unmapped]));
}

/**
 * Parse a selected file and plan every row without writing records: create,
 * update an exact identifier match, propose a merge for a same-name match,
 * or skip duplicates, suppressed addresses and rows already imported. The
 * stored plan is what apply uses, unchanged.
 */
export function previewImport(ctx: Ctx, scope: AccessScope, input: { fileName: string; mimeType: string; base64: string; format?: ImportFormat | 'auto'; collection?: string; listName?: string | null }) {
  const bytes = Buffer.byteLength(input.base64, 'base64');
  if (bytes > MAX_FILE_BYTES) throw new AppError('invalid_input', 'Choose a file up to 512 KiB, or split the export');
  const text = decodeText(input.base64);
  if (!text.trim()) throw new AppError('invalid_input', 'This file is empty');
  const format = input.format && input.format !== 'auto' ? input.format : detectFormat(text);
  const collection = writableCollection(ctx, scope, input.collection);
  const parsed = format === 'vcard' ? { ...parseVcards(text), mapping: { FN: 'name', EMAIL: 'email', TEL: 'phone', ORG: 'company', TITLE: 'role', NOTE: 'notes', URL: 'website', CATEGORIES: 'lists', UID: 'externalId' } } : rowsFromTable(parseCsv(text), format);
  if (!parsed.rows.length) throw new AppError('invalid_input', format === 'vcard' ? 'No contacts were found in this vCard file' : 'No rows were found. Check that the first row names the columns');
  const fileDigest = sha256(input.base64);
  const seen = new Map<string, number>();
  const companies = new Map<string, PreviewPayload['companies'][number]>();
  const existingOrgs = ctx.db.all<{ id: string; display_name: string }>('SELECT id, display_name FROM organizations WHERE merged_into IS NULL LIMIT 20000');
  const rows: PlannedRow[] = parsed.rows.map((row) => {
    const invalid = row.emails.filter((value) => !normalizeIdentifier('email', value));
    row.emails = row.emails.filter((value) => normalizeIdentifier('email', value));
    const key = rowKey(format, row), digest = rowDigest(row);
    const companyName = cleanName(row.company, 200);
    const companyKey = companyName ? organizationKey(companyName) || sortKey(companyName) : null;
    const planned: PlannedRow = { row, action: 'create', reason: null, personId: null, candidates: [], key, digest, companyKey, invalid };
    if (!row.name && !row.emails.length && !row.linkedin) return { ...planned, action: invalid.length ? 'unsupported' : 'skipped', reason: invalid.length ? 'The address could not be read' : 'No name or address' };
    const identifiers = [...row.emails.map((value) => `e:${normalizeIdentifier('email', value)}`), ...(row.linkedin ? [`l:${normalizeIdentifier('linkedin', row.linkedin)}`] : []), ...(row.externalId ? [`x:${row.externalId}`] : [])];
    const duplicate = identifiers.find((identifier) => seen.has(identifier));
    if (duplicate) return { ...planned, action: 'skipped', reason: `Duplicate of row ${seen.get(duplicate)} in this file` };
    for (const identifier of identifiers) seen.set(identifier, row.index);
    if (row.emails.some((value) => senderDecision(ctx, value) === 'suppressed')) return { ...planned, action: 'skipped', reason: 'Rediscovery of this address is suppressed' };
    const prior = ctx.db.get<{ person_id: string | null }>('SELECT person_id FROM import_rows WHERE row_key = ? AND row_digest = ? ORDER BY created_at DESC LIMIT 1', key, digest);
    if (prior) return { ...planned, action: 'skipped', reason: 'Already imported with the same details', personId: prior.person_id };
    if (companyKey && !companies.has(companyKey)) {
      const candidates = existingOrgs.filter((org) => organizationKey(org.display_name) === companyKey).map((org) => org.id).slice(0, 5);
      companies.set(companyKey, { key: companyKey, name: companyName!, candidates, action: candidates.length === 1 ? 'existing' : 'new', organizationId: candidates.length === 1 ? candidates[0] : null });
    }
    for (const value of row.emails) {
      const owner = findKey(ctx, 'email', normalizeIdentifier('email', value)!);
      if (owner?.ownerKind === 'person' && owner.ownerId && !owner.shared) return { ...planned, action: 'update', personId: owner.ownerId, reason: `Matches ${normalizeIdentifier('email', value)}` };
    }
    if (row.linkedin) {
      const owner = findKey(ctx, 'linkedin', normalizeIdentifier('linkedin', row.linkedin) ?? '');
      if (owner?.ownerKind === 'person' && owner.ownerId) return { ...planned, action: 'update', personId: owner.ownerId, reason: 'Matches the same LinkedIn profile' };
    }
    const previous = ctx.db.get<{ person_id: string | null }>('SELECT person_id FROM import_rows WHERE row_key = ? AND person_id IS NOT NULL ORDER BY created_at DESC LIMIT 1', key);
    if (previous?.person_id && ctx.db.get('SELECT 1 AS ok FROM persons WHERE id = ? AND merged_into IS NULL', previous.person_id)) return { ...planned, action: 'update', personId: previous.person_id, reason: 'Updates an earlier import of this contact' };
    if (row.name) {
      const sameName = ctx.db.all<{ id: string }>('SELECT id FROM persons WHERE sort_name = ? AND merged_into IS NULL LIMIT 5', sortKey(row.name)).map((item) => item.id);
      if (sameName.length) return { ...planned, action: 'proposed_merge', candidates: sameName, reason: 'Same name as an existing person. Kept separate unless you choose to merge' };
    }
    return planned;
  });
  if (parsed.truncated) rows.push({ row: { index: MAX_ROWS + 1, name: null, emails: [], phones: [], linkedin: null, company: null, role: null, website: null, notes: null, lists: [], externalId: null, observedOn: null, raw: {}, unmapped: {} }, action: 'unsupported', reason: `Only the first ${MAX_ROWS} rows can be imported at once`, personId: null, candidates: [], key: 'over-limit', digest: 'over-limit', companyKey: null, invalid: [] });
  const payload: PreviewPayload = { format, fileName: input.fileName.slice(0, 200), fileDigest, collection, listName: cleanName(input.listName ?? null, 120), rows, companies: [...companies.values()], mapping: parsed.mapping, truncated: parsed.truncated };
  const time = iso(ctx), id = newId();
  const serialized = JSON.stringify(payload);
  const digest = sha256(`${id}:${serialized}`);
  const expiresAt = new Date(ctx.now().getTime() + PREVIEW_MS).toISOString();
  ctx.db.run("INSERT INTO previews (id, created_at, updated_at, kind, expires_at, digest, payload, applied_at, result) VALUES (?, ?, ?, 'import', ?, ?, ?, NULL, NULL)", id, time, time, expiresAt, digest, serialized);
  return summarizePreview(ctx, id, digest, expiresAt, payload);
}

function summarizePreview(ctx: Ctx, previewId: string, digest: string, expiresAt: string, payload: PreviewPayload) {
  const counts = { create: 0, update: 0, proposedMerge: 0, skipped: 0, unsupported: 0 };
  for (const row of payload.rows) counts[row.action === 'proposed_merge' ? 'proposedMerge' : row.action]++;
  const name = (id: string) => ctx.db.get<{ display_name: string }>('SELECT display_name FROM persons WHERE id = ?', id)?.display_name ?? 'Unknown person';
  const orgName = (id: string) => ctx.db.get<{ display_name: string }>('SELECT display_name FROM organizations WHERE id = ?', id)?.display_name ?? 'Unknown company';
  const unmapped = [...new Set(payload.rows.flatMap((row) => Object.keys(row.row.unmapped)))].slice(0, 30);
  const previous = ctx.db.get<{ label: string; created_at: string }>('SELECT label, created_at FROM imports WHERE file_digest = ? ORDER BY created_at DESC LIMIT 1', payload.fileDigest);
  return {
    previewId, digest, expiresAt, format: payload.format, fileName: payload.fileName, collection: payload.collection, counts,
    rows: payload.rows.slice(0, 100).map((row) => ({
      row: row.row.index, name: row.row.name, emails: row.row.emails.slice(0, 3), company: row.row.company, role: row.row.role,
      action: row.action, reason: row.reason, match: row.personId ? { id: row.personId, name: name(row.personId) } : null,
      candidates: row.candidates.map((id) => ({ id, name: name(id) })), invalid: row.invalid.slice(0, 3),
    })),
    moreRows: Math.max(0, payload.rows.length - 100),
    companies: payload.companies.slice(0, 100).map((company) => ({ key: company.key, name: company.name, action: company.action, organization: company.organizationId ? { id: company.organizationId, name: orgName(company.organizationId) } : null, candidates: company.candidates.map((id) => ({ id, name: orgName(id) })) })),
    mapping: payload.mapping, unmapped,
    note: payload.format === 'linkedin' ? 'A LinkedIn export is a snapshot. Roles keep their export date and are not treated as current employment. Missing emails are normal.' : 'Roles keep the import date and are not treated as current employment until you confirm them.',
    previouslyImported: previous ? `This file was imported before as ${previous.label}` : null,
  };
}

const labelFor = (format: ImportFormat, fileName: string, when: string) => {
  const date = new Date(when).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return format === 'linkedin' ? `LinkedIn export, ${date}` : format === 'vcard' ? `${fileName} (vCard), ${date}` : `${fileName}, ${date}`;
};

/**
 * Apply exactly the stored plan once. People and companies are written
 * together in one transaction. Re-applying the same preview returns the first
 * result. A same-name match is only merged when you chose that row.
 */
export function applyImport(ctx: Ctx, scope: AccessScope, input: { previewId: string; digest: string; decisions?: { row: number; action: 'create' | 'skip' | 'merge'; personId?: string }[]; companyDecisions?: { key: string; action: 'new' | 'existing' | 'none'; organizationId?: string }[] }) {
  const preview = ctx.db.get<{ id: string; kind: string; expires_at: string; digest: string; payload: string; applied_at: string | null; result: string | null }>('SELECT * FROM previews WHERE id = ?', input.previewId);
  if (!preview || preview.kind !== 'import') throw new AppError('not_found', 'This preview expired. Choose the file again');
  if (preview.digest !== input.digest) throw new AppError('conflict', 'The preview changed. Choose the file again');
  if (preview.applied_at && preview.result) return JSON.parse(preview.result);
  if (preview.expires_at < iso(ctx)) throw new AppError('conflict', 'This preview expired. Choose the file again');
  const payload = json<PreviewPayload>(preview.payload, null as never);
  const collection = writableCollection(ctx, scope, payload.collection);
  const decisions = new Map((input.decisions ?? []).map((item) => [item.row, item]));
  const companyDecisions = new Map((input.companyDecisions ?? []).map((item) => [item.key, item]));
  const time = iso(ctx), importId = newId(), source = `import:${importId}`;
  const label = labelFor(payload.format, payload.fileName, time);
  const counts = { created: 0, updated: 0, merged: 0, skipped: 0, unsupported: 0, companies: 0 };
  ctx.db.run('INSERT INTO collections (id, created_at, updated_at, revision, source_key, label, archived_at) VALUES (?, ?, ?, 1, ?, ?, NULL) ON CONFLICT(source_key) DO NOTHING', newId(), time, time, 'manual', 'Your records');
  const orgIds = new Map<string, string | null>();
  for (const company of payload.companies) {
    const decision = companyDecisions.get(company.key);
    const action = decision?.action ?? company.action;
    if (action === 'none') { orgIds.set(company.key, null); continue; }
    if (action === 'existing') {
      const id = decision?.organizationId ?? company.organizationId;
      if (!id || !ctx.db.get('SELECT 1 AS ok FROM organizations WHERE id = ? AND merged_into IS NULL', id)) throw new AppError('conflict', `${company.name} is no longer available. Preview again`);
      orgIds.set(company.key, id);
      continue;
    }
    orgIds.set(company.key, 'new');
  }
  // New companies are created on first use, so a company whose rows were all skipped is never left empty.
  const organizationFor = (key: string | null) => {
    if (!key) return null;
    const value = orgIds.get(key) ?? null;
    if (value !== 'new') return value;
    const id = createOrganizationRecord(ctx, { origin: 'import', collection, state: 'provisional' });
    orgIds.set(key, id);
    counts.companies++;
    return id;
  };
  const lists = new Map<string, string>();
  const listFor = (name: string) => {
    const key = sortKey(name);
    if (lists.has(key)) return lists.get(key)!;
    const existing = ctx.db.get<{ id: string }>("SELECT id FROM lists WHERE lower(name) = lower(?) AND record_kind = 'person' AND collection = ? AND archived_at IS NULL", name, collection);
    const id = existing?.id ?? newId();
    if (!existing) ctx.db.run("INSERT INTO lists (id, created_at, updated_at, revision, name, record_kind, collection, archived_at) VALUES (?, ?, ?, 1, ?, 'person', ?, NULL)", id, time, time, name.slice(0, 120), collection);
    lists.set(key, id);
    return id;
  };
  const touchedPeople = new Set<string>(), createdPeople: string[] = [], touchedOrgs = new Set<string>();
  ctx.db.run('INSERT INTO imports (id, created_at, updated_at, source_key, preview_id, format, file_name, file_digest, label, counts, collection) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    importId, time, time, source, preview.id, payload.format, payload.fileName, payload.fileDigest, label, '{}', collection);
  for (const planned of payload.rows) {
    const decision = decisions.get(planned.row.index);
    let action: RowAction | 'merge' = planned.action;
    if (decision?.action === 'skip') action = 'skipped';
    else if (decision?.action === 'create' && (planned.action === 'proposed_merge' || planned.action === 'create')) action = 'create';
    else if (decision?.action === 'merge') {
      if (!decision.personId || !ctx.db.get('SELECT 1 AS ok FROM persons WHERE id = ? AND merged_into IS NULL', decision.personId)) throw new AppError('invalid_input', `Row ${planned.row.index}: choose an existing person to merge with`);
      action = 'merge';
    }
    if (action === 'skipped' || action === 'unsupported') { counts[action]++; continue; }
    const row = planned.row;
    let personId: string;
    if (action === 'create' || action === 'proposed_merge') {
      personId = createPersonRecord(ctx, { origin: 'import', collection });
      createdPeople.push(personId);
      counts.created++;
    } else {
      personId = action === 'merge' ? decision!.personId! : planned.personId!;
      if (!ctx.db.get('SELECT 1 AS ok FROM persons WHERE id = ? AND merged_into IS NULL', personId)) throw new AppError('conflict', `Row ${row.index}: the matching person changed. Preview again`);
      counts[action === 'merge' ? 'merged' : 'updated']++;
    }
    const observedAt = row.observedOn ? `${row.observedOn}T12:00:00.000Z` : time;
    for (const [kind, values] of [['email', row.emails], ['phone', row.phones], ['linkedin', row.linkedin ? [row.linkedin] : []]] as const) {
      for (const value of values) {
        const key = ensureKey(ctx, kind, value);
        if (!key) continue;
        observe(ctx, { keyId: key.id, sourceKey: source, value, name: row.name, at: observedAt });
        if (key.ownerKind === 'none' && !key.shared && key.decision === 'auto') attachKey(ctx, key.id, 'person', personId, 'auto');
        else if (key.ownerKind === 'person' && key.ownerId && key.ownerId !== personId)
          propose(ctx, { kind: 'person', leftId: key.ownerId, rightId: personId, reason: 'import_identifier', sourceKey: source, evidence: { summary: `${value} appears on both records. The import did not move it.`, shared: [value] } });
      }
    }
    const organizationId = organizationFor(planned.companyKey);
    const companyName = cleanName(row.company, 200);
    if (organizationId) {
      observeAffiliation(ctx, { personId, organizationId, role: row.role, sourceKey: source, origin: 'import', observedAt, confidence: 'observed' });
      const website = domainOf(row.website);
      if (website) { try { addDomain(ctx, organizationId, website, source, 'observed'); } catch { /* a shared mail provider is never a company domain */ } }
      touchedOrgs.add(organizationId);
    }
    const notes = cleanText(row.notes, 20000);
    if (notes) {
      const noteId = newId();
      ctx.db.run("INSERT INTO notes (id, created_at, updated_at, revision, subject_kind, subject_id, title, body, collection, archived_at) VALUES (?, ?, ?, 1, 'person', ?, ?, ?, ?, NULL)", noteId, time, time, personId, `From ${label}`, notes, collection);
      setSearchRow(ctx, `note:${noteId}`, 'person', personId, collection, notes);
    }
    for (const name of [...row.lists, ...(payload.listName ? [payload.listName] : [])]) {
      const listId = listFor(name);
      ctx.db.run('INSERT INTO list_members (id, created_at, updated_at, list_id, member_id, position, added_by) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM list_members WHERE list_id = ?), ?) ON CONFLICT(list_id, member_id) DO NOTHING',
        `${listId}:${personId}`, time, time, listId, personId, listId, `import:${importId}`);
    }
    ctx.db.run('INSERT INTO import_rows (id, created_at, updated_at, import_id, source_key, row_key, row_digest, name, org_name, person_id, organization_id, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(), time, time, importId, source, planned.key, planned.digest, cleanName(row.name), companyName, personId, organizationId, JSON.stringify({ fields: row.raw, unmapped: row.unmapped, row: row.index }));
    touchedPeople.add(personId);
    void affiliationKey;
  }
  for (const id of touchedOrgs) refreshOrganization(ctx, id);
  for (const id of touchedPeople) refreshPerson(ctx, id);
  for (const id of createdPeople) proposeSameName(ctx, id, source);
  for (const id of touchedOrgs) proposeOrganizationMatches(ctx, id, source);
  ctx.db.run('UPDATE imports SET counts = ? WHERE id = ?', JSON.stringify(counts), importId);
  const result = { status: 'saved' as const, importId, source, label, counts };
  ctx.db.run('UPDATE previews SET applied_at = ?, result = ?, updated_at = ? WHERE id = ?', time, JSON.stringify(result), time, preview.id);
  touch(ctx, source, collection);
  return result;
}
