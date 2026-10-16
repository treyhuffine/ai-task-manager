import { AppError } from '@ri/app-kit/contract';
import { sha256 } from '@ri/app-kit/data';
import { iso, newId, type Ctx, type Row } from './context.js';
import { getPersonRow, refreshPerson } from './people.js';
import { getOrganizationRow, refreshOrganization } from './organizations.js';
import { touch } from './scope.js';
import { json } from './text.js';

/**
 * Merges record every reference they move, so undo restores exactly those
 * references. The merged record and its evidence are retained. References
 * created after the merge are listed for an explicit choice during undo,
 * never guessed. Revisions are checked first, so a stale merge changes nothing.
 */
type Move = { t: string; id: string; c: string; f: string; to: string } | { t: string; del: Row } | { t: string; keep: string };
type Kind = 'person' | 'organization';
interface RefSpec { table: string; column: string; where?: string; dedupe?: { unique: string[] } }

const PERSON_REFS: RefSpec[] = [
  { table: 'identity_keys', column: 'owner_id', where: "owner_kind = 'person'" },
  { table: 'affiliations', column: 'person_id' },
  { table: 'notes', column: 'subject_id', where: "subject_kind = 'person'" },
  { table: 'commitments', column: 'person_id' },
  { table: 'task_links', column: 'subject_id', where: "subject_kind = 'person'" },
  { table: 'list_members', column: 'member_id', dedupe: { unique: ['list_id'] } },
  { table: 'opportunity_people', column: 'person_id', dedupe: { unique: ['opportunity_id'] } },
  { table: 'facts', column: 'subject_id', where: "subject_kind = 'person'" },
  { table: 'import_rows', column: 'person_id' },
  { table: 'attribution_rules', column: 'person_id' },
];
const ORGANIZATION_REFS: RefSpec[] = [
  { table: 'identity_keys', column: 'owner_id', where: "owner_kind = 'organization'" },
  { table: 'organization_domains', column: 'organization_id', dedupe: { unique: ['domain', 'source_key'] } },
  { table: 'affiliations', column: 'organization_id' },
  { table: 'interaction_links', column: 'target_id', where: "target_kind = 'organization'", dedupe: { unique: ['interaction_id', 'target_kind', 'origin', 'rule_id'] } },
  { table: 'opportunities', column: 'organization_id' },
  { table: 'notes', column: 'subject_id', where: "subject_kind = 'organization'" },
  { table: 'list_members', column: 'member_id', dedupe: { unique: ['list_id'] } },
  { table: 'commitments', column: 'organization_id' },
  { table: 'task_links', column: 'subject_id', where: "subject_kind = 'organization'" },
  { table: 'attribution_rules', column: 'organization_id' },
  { table: 'facts', column: 'subject_id', where: "subject_kind = 'organization'" },
  { table: 'import_rows', column: 'organization_id' },
];
const refsOf = (kind: Kind) => (kind === 'person' ? PERSON_REFS : ORGANIZATION_REFS);
const tableOf = (kind: Kind) => (kind === 'person' ? 'persons' : 'organizations');

function moveReferences(ctx: Ctx, kind: Kind, from: string, to: string): Move[] {
  const moves: Move[] = [];
  const time = iso(ctx);
  for (const spec of refsOf(kind)) {
    const rows = ctx.db.all<Row>(`SELECT * FROM ${spec.table} WHERE ${spec.column} = ? ${spec.where ? `AND ${spec.where}` : ''}`, from);
    for (const row of rows) {
      if (spec.dedupe) {
        const clash = ctx.db.get(`SELECT 1 AS ok FROM ${spec.table} WHERE ${spec.column} = ? AND ${spec.dedupe.unique.map((column) => `${column} IS ?`).join(' AND ')}`, to, ...spec.dedupe.unique.map((column) => row[column] as string | null));
        if (clash) {
          ctx.db.run(`DELETE FROM ${spec.table} WHERE id = ?`, String(row.id));
          moves.push({ t: spec.table, del: row });
          continue;
        }
      }
      ctx.db.run(`UPDATE ${spec.table} SET ${spec.column} = ?, updated_at = ? WHERE id = ?`, to, time, String(row.id));
      moves.push({ t: spec.table, id: String(row.id), c: spec.column, f: from, to });
    }
  }
  if (kind === 'person') ctx.db.run('UPDATE interaction_participants SET person_id = ?, updated_at = ? WHERE person_id = ?', to, time, from);
  return moves;
}

