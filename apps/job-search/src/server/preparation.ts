/**
 * Interview preparation. Requirements quote the posting snapshot they came
 * from, examples, questions and notes are the user's own words saved with
 * revisions, and AI suggestions live in their own list with their evidence.
 * Without AI the workspace is complete for manual preparation.
 */
import { AppError } from '@ri/app-kit/contract';
import { allows, allowsAll, newId, transaction, type AccessScope } from '@ri/app-kit/data';
import { MANUAL_SOURCE, MATERIALS_SOURCE, type Preparation, type Suggestion } from '../domain/model.js';
import { boundedSources, buildPreparationPrompt, validatePreparationReply, type PrepSource } from '../domain/prep-ai.js';
import { app, bumpRevision, nowAt } from './state.js';
import { requireOpportunityRow } from './opportunities.js';
import { latestSnapshot, snapshotExtract, snapshotText } from './postings.js';
import { versionText } from './materials.js';
import { json, num, opt, str, type Row } from './util.js';

type State = Preparation['suggestionsState'];
const EMPTY_STATE: State = { status: 'none', at: null, message: null, rejected: 0 };

/**
 * One source handed to the model for a suggestion run, with the revision it had then. A run's
 * output may draw on anything in its prompt, whatever it chose to cite, so a reader sees that
 * run's suggestions only when they may see every source supplied to it.
 */
export interface SuppliedSource {
  key: string;
  kind: 'opportunity' | 'interview' | PrepSource['source'];
  ref: string;
  revision: string;
}
/** Suggestions and run state as stored. `supplied` never leaves the server. */
type StoredSuggestion = Suggestion & { supplied?: SuppliedSource[] };
type StoredState = State & { supplied?: SuppliedSource[] };
type SourceWithRevision = PrepSource & { revision: string };

/** Model output never decides access. A run without a record of what it was given is the owner's alone. */
function runVisible(scope: AccessScope, supplied: SuppliedSource[] | undefined): boolean {
  if (scope.kind === 'owner') return true;
  return !!supplied?.length && allowsAll(scope, supplied.map((source) => source.key));
}
export function suggestionVisible(scope: AccessScope, suggestion: StoredSuggestion): boolean {
  return runVisible(scope, suggestion.supplied);
}
const publicSuggestion = ({ id, kind, text, evidence, status }: StoredSuggestion): Suggestion => ({ id, kind, text, evidence, status });

export function preparationRow(where: { id?: string; interviewId?: string | null; opportunityId?: string }): Row | undefined {
  const db = app().db;
  if (where.id) return db.prepare('SELECT * FROM preparations WHERE id = ?').get(where.id);
  if (where.interviewId) return db.prepare('SELECT * FROM preparations WHERE interview_id = ?').get(where.interviewId);
  if (where.opportunityId) return db.prepare('SELECT * FROM preparations WHERE opportunity_id = ? AND interview_id IS NULL ORDER BY updated_at DESC LIMIT 1').get(where.opportunityId);
  return undefined;
}

function postingRequirements(snapshot: Row | undefined): Preparation['requirements'] {
  if (!snapshot) return [];
  return snapshotExtract(snapshot).requirements.map((requirement) => ({ ...requirement, origin: 'posting' as const, snapshotId: str(snapshot.id) }));
}

/** The preparation for an interview or a role, or a fresh unsaved one sourced from the latest posting snapshot. */
export function readPreparation(scope: AccessScope, where: { interviewId?: string | null; opportunityId: string }): Preparation {
  if (!allows(scope, MANUAL_SOURCE)) throw new AppError('forbidden', 'This caller was not given your saved jobs and preparation');
  requireOpportunityRow(where.opportunityId);
  if (where.interviewId) {
    const interview = app().db.prepare('SELECT opportunity_id, source_key FROM interviews WHERE id = ?').get(where.interviewId);
    if (!interview || str(interview.opportunity_id) !== where.opportunityId || !allows(scope, str(interview.source_key))) throw new AppError('not_found', 'This interview is not available');
  }
  const row = where.interviewId ? preparationRow({ interviewId: where.interviewId }) : preparationRow({ opportunityId: where.opportunityId });
  const latest = latestSnapshot(where.opportunityId);
  if (!row) {
    return {
      id: null, revision: 0, opportunityId: where.opportunityId, interviewId: where.interviewId ?? null, postingSnapshotId: latest ? str(latest.id) : null, newerSnapshotId: null,
      requirements: postingRequirements(latest), examples: [], questions: [], notes: '', suggestions: [], suggestionsState: EMPTY_STATE, revisions: [], updatedAt: null,
    };
  }
  return preparationRecord(row, scope);
}

