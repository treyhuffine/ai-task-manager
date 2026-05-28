import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  snakeToCamel, camelToSnake,
  camelizeKeys, snakeizeKeys,
  type CamelizeKeys, type SnakeizeKeys,
  type SnakeToCamel, type CamelToSnake,
} from './keys';

describe('snakeToCamel / camelToSnake (string)', () => {
  it('round-trips simple identifiers', () => {
    expect(snakeToCamel('file_name')).toBe('fileName');
    expect(snakeToCamel('created_at')).toBe('createdAt');
    expect(snakeToCamel('external_tool_call_id')).toBe('externalToolCallId');
    expect(camelToSnake('fileName')).toBe('file_name');
    expect(camelToSnake('externalToolCallId')).toBe('external_tool_call_id');
  });

  it('passes single-segment identifiers through', () => {
    expect(snakeToCamel('id')).toBe('id');
    expect(camelToSnake('id')).toBe('id');
    expect(snakeToCamel('size')).toBe('size');
  });

  it('handles digits without splitting', () => {
    expect(snakeToCamel('field_2')).toBe('field_2');
    expect(camelToSnake('field2')).toBe('field2');
  });

  it('produces the expected literal types', () => {
    expectTypeOf<SnakeToCamel<'file_name'>>().toEqualTypeOf<'fileName'>();
    expectTypeOf<SnakeToCamel<'external_tool_call_id'>>().toEqualTypeOf<'externalToolCallId'>();
    expectTypeOf<CamelToSnake<'fileName'>>().toEqualTypeOf<'file_name'>();
    expectTypeOf<CamelToSnake<'externalToolCallId'>>().toEqualTypeOf<'external_tool_call_id'>();
  });
});

describe('camelizeKeys / snakeizeKeys (object)', () => {
  it('flips top-level keys', () => {
    expect(camelizeKeys({ file_name: 'a.png', mime_type: 'image/png' }))
      .toEqual({ fileName: 'a.png', mimeType: 'image/png' });
    expect(snakeizeKeys({ fileName: 'a.png', mimeType: 'image/png' }))
      .toEqual({ file_name: 'a.png', mime_type: 'image/png' });
  });

  it('recurses into nested objects', () => {
    expect(camelizeKeys({ outer_key: { inner_key: 1 } }))
      .toEqual({ outerKey: { innerKey: 1 } });
  });

  it('recurses into arrays', () => {
    expect(camelizeKeys([{ file_name: 'a' }, { file_name: 'b' }]))
      .toEqual([{ fileName: 'a' }, { fileName: 'b' }]);
  });

  it('passes primitives, null, undefined through', () => {
    expect(camelizeKeys(null)).toBe(null);
    expect(camelizeKeys(undefined)).toBe(undefined);
    expect(camelizeKeys('a_b')).toBe('a_b');
    expect(camelizeKeys(42)).toBe(42);
  });

  it('does not recurse into Date or other class instances', () => {
    const d = new Date(0);
    expect(camelizeKeys({ created_at: d })).toEqual({ createdAt: d });
  });

  it('is a lossless round-trip on Attachment-shaped data', () => {
    const stored = {
      file_name: '01HXY.png',
      original_name: 'Screenshot 2026-04-21.png',
      mime_type: 'image/png',
      size: 12345,
      uploaded_at: '2026-04-21T00:00:00.000Z',
    };
    const round = snakeizeKeys(camelizeKeys(stored));
    expect(round).toEqual(stored);
  });

  it('produces the expected mapped types', () => {
    type Stored = { file_name: string; mime_type: string; nested: { uploaded_at: string } };
    type Camel = { fileName: string; mimeType: string; nested: { uploadedAt: string } };
    expectTypeOf<CamelizeKeys<Stored>>().toEqualTypeOf<Camel>();
    expectTypeOf<SnakeizeKeys<Camel>>().toEqualTypeOf<Stored>();
    expectTypeOf<CamelizeKeys<Stored[]>>().toEqualTypeOf<Camel[]>();
  });
});