function closePairReviews(ctx: Ctx, kind: Kind, a: string, b: string, mergeId: string, actor: string) {
  const time = iso(ctx);
  ctx.db.run(`UPDATE identity_reviews SET state = 'merged', merge_id = ?, decided_at = ?, decided_by = ?, revision = revision + 1, updated_at = ? WHERE kind = ? AND state = 'open' AND ((left_id = ? AND right_id = ?) OR (left_id = ? AND right_id = ?))`,
    mergeId, time, actor, time, kind, a, b, b, a);
}

export function merge(ctx: Ctx, kind: Kind, actor: string, input: { survivorId: string; mergedId: string; survivorRevision: number; mergedRevision: number; reviewId?: string }) {
  if (input.survivorId === input.mergedId) throw new AppError('invalid_input', 'Choose two different records');
  const get = kind === 'person' ? getPersonRow : getOrganizationRow;
  const survivor = get(ctx, input.survivorId), merged = get(ctx, input.mergedId);
  if (!survivor || survivor.merged_into || !merged || merged.merged_into) throw new AppError('not_found', 'One of these records is no longer available');
  if (survivor.revision !== input.survivorRevision || merged.revision !== input.mergedRevision)
    return { status: 'conflict' as const, message: 'One of these records changed since you reviewed it. Nothing was merged. Review again', mergeId: null };
  const time = iso(ctx), mergeId = newId();
  // The survivor's own references are remembered so undo can tell them apart from later additions without guessing.
  const kept: Move[] = refsOf(kind).flatMap((spec) => ctx.db.all<{ id: string }>(`SELECT id FROM ${spec.table} WHERE ${spec.column} = ? ${spec.where ? `AND ${spec.where}` : ''}`, survivor.id).map((row) => ({ t: spec.table, keep: String(row.id) })));
  const moves = [...kept, ...moveReferences(ctx, kind, merged.id, survivor.id)];
  const table = tableOf(kind);
  ctx.db.run(`UPDATE ${table} SET merged_into = ?, merged_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`, survivor.id, time, time, merged.id);
  ctx.db.run(`UPDATE ${table} SET revision = revision + 1, updated_at = ? WHERE id = ?`, time, survivor.id);
  ctx.db.run('INSERT INTO merges (id, created_at, updated_at, revision, kind, survivor_id, merged_id, moves, state, actor, undone_at, attributions) VALUES (?, ?, ?, 1, ?, ?, ?, ?, \'applied\', ?, NULL, NULL)',
    mergeId, time, time, kind, survivor.id, merged.id, JSON.stringify(moves), actor);
  ctx.db.run('INSERT INTO id_mappings (id, created_at, updated_at, from_id, to_id, kind, merge_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', newId(), time, time, merged.id, survivor.id, kind, mergeId);
  ctx.db.run('DELETE FROM briefings WHERE subject_kind = ? AND subject_id IN (?, ?)', kind, survivor.id, merged.id);
  closePairReviews(ctx, kind, survivor.id, merged.id, mergeId, actor);
  refreshAfter(ctx, kind, moves, [survivor.id, merged.id]);
  touch(ctx, survivor.collection, merged.collection);
  return { status: 'saved' as const, mergeId, message: null };
}

