import { iso, newId, type Ctx } from './context.js';

/**
 * Durable user decisions on claims, keyed by a stable source/claim key. They
 * survive resync, a new extraction version, deletion of the judged record and
 * backup restore, so a rejected claim is never silently restored.
 */
export interface DecisionRow {
  decision_key: string;
  kind: string;
  subject_kind: string;
  subject_id: string;
  decision: string;
  extracted_value: string | null;
  user_value: string | null;
  fingerprint: string | null;
  item_key: string | null;
  actor: string;
  updated_at: string;
}

export function recordDecision(ctx: Ctx, input: {
  key: string; kind: 'fact' | 'commitment' | 'affiliation' | 'identity'; subjectKind: string; subjectId: string;
  decision: string; extractedValue?: string | null; userValue?: string | null; fingerprint?: string | null; itemKey?: string | null; actor: string;
}) {
  const time = iso(ctx);
  ctx.db.run(
    `INSERT INTO decisions (id, created_at, updated_at, revision, decision_key, kind, subject_kind, subject_id, decision, extracted_value, user_value, fingerprint, actor, item_key)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(decision_key) DO UPDATE SET decision = excluded.decision, user_value = excluded.user_value, actor = excluded.actor,
       subject_id = excluded.subject_id, revision = decisions.revision + 1, updated_at = excluded.updated_at`,
    newId(), time, time, input.key, input.kind, input.subjectKind, input.subjectId, input.decision,
    input.extractedValue ?? null, input.userValue ?? null, input.fingerprint ?? null, input.actor, input.itemKey ?? null,
  );
}
export function findDecision(ctx: Ctx, key: string): DecisionRow | undefined {
  return ctx.db.get<DecisionRow>('SELECT * FROM decisions WHERE decision_key = ?', key);
}
export function decisionsForItem(ctx: Ctx, itemKey: string): DecisionRow[] {
  return ctx.db.all<DecisionRow>('SELECT * FROM decisions WHERE item_key = ? LIMIT 50', itemKey);
}
export function decisionsForSubject(ctx: Ctx, kind: string, subjectKind: string, subjectId: string, decision: string): DecisionRow[] {
  return ctx.db.all<DecisionRow>('SELECT * FROM decisions WHERE kind = ? AND subject_kind = ? AND subject_id = ? AND decision = ? ORDER BY updated_at DESC LIMIT 50', kind, subjectKind, subjectId, decision);
}
