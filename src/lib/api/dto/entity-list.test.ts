import { describe, expect, it } from 'vitest';
import {
  LIST_BODY_EXCERPT_CHARS,
  toNoteListDTO,
  toTaskListDTO,
  toTaskListDTOs,
} from './entity-list';
import type { NoteRecord, TaskListRecord } from '@/db/types';

function task(body: string | null): TaskListRecord {
  return { id: 't1', title: 'Fix the thing', body, subtaskCount: 0 } as TaskListRecord;
}

function note(body: string, title: string | null = null): NoteRecord {
  return { id: 'n1', title, body } as NoteRecord;
}

describe('list body excerpting', () => {
  it('caps the body and reports the true length', () => {
    const long = 'x'.repeat(5000);
    const dto = toTaskListDTO(task(long));
    expect(dto.bodyExcerpt).toHaveLength(LIST_BODY_EXCERPT_CHARS);
    expect(dto.bodyLen).toBe(5000);
    expect('body' in dto).toBe(false);
  });

  it('distinguishes empty from truncated', () => {
    // The task row shows its "has notes" icon off bodyLen, so an empty body
    // and a long one must not look the same.
    expect(toTaskListDTO(task(null)).bodyLen).toBe(0);
    expect(toTaskListDTO(task(null)).bodyExcerpt).toBeNull();
    expect(toTaskListDTO(task('')).bodyExcerpt).toBeNull();
    expect(toTaskListDTO(task('short')).bodyExcerpt).toBe('short');
    expect(toTaskListDTO(task('short')).bodyLen).toBe(5);
  });

  it('leaves a note title derivation byte-identical', () => {
    // note-row derives an untitled note's display title as
    // stripMarkdown(body.split('\n')[0]).slice(0, 80). The final clamp is 80
    // characters, well inside the excerpt, so the rendered title cannot
    // change no matter how long the body is.
    const first = 'A'.repeat(500);
    const full = `${first}\nsecond line`;
    const dto = toNoteListDTO(note(full));
    expect((dto.bodyExcerpt ?? '').split('\n')[0].slice(0, 80)).toBe(
      full.split('\n')[0].slice(0, 80),
    );
  });

  it('keeps the note preview non-empty when there is content past line one', () => {
    const dto = toNoteListDTO(note('title line\nbody line one\nbody line two'));
    const preview = (dto.bodyExcerpt ?? '').split('\n').slice(1).join('\n');
    expect(preview).toBe('body line one\nbody line two');
  });

  it('preserves the fields the deck reads from list rows', () => {
    // Recorded trap: deck card rationale reads description/outcome/effort
    // off list rows, so slimming must not touch them.
    const row = {
      ...task('x'),
      description: 'why',
      outcome: 'what good looks like',
      effort: 'medium',
    } as TaskListRecord;
    const dto = toTaskListDTO(row);
    expect(dto.description).toBe('why');
    expect(dto.outcome).toBe('what good looks like');
    expect(dto.effort).toBe('medium');
  });

  it('preserves every field other than body', () => {
    const row = task('some body');
    const dto = toTaskListDTO(row);
    for (const key of Object.keys(row) as (keyof TaskListRecord)[]) {
      if (key === 'body') continue;
      expect(dto[key as keyof typeof dto]).toEqual(row[key]);
    }
  });

  it('maps lists', () => {
    expect(toTaskListDTOs([task('a'), task(null)]).map((d) => d.bodyLen)).toEqual([1, 0]);
  });

  it('never lets an excerpt exceed the cap', () => {
    for (const len of [0, 1, 299, 300, 301, 10_000]) {
      const dto = toTaskListDTO(task('y'.repeat(len)));
      expect((dto.bodyExcerpt ?? '').length).toBeLessThanOrEqual(LIST_BODY_EXCERPT_CHARS);
      expect(dto.bodyLen).toBe(len);
    }
  });
});