export function preparationRecord(row: Row, scope: AccessScope): Preparation {
  const latest = latestSnapshot(str(row.opportunity_id));
  const snapshotId = opt(row.posting_snapshot_id);
  const suggestions = json<StoredSuggestion[]>(row.suggestions, []).filter((suggestion) => suggestionVisible(scope, suggestion)).map(publicSuggestion);
  const storedState = json<StoredState>(row.suggestions_state, EMPTY_STATE);
  const { supplied: _supplied, ...state } = storedState;
  const suggestionsState = state.status !== 'none' && runVisible(scope, storedState.supplied) ? state : EMPTY_STATE;
  return {
    id: str(row.id),
    revision: num(row.revision),
    opportunityId: str(row.opportunity_id),
    interviewId: opt(row.interview_id),
    postingSnapshotId: snapshotId,
    newerSnapshotId: latest && str(latest.id) !== snapshotId ? str(latest.id) : null,
    requirements: json(row.requirements, []),
    examples: json(row.examples, []),
    questions: json(row.questions, []),
    notes: str(row.notes),
    suggestions,
    suggestionsState,
    revisions: app().db.prepare('SELECT revision, created_at, author FROM preparation_revisions WHERE preparation_id = ? ORDER BY revision DESC LIMIT 20').all(str(row.id))
      .map((item) => ({ revision: num(item.revision), at: str(item.created_at), author: str(item.author) })),
    updatedAt: str(row.updated_at),
  };
}

export interface SaveInput {
  preparationId?: string | null;
  opportunityId: string;
  interviewId?: string | null;
  expectedRevision: number;
  postingSnapshotId?: string | null;
  requirements: Preparation['requirements'];
  examples: Preparation['examples'];
  questions: Preparation['questions'];
  notes: string;
  suggestionDecisions?: { id: string; status: 'accepted' | 'dismissed' | 'proposed' }[];
}

