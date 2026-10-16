import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, sha256, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { iso, newId, type Ctx, type Param } from './context.js';
import type { Labels } from './coverage.js';
import { decisionsForItem, decisionsForSubject, recordDecision } from './decisions.js';
import { longDate, organizationRef, personRef } from './projection.js';
import { assertWritable, canSee, sourceFilter, touch, writableCollection } from './scope.js';
import { cleanText, fingerprintText, isLocalDate, similarity } from './text.js';
import type { Commitment, TaskLink } from '../schemas.js';

export type CommitmentRow = {
  id: string; created_at: string; updated_at: string; revision: number; person_id: string | null; organization_id: string | null; opportunity_id: string | null;
  direction: 'i_owe' | 'waiting_on'; actor_label: string; recipient_label: string; action: string; due_date: string | null; extracted_action: string | null; extracted_due_date: string | null;
  evidence_id: string | null; interaction_id: string | null; source_key: string; passage: string | null;
  state: 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'withdrawn'; origin: 'extracted' | 'manual';
  snoozed_until: string | null; decision_key: string | null; extraction_version: string | null; completion_evidence_id: string | null; resolution: string | null; task_link_id: string | null; previous_decision: string | null; anchor: string | null;
};

function history(ctx: Ctx, commitmentId: string, from: string | null, to: string, actor: string, note: string | null, evidenceId: string | null = null) {
  const time = iso(ctx);
  ctx.db.run('INSERT INTO commitment_history (id, created_at, updated_at, commitment_id, from_state, to_state, actor, note, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), time, time, commitmentId, from, to, actor, note, evidenceId);
}

/** The item a claim came from (a message or event), independent of which account synced it. */
export const itemKeyOf = (externalId: string, direction: string) => sha256(JSON.stringify(['commitment-item', externalId, direction]));

/**
 * Store an extracted commitment as a suggestion. A rephrasing of an existing
 * claim from the same message (same passage, new model or wording) is the
 * same claim and keeps its decision. A new message restating a dismissed
 * claim is reviewable again with the earlier dismissal shown.
 */
export function suggestCommitment(ctx: Ctx, input: {
  personId: string | null; organizationId: string | null; direction: 'i_owe' | 'waiting_on'; actorLabel: string; recipientLabel: string;
  action: string; dueDate: string | null; evidenceId: string; interactionId: string; externalId: string; sourceKey: string; passage: string; occurredAt: string; extractionVersion: string;
  /** A stable subject anchor such as `email:maya@northstar.example`, so a decision outlives a recreated record. */
  anchor?: string | null;
}): string | null {
  const itemKey = itemKeyOf(input.externalId, input.direction);
  const print = fingerprintText(input.passage);
  const same = (other: string | null) => !!other && (similarity(other, input.passage) >= 0.5 || fingerprintText(other).includes(print) || print.includes(fingerprintText(other)));
  const time = iso(ctx);
  // Same message, same claim: keep the record and its state.
  for (const row of ctx.db.all<CommitmentRow>('SELECT * FROM commitments WHERE interaction_id = ? AND direction = ?', input.interactionId, input.direction)) {
    if (same(row.passage) || same(row.action) && similarity(row.action, input.action) >= 0.6) {
      ctx.db.run('UPDATE commitments SET extraction_version = ?, updated_at = ? WHERE id = ?', input.extractionVersion, time, row.id);
      return row.id;
    }
  }
  // The same message seen through another account, or a record removed with its source: honour the stored decision.
  const decided = decisionsForItem(ctx, itemKey).find((decision) => decision.fingerprint && (similarity(decision.fingerprint, print) >= 0.5 || decision.fingerprint.includes(print) || print.includes(decision.fingerprint)));
  if (decided && ['dismissed', 'withdrawn'].includes(decided.decision)) return null;
  const state = decided && decided.decision === 'accepted' ? 'accepted' : decided?.decision === 'completed' ? 'completed' : 'suggested';
  let previous: string | null = null;
  if (input.personId && state === 'suggested') {
    const similar = [...(input.anchor ? decisionsForSubject(ctx, 'commitment', 'person', input.anchor, 'dismissed') : []), ...decisionsForSubject(ctx, 'commitment', 'person', input.personId, 'dismissed')].find((decision) => decision.item_key !== itemKey && decision.extracted_value && similarity(decision.extracted_value, input.action) >= 0.5);
    if (similar) previous = `You dismissed a similar suggestion, "${similar.extracted_value}", on ${longDate(similar.updated_at)}. This newer message from ${longDate(input.occurredAt)} restates it.`.slice(0, 400);
  }
  const id = newId();
  const key = sha256(JSON.stringify([itemKey, print.slice(0, 200)]));
  ctx.db.run(
    `INSERT INTO commitments (id, created_at, updated_at, revision, person_id, organization_id, opportunity_id, direction, actor_label, recipient_label, action, due_date, extracted_action, extracted_due_date, evidence_id, interaction_id, source_key, passage, state, origin, snoozed_until, decision_key, extraction_version, completion_evidence_id, resolution, task_link_id, previous_decision, anchor)
     VALUES (?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', NULL, ?, ?, NULL, NULL, NULL, ?, ?)`,
    id, time, time, input.personId, input.organizationId, input.direction, input.actorLabel.slice(0, 200), input.recipientLabel.slice(0, 200), input.action.slice(0, 500),
    input.dueDate, input.action.slice(0, 500), input.dueDate, input.evidenceId, input.interactionId, input.sourceKey, input.passage.slice(0, 1200), state, key, input.extractionVersion, previous, input.anchor ?? null,
  );
  history(ctx, id, null, state, 'extraction', state === 'suggested' ? 'Suggested from a message' : 'Restored your earlier decision', input.evidenceId);
  return id;
}

/**
 * Later evidence may resolve a suggestion. It never completes an accepted
 * commitment or its Ri task: it only offers that completion to the user.
 */
export function applyResolution(ctx: Ctx, commitmentId: string, kind: 'completed' | 'withdrawn', evidenceId: string, occurredAt: string) {
  const row = ctx.db.get<CommitmentRow>('SELECT * FROM commitments WHERE id = ?', commitmentId);
  if (!row) return;
  const time = iso(ctx);
  if (row.state === 'suggested') {
    const note = kind === 'completed' ? `Resolved by a later message on ${longDate(occurredAt)}` : `Withdrawn by a later message on ${longDate(occurredAt)}`;
    ctx.db.run("UPDATE commitments SET state = 'withdrawn', resolution = ?, completion_evidence_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?", note, evidenceId, time, row.id);
    history(ctx, row.id, 'suggested', 'withdrawn', 'extraction', note, evidenceId);
  } else if (row.state === 'accepted' && kind === 'completed') {
    ctx.db.run('UPDATE commitments SET completion_evidence_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', evidenceId, time, row.id);
    history(ctx, row.id, 'accepted', 'accepted', 'extraction', `A later message on ${longDate(occurredAt)} may show this is done. Still open until you mark it complete`, evidenceId);
  }
  touch(ctx, row.source_key);
}

export interface SaveCommitmentInput {
  id?: string; expectedRevision?: number;
  direction?: 'i_owe' | 'waiting_on'; personId?: string | null; organizationId?: string | null;
  action?: string; dueDate?: string | null; collection?: string;
}
/** A manual commitment, or an edit that keeps the extracted wording beside yours. */
export function saveCommitment(ctx: Ctx, scope: AccessScope, actor: string, input: SaveCommitmentInput, names: { person?: string | null; organization?: string | null }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  if (input.dueDate && !isLocalDate(input.dueDate)) throw new AppError('invalid_input', 'Use a real calendar date');
  const time = iso(ctx);
  if (!input.id) {
    const action = cleanText(input.action, 500);
    if (!action) throw new AppError('invalid_input', 'Describe the commitment');
    if (!input.direction) throw new AppError('invalid_input', 'Choose who owes this');
    if (!input.personId && !input.organizationId) throw new AppError('invalid_input', 'Choose a person or company');
    const collection = writableCollection(ctx, scope, input.collection);
    const other = names.person ?? names.organization ?? 'Them';
    const id = newId();
    ctx.db.run(
      `INSERT INTO commitments (id, created_at, updated_at, revision, person_id, organization_id, opportunity_id, direction, actor_label, recipient_label, action, due_date, extracted_action, extracted_due_date, evidence_id, interaction_id, source_key, passage, state, origin, snoozed_until, decision_key, extraction_version, completion_evidence_id, resolution, task_link_id, previous_decision, anchor)
       VALUES (?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, 'accepted', 'manual', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      id, time, time, input.personId ?? null, input.organizationId ?? null, input.direction,
      input.direction === 'i_owe' ? 'You' : other, input.direction === 'i_owe' ? other : 'You', action, input.dueDate ?? null, collection,
    );
    history(ctx, id, null, 'accepted', actor, 'Added by you');
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = ctx.db.get<CommitmentRow>('SELECT * FROM commitments WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.source_key)) throw new AppError('not_found', 'This commitment is no longer available');
  if (scope.kind !== 'owner' && !scope.operations.has('write')) throw new AppError('forbidden', 'This chat may not change that record');
  if (input.expectedRevision !== undefined && row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This commitment changed since you opened it. Compare and try again' };
  const changes: string[] = [], params: Param[] = [];
  if (input.action !== undefined) { const action = cleanText(input.action, 500); if (!action) throw new AppError('invalid_input', 'Describe the commitment'); changes.push('action = ?'); params.push(action); }
  if (input.dueDate !== undefined) { changes.push('due_date = ?'); params.push(input.dueDate); }
  if (input.direction !== undefined && input.direction !== row.direction) {
    changes.push('direction = ?', 'actor_label = ?', 'recipient_label = ?'); params.push(input.direction, row.recipient_label, row.actor_label);
  }
  ctx.db.run(`UPDATE commitments SET ${[...changes, 'revision = revision + 1', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...params, time, row.id);
  history(ctx, row.id, row.state, row.state, actor, 'Edited by you');
  touch(ctx, row.source_key);
  return { status: 'saved', id: row.id };
}

export type CommitmentDecision = 'accept' | 'dismiss' | 'complete' | 'reopen' | 'snooze' | 'unsnooze' | 'keep_open';
/** Accept, dismiss, complete, reopen or snooze. Each records who decided and when. */
export function reviewCommitment(ctx: Ctx, scope: AccessScope, actor: string, input: { id: string; expectedRevision: number; decision: CommitmentDecision; snoozedUntil?: string | null; action?: string; dueDate?: string | null }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const row = ctx.db.get<CommitmentRow>('SELECT * FROM commitments WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.source_key)) throw new AppError('not_found', 'This commitment is no longer available');
  if (scope.kind !== 'owner' && !scope.operations.has('write')) throw new AppError('forbidden', 'This chat may not change that record');
  if (row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This commitment changed since you opened it. Compare and try again' };
  const time = iso(ctx);
  const set = (state: CommitmentRow['state'], note: string) => {
    ctx.db.run('UPDATE commitments SET state = ?, revision = revision + 1, updated_at = ? WHERE id = ?', state, time, row.id);
    history(ctx, row.id, row.state, state, actor, note);
  };
  if (input.action !== undefined || input.dueDate !== undefined) {
    if (input.dueDate && !isLocalDate(input.dueDate)) throw new AppError('invalid_input', 'Use a real calendar date');
    const action = input.action !== undefined ? cleanText(input.action, 500) : row.action;
    if (!action) throw new AppError('invalid_input', 'Describe the commitment');
    ctx.db.run('UPDATE commitments SET action = ?, due_date = ?, updated_at = ? WHERE id = ?', action, input.dueDate !== undefined ? input.dueDate : row.due_date, time, row.id);
  }
  const itemKey = row.interaction_id ? itemKeyFor(ctx, row) : null;
  const remember = (decision: string) => {
    if (!row.decision_key) return;
    recordDecision(ctx, { key: row.decision_key, kind: 'commitment', subjectKind: 'person', subjectId: row.anchor ?? row.person_id ?? row.organization_id ?? row.id, decision, extractedValue: row.extracted_action ?? row.action, fingerprint: row.passage ? fingerprintText(row.passage) : null, itemKey, actor });
  };
  switch (input.decision) {
    case 'accept':
      if (!['suggested', 'dismissed', 'withdrawn'].includes(row.state)) throw new AppError('conflict', 'This commitment was already accepted or completed');
      set('accepted', 'Accepted by you'); remember('accepted'); break;
    case 'dismiss':
      if (row.state === 'dismissed') break;
      set('dismissed', 'Dismissed by you'); remember('dismissed'); break;
    case 'complete':
      if (row.state === 'completed') break;
      set('completed', row.completion_evidence_id ? 'Marked complete by you after a later message' : 'Marked complete by you'); remember('completed'); break;
    case 'reopen':
      if (!['completed', 'dismissed', 'withdrawn'].includes(row.state)) throw new AppError('conflict', 'This commitment is already open');
      set('accepted', 'Reopened by you'); remember('accepted');
      ctx.db.run('UPDATE commitments SET completion_evidence_id = NULL WHERE id = ?', row.id); break;
    case 'keep_open':
      ctx.db.run('UPDATE commitments SET completion_evidence_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ?', time, row.id);
      history(ctx, row.id, row.state, row.state, actor, 'Kept open by you'); break;
    case 'snooze':
      if (!input.snoozedUntil || !isLocalDate(input.snoozedUntil)) throw new AppError('invalid_input', 'Choose a date to snooze until');
      ctx.db.run('UPDATE commitments SET snoozed_until = ?, revision = revision + 1, updated_at = ? WHERE id = ?', input.snoozedUntil, time, row.id);
      history(ctx, row.id, row.state, row.state, actor, `Snoozed until ${longDate(`${input.snoozedUntil}T12:00:00Z`)}`); break;
    case 'unsnooze':
      ctx.db.run('UPDATE commitments SET snoozed_until = NULL, revision = revision + 1, updated_at = ? WHERE id = ?', time, row.id);
      history(ctx, row.id, row.state, row.state, actor, 'Snooze cleared'); break;
  }
  if (input.action !== undefined || input.dueDate !== undefined) {
    ctx.db.run('UPDATE commitments SET revision = revision + 1 WHERE id = ? AND revision = ?', row.id, row.revision);
  }
  touch(ctx, row.source_key);
  return { status: 'saved', id: row.id };
}
function itemKeyFor(ctx: Ctx, row: CommitmentRow) {
  const interaction = ctx.db.get<{ external_id: string }>('SELECT external_id FROM interactions WHERE id = ?', row.interaction_id);
  return interaction ? itemKeyOf(interaction.external_id, row.direction) : null;
}

// ─── Projection ──────────────────────────────────────────────────────────────

export function projectTaskLink(row: Record<string, unknown>): TaskLink {
  return {
    id: String(row.id), revision: Number(row.revision), subjectKind: row.subject_kind as TaskLink['subjectKind'], subjectId: String(row.subject_id),
    operationId: String(row.operation_id), title: String(row.title), dueAt: (row.due_at as string | null) ?? null, taskId: (row.task_id as string | null) ?? null,
    status: row.status as TaskLink['status'], taskStatus: (row.task_status as string | null) ?? null, lastError: (row.last_error as string | null) ?? null, lastCheckedAt: (row.last_checked_at as string | null) ?? null,
  };
}

export function projectCommitment(ctx: Ctx, scope: AccessScope, row: CommitmentRow, labels: Labels): Commitment | null {
  if (!canSee(scope, row.source_key)) return null;
  const person = personRef(ctx, scope, row.person_id);
  const organization = organizationRef(ctx, scope, row.organization_id);
  if (row.person_id && !person && !organization) return null;
  const opportunity = row.opportunity_id ? ctx.db.get<{ id: string; title: string; collection: string }>('SELECT id, title, collection FROM opportunities WHERE id = ?', row.opportunity_id) : undefined;
  const occurred = row.interaction_id ? ctx.db.get<{ occurred_at: string }>('SELECT occurred_at FROM interactions WHERE id = ?', row.interaction_id)?.occurred_at ?? null : null;
  const evidence = row.evidence_id ? ctx.db.get<{ status: string }>('SELECT status FROM evidence WHERE id = ?', row.evidence_id) : undefined;
  const link = row.task_link_id ? ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', row.task_link_id) : ctx.db.get<Record<string, unknown>>("SELECT * FROM task_links WHERE subject_kind = 'commitment' AND subject_id = ? ORDER BY created_at DESC LIMIT 1", row.id);
  const open = row.state === 'suggested' || row.state === 'accepted';
  const confirmation = !open ? '' : row.completion_evidence_id ? 'A later message may show this is done' : evidence && evidence.status !== 'available' ? 'The original message is no longer available' : row.origin === 'manual' ? 'Added by you' : 'No confirming message found in the indexed history';
  const hist = ctx.db.all<{ created_at: string; from_state: string | null; to_state: string; actor: string; note: string | null }>('SELECT created_at, from_state, to_state, actor, note FROM commitment_history WHERE commitment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20', row.id);
  return {
    id: row.id,
    revision: row.revision,
    direction: row.direction,
    person,
    organization,
    opportunity: opportunity && canSee(scope, opportunity.collection) ? { id: opportunity.id, name: opportunity.title } : null,
    actorLabel: row.direction === 'i_owe' ? 'You' : person?.name ?? organization?.name ?? row.actor_label,
    recipientLabel: row.direction === 'i_owe' ? person?.name ?? organization?.name ?? row.recipient_label : 'You',
    action: row.action,
    dueDate: row.due_date,
    state: row.state,
    origin: row.origin,
    snoozedUntil: row.snoozed_until,
    evidenceId: row.evidence_id,
    passage: evidence && evidence.status !== 'available' ? null : row.passage,
    sourceLabel: labels.of(row.source_key),
    occurredAt: occurred,
    completionEvidenceId: row.completion_evidence_id,
    resolution: row.resolution,
    previousDecision: row.previous_decision,
    confirmation,
    taskLink: link && canSee(scope, String(link.collection)) ? projectTaskLink(link) : null,
    history: hist.map((item) => ({ at: item.created_at, from: item.from_state, to: item.to_state, actor: item.actor === 'extraction' ? 'From a message' : item.actor.startsWith('owner-ui') ? 'You' : item.actor.startsWith('chat:') ? 'A chat' : 'You', note: item.note })),
    createdAt: row.created_at,
  };
}

export function commitmentsFor(ctx: Ctx, scope: AccessScope, column: 'person_id' | 'organization_id' | 'opportunity_id', id: string, labels: Labels, states: string[] = ['suggested', 'accepted']): Commitment[] {
  const filter = sourceFilter(scope, 'source_key');
  return ctx.db.all<CommitmentRow>(`SELECT * FROM commitments WHERE ${column} = ? AND state IN (${states.map(() => '?').join(',')}) AND ${filter.sql} ORDER BY state = 'accepted' DESC, COALESCE(due_date, '9999'), created_at DESC LIMIT 30`, id, ...states, ...filter.params)
    .map((row) => projectCommitment(ctx, scope, row, labels)).filter((item): item is Commitment => !!item);
}

// ─── Follow-ups list ─────────────────────────────────────────────────────────

const followCursor = z.object({ k: z.string(), id: z.string(), t: z.enum(['c', 't']) }).strict();
export type FollowUpItem = { kind: 'commitment'; commitment: Commitment } | { kind: 'task'; task: TaskLink; subject: { kind: string; id: string; name: string } | null };

/**
 * I owe: accepted commitments you owe and chosen Ri follow-ups. Waiting on:
 * accepted commitments others owe you. Suggestions: unreviewed inferred items,
 * labeled separately. Snoozed items stay out unless asked for.
 */
export function listFollowUps(ctx: Ctx, scope: AccessScope, input: { filter: 'i_owe' | 'waiting_on' | 'suggestions' | 'completed'; personId?: string; organizationId?: string; includeSnoozed?: boolean; cursor?: string; limit: number }, labels: Labels) {
  const today = ctx.now().toISOString().slice(0, 10);
  const cursor = decodeCursor(followCursor, input.cursor);
  const c = sourceFilter(scope, 'source_key');
  const where: string[] = [c.sql];
  const params: Param[] = [...c.params];
  if (input.filter === 'suggestions') where.push("state = 'suggested'");
  else if (input.filter === 'completed') where.push("state IN ('completed','dismissed','withdrawn')");
  else { where.push("state = 'accepted'"); where.push('direction = ?'); params.push(input.filter); }
  if (!input.includeSnoozed && input.filter !== 'completed') { where.push('(snoozed_until IS NULL OR snoozed_until <= ?)'); params.push(today); }
  if (input.personId) { where.push('person_id = ?'); params.push(input.personId); }
  if (input.organizationId) { where.push('organization_id = ?'); params.push(input.organizationId); }
  const sortKey = input.filter === 'completed' ? "updated_at" : "COALESCE(due_date, '9999') || created_at";
  const commitmentRows = ctx.db.all<CommitmentRow & { k: string }>(
    `SELECT *, ${sortKey} AS k FROM commitments WHERE ${where.join(' AND ')} ${cursor ? `AND (${sortKey}, id) > (?, ?)` : ''} ORDER BY k, id LIMIT ?`,
    ...params, ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1);
  type Entry = { k: string; id: string; t: 'c' | 't'; item: FollowUpItem | null };
  const entries: Entry[] = commitmentRows.map((row) => ({ k: row.k, id: row.id, t: 'c' as const, item: (() => { const commitment = projectCommitment(ctx, scope, row, labels); return commitment ? { kind: 'commitment' as const, commitment } : null; })() }));
  if (input.filter === 'i_owe') {
    const t = sourceFilter(scope, 'collection');
    const tw: string[] = [t.sql, "subject_kind != 'commitment'", "status IN ('pending','linked','unavailable','failed')", "(task_status IS NULL OR task_status NOT IN ('done','completed','archived'))"];
    const tp: Param[] = [...t.params];
    if (input.personId) { tw.push("subject_kind = 'person' AND subject_id = ?"); tp.push(input.personId); }
    if (input.organizationId) { tw.push("subject_kind = 'organization' AND subject_id = ?"); tp.push(input.organizationId); }
    const taskKey = "COALESCE(substr(due_at, 1, 10), '9999') || created_at";
    for (const row of ctx.db.all<Record<string, unknown> & { k: string }>(`SELECT *, ${taskKey} AS k FROM task_links WHERE ${tw.join(' AND ')} ${cursor ? `AND (${taskKey}, id) > (?, ?)` : ''} ORDER BY k, id LIMIT ?`, ...tp, ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1)) {
      const subjectKind = String(row.subject_kind), subjectId = String(row.subject_id);
      const subject = subjectKind === 'person' ? personRef(ctx, scope, subjectId) : subjectKind === 'organization' ? organizationRef(ctx, scope, subjectId) : (() => {
        const opp = ctx.db.get<{ id: string; title: string; collection: string }>('SELECT id, title, collection FROM opportunities WHERE id = ?', subjectId);
        return opp && canSee(scope, opp.collection) ? { id: opp.id, name: opp.title } : null;
      })();
      entries.push({ k: row.k, id: String(row.id), t: 't', item: { kind: 'task', task: projectTaskLink(row), subject: subject ? { kind: subjectKind, ...subject } : null } });
    }
  }
  entries.sort((a, b) => a.k.localeCompare(b.k) || a.id.localeCompare(b.id));
  const page = entries.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((entry) => entry.item).filter((item): item is FollowUpItem => !!item),
    nextCursor: entries.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id, t: last.t }) : null,
  };
}

export { assertWritable };