function refreshAfter(ctx: Ctx, kind: Kind, moves: Move[], ids: string[]) {
  const persons = new Set<string>(), organizations = new Set<string>();
  for (const id of ids) (kind === 'person' ? persons : organizations).add(id);
  for (const move of moves) {
    if ('keep' in move) continue;
    const row = 'del' in move ? move.del : ctx.db.get<Row>(`SELECT * FROM ${move.t} WHERE id = ?`, move.id);
    if (!row) continue;
    if (move.t === 'affiliations') { persons.add(String(row.person_id)); organizations.add(String(row.organization_id)); }
    if (move.t === 'opportunities' && row.organization_id) organizations.add(String(row.organization_id));
  }
  for (const id of persons) refreshPerson(ctx, id);
  for (const id of organizations) refreshOrganization(ctx, id);
}

type MergeRow = { id: string; created_at: string; revision: number; kind: Kind; survivor_id: string; merged_id: string; moves: string; state: string };
interface LaterRef { ref: string; table: string; id: string; label: string; createdAt: string }

/** References to the survivor created after the merge. Undo asks where each belongs. */
function laterReferences(ctx: Ctx, merge: MergeRow): LaterRef[] {
  const known = new Set(json<Move[]>(merge.moves, []).flatMap((move) => ('id' in move ? [`${move.t}:${move.id}`] : 'keep' in move ? [`${move.t}:${move.keep}`] : [])));
  const moved = known;
  const refs: LaterRef[] = [];
  for (const spec of refsOf(merge.kind)) {
    for (const row of ctx.db.all<Row>(`SELECT * FROM ${spec.table} WHERE ${spec.column} = ? ${spec.where ? `AND ${spec.where}` : ''} LIMIT 400`, merge.survivor_id)) {
      const key = `${spec.table}:${String(row.id)}`;
      if (moved.has(key)) continue;
      refs.push({ ref: key, table: spec.table, id: String(row.id), label: describeRef(spec.table, row), createdAt: String(row.created_at) });
    }
  }
  return refs;
}
function describeRef(table: string, row: Row): string {
  switch (table) {
    case 'identity_keys': return `Address ${String(row.normalized)}`;
    case 'notes': return `Note: ${String(row.body).slice(0, 80)}`;
    case 'commitments': return `Commitment: ${String(row.action).slice(0, 80)}`;
    case 'task_links': return `Ri follow-up: ${String(row.title).slice(0, 80)}`;
    case 'affiliations': return `Affiliation${row.role ? `: ${String(row.role).slice(0, 60)}` : ''}`;
    case 'list_members': return 'List membership';
    case 'opportunity_people': return 'Opportunity link';
    case 'opportunities': return `Opportunity: ${String(row.title).slice(0, 80)}`;
    case 'interaction_links': return 'Linked conversation';
    case 'organization_domains': return `Domain ${String(row.domain)}`;
    default: return 'Linked record';
  }
}

export function undoPreview(ctx: Ctx, mergeId: string) {
  const merge = ctx.db.get<MergeRow>('SELECT * FROM merges WHERE id = ?', mergeId);
  if (!merge) throw new AppError('not_found', 'This merge is no longer available');
  if (merge.state !== 'applied') throw new AppError('conflict', 'This merge was already undone');
  const moves = json<Move[]>(merge.moves, []).filter((move) => !('keep' in move));
  const later = laterReferences(ctx, merge);
  return {
    mergeId: merge.id, revision: merge.revision, kind: merge.kind, survivorId: merge.survivor_id, mergedId: merge.merged_id,
    restores: moves.length, laterReferences: later.map(({ ref, label, createdAt }) => ({ ref, label, createdAt })),
    digest: sha256(JSON.stringify([merge.id, merge.revision, later.map((item) => item.ref).sort()])),
  };
}

/**
 * Undo restores exactly the recorded references and the merged record. Every
 * reference added after the merge must be attributed by the user. If anything
 * changed since the preview, nothing is undone.
 */
