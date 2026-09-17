import type { NoteRecord, TaskRecord } from '@/db/types';
import type { BriefEntityType } from './types';

/**
 * Prompt for the one-shot brief call. Deliberately narrow: the model gets the
 * document and a little metadata, and returns a small JSON object. It is told
 * not to restate live properties (status, deadline) because the UI renders
 * those from the record, and not to invent open threads that the text does
 * not contain.
 */

/** Longer bodies are clipped head + tail so the call stays bounded. */
export const BRIEF_BODY_CHAR_CAP = 60_000;

export const BRIEF_SYSTEM_PROMPT = `You brief the owner of a personal note or task so they do not have to re-read it.

The person wrote (or dictated) this document themselves over time. Your job is to hand it back to them compressed: what it is, what in it matters right now, what is still unresolved, and what you could do to it next.

Rules:
- Use their words and names for things. Do not rename concepts or add jargon.
- Only list something as open if the text itself leaves it unresolved (an unanswered question, an unchecked item that still matters, a decision not yet made). Never invent.
- Points are the few things worth knowing, most important first. Skip anything obvious from the title.
- Suggestions are commands the person could give you to change or extend THIS document. Make them specific to its contents, not generic. Prefer actions that reorganize, extract, resolve, or draft.
- Do not restate the status, deadline, or dates that the app already shows.
- Plain text in every field. No markdown, no bullets inside strings, no quotes around strings.
- Be brief. A brief that is long is not a brief.`;

function clipBody(body: string): string {
  if (body.length <= BRIEF_BODY_CHAR_CAP) return body;
  const head = Math.floor(BRIEF_BODY_CHAR_CAP * 0.7);
  const tail = BRIEF_BODY_CHAR_CAP - head;
  return `${body.slice(0, head)}\n\n[... ${body.length - BRIEF_BODY_CHAR_CAP} characters omitted ...]\n\n${body.slice(-tail)}`;
}

function taskMeta(task: TaskRecord): string {
  const lines: string[] = [];
  if (task.description) lines.push(`Description: ${task.description}`);
  if (task.outcome) lines.push(`Outcome (definition of done): ${task.outcome}`);
  if (task.userContext) lines.push(`Context from the user: ${task.userContext}`);
  if (task.parentId) lines.push('This is a subtask of a larger task.');
  return lines.join('\n');
}

export function renderBriefPrompt(
  entityType: BriefEntityType,
  entity: TaskRecord | NoteRecord,
): string {
  const title = (entity.title ?? '').trim() || '(untitled)';
  const body = clipBody((entity.body ?? '').trim());
  const meta = entityType === 'task' ? taskMeta(entity as TaskRecord) : '';

  return [
    `Brief this ${entityType}.`,
    '',
    `Title: ${title}`,
    meta,
    '',
    `<${entityType}_body>`,
    body || '(empty)',
    `</${entityType}_body>`,
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}