export function savePreparation(input: SaveInput, author: string, scope: AccessScope): { status: 'saved'; row: Row } | { status: 'conflict'; row: Row | undefined } {
  const { db } = app();
  return transaction(db, () => {
    requireOpportunityRow(input.opportunityId);
    if (input.interviewId) {
      const interview = db.prepare('SELECT opportunity_id FROM interviews WHERE id = ?').get(input.interviewId);
      if (!interview || str(interview.opportunity_id) !== input.opportunityId) throw new AppError('invalid_input', 'This interview belongs to another opportunity');
    }
    if (input.postingSnapshotId && !db.prepare('SELECT 1 FROM posting_snapshots WHERE id = ? AND opportunity_id = ?').get(input.postingSnapshotId, input.opportunityId))
      throw new AppError('invalid_input', 'That posting snapshot belongs to another opportunity');
    const existing = input.preparationId ? preparationRow({ id: input.preparationId }) : input.interviewId ? preparationRow({ interviewId: input.interviewId }) : preparationRow({ opportunityId: input.opportunityId });
    const time = nowAt();
    const content = { requirements: input.requirements, examples: input.examples, questions: input.questions, notes: input.notes, postingSnapshotId: input.postingSnapshotId ?? null };
    let id: string, revision: number;
    if (!existing) {
      if (input.expectedRevision !== 0) return { status: 'conflict', row: undefined };
      id = newId();
      revision = 1;
      db.prepare(`INSERT INTO preparations (id, created_at, updated_at, revision, opportunity_id, interview_id, posting_snapshot_id, requirements, examples, questions, notes, suggestions, suggestions_state, author)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`).run(id, time, time, input.opportunityId, input.interviewId ?? null, input.postingSnapshotId ?? null, JSON.stringify(input.requirements),
        JSON.stringify(input.examples), JSON.stringify(input.questions), input.notes, JSON.stringify(EMPTY_STATE), author);
    } else {
      if (num(existing.revision) !== input.expectedRevision) return { status: 'conflict', row: existing };
      id = str(existing.id);
      revision = num(existing.revision) + 1;
      // A caller decides only the suggestions it can see.
      const decisions = new Map((input.suggestionDecisions ?? []).map((decision) => [decision.id, decision.status]));
      const suggestions = json<StoredSuggestion[]>(existing.suggestions, []).map((suggestion) => (decisions.has(suggestion.id) && suggestionVisible(scope, suggestion) ? { ...suggestion, status: decisions.get(suggestion.id)! } : suggestion));
      db.prepare('UPDATE preparations SET revision = ?, updated_at = ?, posting_snapshot_id = ?, requirements = ?, examples = ?, questions = ?, notes = ?, suggestions = ?, author = ? WHERE id = ?').run(
        revision, time, input.postingSnapshotId ?? null, JSON.stringify(input.requirements), JSON.stringify(input.examples), JSON.stringify(input.questions), input.notes, JSON.stringify(suggestions), author, id,
      );
    }
    db.prepare('INSERT INTO preparation_revisions (id, created_at, updated_at, preparation_id, revision, content, author) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), time, time, id, revision, JSON.stringify(content), author);
    bumpRevision();
    return { status: 'saved', row: db.prepare('SELECT * FROM preparations WHERE id = ?').get(id)! };
  });
}

/** The evidence a suggestion run may use, limited to what this caller's scope allows. */
export function preparationSources(row: Row, scope: AccessScope): SourceWithRevision[] {
  const db = app().db;
  const sources: SourceWithRevision[] = [];
  const snapshotId = opt(row.posting_snapshot_id);
  const snapshot = snapshotId ? db.prepare('SELECT * FROM posting_snapshots WHERE id = ?').get(snapshotId) : latestSnapshot(str(row.opportunity_id));
  if (snapshot && allows(scope, MANUAL_SOURCE)) {
    const text = snapshotText(snapshot);
    if (text) sources.push({ source: 'posting', ref: str(snapshot.id), label: `Saved posting, captured ${str(snapshot.captured_at).slice(0, 10)}`, text, sourceKey: MANUAL_SOURCE, revision: str(snapshot.content_digest) });
  }
  const examples = json<Preparation['examples']>(row.examples, []);
  if (examples.length && allows(scope, MANUAL_SOURCE)) sources.push({ source: 'example', ref: str(row.id), label: 'Your examples', text: examples.map((example) => `- ${example.text}`).join('\n'), sourceKey: MANUAL_SOURCE, revision: String(num(row.revision)) });
  if (allows(scope, MATERIALS_SOURCE)) {
    const versions = db.prepare(`SELECT DISTINCT v.* FROM submissions s JOIN submission_materials sm ON sm.submission_id = s.id JOIN material_versions v ON v.id = sm.version_id
      WHERE s.opportunity_id = ? ORDER BY s.applied_on DESC LIMIT 3`).all(str(row.opportunity_id));
    for (const version of versions) {
      const text = versionText(version);
      if (text) sources.push({ source: 'material', ref: str(version.id), label: `${str(version.title)} v${num(version.number)}, as submitted`, text, sourceKey: MATERIALS_SOURCE, revision: str(version.content_digest) });
    }
  }
  const messages = db.prepare("SELECT * FROM correspondence WHERE opportunity_id = ? AND match_status = 'matched' AND unavailable_at IS NULL ORDER BY received_at DESC LIMIT 4").all(str(row.opportunity_id));
  for (const message of messages) {
    if (!allows(scope, str(message.source_key))) continue;
    sources.push({ source: 'correspondence', ref: str(message.id), label: `Email “${str(message.subject).slice(0, 80)}”, ${str(message.received_at).slice(0, 10)}`, text: str(message.evidence), sourceKey: str(message.source_key), revision: `${num(message.revision)}:${str(message.payload_digest)}` });
  }
  return sources;
}

export function suggestionPrompt(row: Row, scope: AccessScope) {
  const opportunity = requireOpportunityRow(str(row.opportunity_id));
  const interviewRow = opt(row.interview_id) ? app().db.prepare('SELECT id, title, source_key, revision FROM interviews WHERE id = ?').get(str(row.interview_id)) : undefined;
  // The interview's title goes into the prompt only when this caller may see the interview.
  const interview = interviewRow && allows(scope, str(interviewRow.source_key)) ? interviewRow : undefined;
  const sources = boundedSources(preparationSources(row, scope));
  // Everything the prompt contains, cited or not: the role's company and title, the interview, and each source block.
  const supplied: SuppliedSource[] = [
    { key: MANUAL_SOURCE, kind: 'opportunity', ref: str(opportunity.id), revision: String(num(opportunity.revision)) },
    ...(interview ? [{ key: str(interview.source_key), kind: 'interview' as const, ref: str(interview.id), revision: String(num(interview.revision)) }] : []),
    ...sources.map((source) => ({ key: source.sourceKey, kind: source.source, ref: source.ref, revision: source.revision })),
  ];
  return { sources, supplied, prompt: buildPreparationPrompt({ company: str(opportunity.company), role: str(opportunity.role), interview: opt(interview?.title), sources }), company: str(opportunity.company), role: str(opportunity.role) };
}

/** Store one run's outcome. Each new suggestion and the run state record every source the run was given. */
export function storeSuggestions(preparationId: string, outcome: { suggestions?: Suggestion[]; state: State }, supplied: SuppliedSource[]) {
  const { db } = app();
  return transaction(db, () => {
    const row = preparationRow({ id: preparationId });
    if (!row) throw new AppError('not_found', 'This preparation is not available');
    const stored = json<StoredSuggestion[]>(row.suggestions, []);
    const kept = stored.filter((suggestion) => suggestion.status !== 'proposed');
    const fresh: StoredSuggestion[] = (outcome.suggestions ?? []).filter((suggestion) => !kept.some((item) => item.id === suggestion.id)).map((suggestion) => ({ ...publicSuggestion(suggestion), supplied }));
    const next = outcome.suggestions ? [...kept, ...fresh].slice(0, 30) : stored;
    const state: StoredState = { ...outcome.state, supplied };
    db.prepare('UPDATE preparations SET suggestions = ?, suggestions_state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), JSON.stringify(state), nowAt(), preparationId);
    bumpRevision();
    return db.prepare('SELECT * FROM preparations WHERE id = ?').get(preparationId)!;
  });
}

export { validatePreparationReply };