export function undoMerge(ctx: Ctx, actor: string, input: { mergeId: string; expectedRevision: number; digest: string; attributions: { ref: string; to: 'survivor' | 'restored' }[] }) {
  const preview = undoPreview(ctx, input.mergeId);
  if (preview.revision !== input.expectedRevision || preview.digest !== input.digest) throw new AppError('conflict', 'This merge changed since the preview. Nothing was undone. Review again');
  const choices = new Map(input.attributions.map((item) => [item.ref, item.to]));
  const missing = preview.laterReferences.filter((item) => !choices.has(item.ref));
  if (missing.length) throw new AppError('invalid_input', `Choose where ${missing.length} later ${missing.length === 1 ? 'reference belongs' : 'references belong'} before undoing`);
  const merge = ctx.db.get<MergeRow>('SELECT * FROM merges WHERE id = ?', input.mergeId)!;
  const time = iso(ctx);
  const skipped: string[] = [];
  const moves = json<Move[]>(merge.moves, []).filter((move) => !('keep' in move));
  for (const move of [...moves].reverse()) {
    if ('keep' in move) continue;
    if ('del' in move) {
      const columns = Object.keys(move.del);
      try {
        ctx.db.run(`INSERT INTO ${move.t} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, ...columns.map((column) => move.del[column] as string | number | null));
      } catch { skipped.push(`${move.t}:${String(move.del.id)}`); }
      continue;
    }
    const changed = Number(ctx.db.run(`UPDATE ${move.t} SET ${move.c} = ?, updated_at = ? WHERE id = ? AND ${move.c} = ?`, move.f, time, move.id, move.to).changes);
    if (!changed) skipped.push(`${move.t}:${move.id}`);
  }
  const later = laterReferences(ctx, merge);
  for (const ref of later) {
    if (choices.get(ref.ref) !== 'restored') continue;
    const spec = refsOf(merge.kind).find((item) => item.table === ref.table)!;
    ctx.db.run(`UPDATE ${ref.table} SET ${spec.column} = ?, updated_at = ? WHERE id = ?`, merge.merged_id, time, ref.id);
  }
  if (merge.kind === 'person') {
    // Participants follow their identity keys again.
    ctx.db.run(`UPDATE interaction_participants SET person_id = (SELECT CASE WHEN k.owner_kind = 'person' THEN k.owner_id END FROM identity_keys k WHERE k.id = interaction_participants.key_id), updated_at = ?
                WHERE person_id = ? OR key_id IN (SELECT id FROM identity_keys WHERE owner_kind = 'person' AND owner_id = ?)`, time, merge.survivor_id, merge.merged_id);
  }
  const table = tableOf(merge.kind);
  ctx.db.run(`UPDATE ${table} SET merged_into = NULL, merged_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`, time, merge.merged_id);
  ctx.db.run(`UPDATE ${table} SET revision = revision + 1, updated_at = ? WHERE id = ?`, time, merge.survivor_id);
  ctx.db.run("UPDATE merges SET state = 'undone', undone_at = ?, attributions = ?, revision = revision + 1, updated_at = ? WHERE id = ?", time, JSON.stringify(input.attributions), time, merge.id);
  ctx.db.run('UPDATE id_mappings SET active = 0, updated_at = ? WHERE merge_id = ?', time, merge.id);
  ctx.db.run("UPDATE identity_reviews SET state = 'kept_separate', updated_at = ? WHERE merge_id = ?", time, merge.id);
  ctx.db.run('DELETE FROM briefings WHERE subject_kind = ? AND subject_id IN (?, ?)', merge.kind, merge.survivor_id, merge.merged_id);
  refreshAfter(ctx, merge.kind, moves, [merge.survivor_id, merge.merged_id]);
  const survivor = ctx.db.get<{ collection: string }>(`SELECT collection FROM ${table} WHERE id = ?`, merge.survivor_id);
  touch(ctx, survivor?.collection);
  return { status: 'saved' as const, mergeId: merge.id, restored: merge.merged_id, skipped };
}

export function mergesFor(ctx: Ctx, kind: Kind, id: string) {
  return ctx.db.all<{ id: string; created_at: string; revision: number; survivor_id: string; merged_id: string; state: string }>("SELECT id, created_at, revision, survivor_id, merged_id, state FROM merges WHERE kind = ? AND (survivor_id = ? OR merged_id = ?) AND state = 'applied' ORDER BY created_at DESC LIMIT 10", kind, id, id);
}
