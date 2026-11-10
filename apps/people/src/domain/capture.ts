import { AppError } from '@ri/app-kit/contract';
import type { AccessScope } from '@ri/app-kit/data';
import type { Ctx } from './context.js';
import { saveNote } from './notes.js';
import { createManualPerson, getPersonRow, resolvePersonId, savePerson, searchPeople, summarizePeople } from './people.js';
import { saveRelation, type PersonalInput } from './personal.js';
import { personVisible } from './projection.js';
import { canSee } from './scope.js';
import { cleanName, cleanText, sortKey } from './text.js';
import type { PersonSummary, RelationKind } from '../schemas.js';

/**
 * Capture from chat: the user tells their agent something about a person
 * ("met Sarah at dinner, she's raising a seed round") and it lands on that
 * person as a note in the user's exact words, with where it came from. The
 * agent may also pass details the user stated outright (where they live, a
 * birthday, how they met, a relationship). A name that could mean several
 * people, or nobody, writes nothing and returns the candidates, so the agent
 * asks instead of guessing.
 */

export const CAPTURE_TEXT_MAX = 4000;

export interface CaptureInput {
  personId?: string;
  name?: string;
  text: string;
  details?: PersonalInput & { headline?: string | null };
  relation?: { kind: RelationKind; relatedPersonId?: string | null; relatedName?: string | null; note?: string | null };
  createIfMissing?: boolean;
  sourceLabel?: string | null;
}
export type CaptureResult =
  | { status: 'saved'; person: PersonSummary; noteId: string; created: boolean; applied: string[]; skipped: string[] }
  | { status: 'ambiguous'; candidates: PersonSummary[]; message: string }
  | { status: 'not_found'; message: string };

type Match = { kind: 'one'; id: string } | { kind: 'many'; ids: string[] } | { kind: 'none' };

/**
 * Who a name means among the people this reader may see. An exact name wins.
 * Otherwise every word must start a part of the name ("Sarah" or "Sarah C"
 * for Sarah Chen). Search text such as a company or a note never matches.
 */
export function matchName(ctx: Ctx, scope: AccessScope, name: string): Match {
  const key = sortKey(cleanName(name) ?? '');
  if (!key) return { kind: 'none' };
  const words = key.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const found = searchPeople(ctx, scope, { text: name, limit: 25 }).items;
  const exact = found.filter((person) => sortKey(person.name) === key);
  if (exact.length === 1) return { kind: 'one', id: exact[0]!.id };
  if (exact.length > 1) return { kind: 'many', ids: exact.map((person) => person.id) };
  const prefix = found.filter((person) => {
    const parts = sortKey(person.name).split(/[^\p{L}\p{N}]+/u);
    return words.every((word) => parts.some((part) => part.startsWith(word)));
  });
  if (prefix.length === 1) return { kind: 'one', id: prefix[0]!.id };
  if (prefix.length > 1) return { kind: 'many', ids: prefix.map((person) => person.id) };
  return { kind: 'none' };
}

export function capture(ctx: Ctx, scope: AccessScope, input: CaptureInput): CaptureResult {
  const text = cleanText(input.text, CAPTURE_TEXT_MAX);
  if (!text) throw new AppError('invalid_input', 'Include what the user said');
  if (!input.personId && !input.name) throw new AppError('invalid_input', 'Name the person, or pass their ID');
  let personId: string, created = false;
  if (input.personId) {
    personId = resolvePersonId(ctx, input.personId);
    const row = getPersonRow(ctx, personId);
    if (!row || row.merged_into || !personVisible(ctx, scope, personId)) throw new AppError('not_found', 'This person is not available to this chat');
  } else {
    const match = matchName(ctx, scope, input.name!);
    if (match.kind === 'many') {
      return { status: 'ambiguous', candidates: summarizePeople(ctx, scope, match.ids.slice(0, 5)), message: `More than one person matches "${cleanName(input.name)}". Ask which one, then capture again with their ID. Nothing was saved` };
    }
    if (match.kind === 'none') {
      if (!input.createIfMissing) return { status: 'not_found', message: `Nobody named "${cleanName(input.name)}" is in People. Ask whether to add them, then capture again with createIfMissing. Nothing was saved` };
      personId = createManualPerson(ctx, scope, { name: input.name! });
      created = true;
    } else personId = match.id;
  }
  const person = getPersonRow(ctx, personId)!;
  // The note stays with the person when the caller may write the person's collection, else in the caller's own collection.
  const own = scope.kind === 'owner' || (scope.operations.has('write') && scope.sources.has(person.collection));
  const label = cleanName(input.sourceLabel ?? null, 200) ?? 'Ri chat';
  const note = saveNote(ctx, scope, { subjectKind: 'person', subjectId: personId, title: null, body: text, ...(own ? { collection: person.collection } : {}), origin: { kind: 'chat', label } });
  const applied: string[] = ['note'], skipped: string[] = [];
  const details = input.details ?? {};
  const fields = (Object.keys(details) as (keyof typeof details)[]).filter((key) => details[key] !== undefined);
  if (fields.length) {
    if (own && canSee(scope, person.collection)) {
      const current = getPersonRow(ctx, personId)!;
      savePerson(ctx, scope, { id: personId, expectedRevision: current.revision, ...details });
      applied.push(...fields);
    } else skipped.push(...fields);
  }
  if (input.relation) {
    saveRelation(ctx, scope, { personId, kind: input.relation.kind, relatedPersonId: input.relation.relatedPersonId, relatedName: input.relation.relatedName, note: input.relation.note });
    applied.push('relation');
  }
  return { status: 'saved', person: summarizePeople(ctx, scope, [personId])[0]!, noteId: note.id, created, applied, skipped };
}
