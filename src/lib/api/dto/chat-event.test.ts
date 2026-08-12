import { describe, expect, it } from 'vitest';
import { decodeBackgroundTaskEvent } from '@/lib/executor/background-task-event';
import { toChatEventDTO, toChatEventDTOs } from './chat-event';
import type { ChatEventRecord } from '@/db/types';

/** A chat_events row with only the fields this projection touches. */
function row(over: Partial<ChatEventRecord> = {}): ChatEventRecord {
  return {
    id: '019f-aaa',
    sessionId: 's1',
    role: 'assistant',
    source: 'agent',
    content: 'hello',
    raw: null,
    ...over,
  } as ChatEventRecord;
}

describe('toChatEventDTO', () => {
  it('drops raw on ordinary rows', () => {
    // The bulk of the table: assistant text, tool calls, thinking. Nothing
    // reads their raw, and it is ~97% of all raw bytes.
    const dto = toChatEventDTO(row({ source: 'agent', raw: { type: 'message', big: 'x'.repeat(5000) } }));
    expect(dto.raw).toBeNull();
    expect(dto.content).toBe('hello');
  });

  it('lifts subtype, model and usage into scalars', () => {
    const dto = toChatEventDTO(row({
      source: 'system',
      raw: { type: 'system', subtype: 'init', model: 'claude-opus-5', bulk: 'x'.repeat(9000) },
    }));
    expect(dto.rawSubtype).toBe('init');
    expect(dto.rawModel).toBe('claude-opus-5');
    // The 9KB payload those two strings were extracted from is gone.
    expect(dto.raw).toBeNull();

    const result = toChatEventDTO(row({
      source: 'result',
      raw: { type: 'result', usage: { input_tokens: 120, output_tokens: 8 } },
    }));
    expect(result.rawUsage).toEqual({ input_tokens: 120, output_tokens: 8 });
  });

  it('keeps raw on rows the background-task decoder can read', () => {
    const bg = row({
      source: 'background_task',
      raw: { type: 'background_task', phase: 'started', taskId: 't1', taskType: 'search' },
    });
    const dto = toChatEventDTO(bg);
    expect(dto.raw).not.toBeNull();
    // The whole point: it still decodes downstream.
    expect(decodeBackgroundTaskEvent(dto.raw)).not.toBeNull();
  });

  it('keeps raw on the legacy Claude unknown envelope', () => {
    // Agentex <=0.0.32 surfaced task lifecycle as `unknown` + providerType
    // claude. Stored transcripts still contain these.
    const legacy = row({
      source: 'system',
      raw: {
        type: 'unknown', providerType: 'claude',
        raw: { type: 'system', subtype: 'task_started', task_id: 't9' },
      },
    });
    const dto = toChatEventDTO(legacy);
    const decodedBefore = decodeBackgroundTaskEvent(legacy.raw);
    if (decodedBefore) {
      expect(dto.raw).not.toBeNull();
      expect(decodeBackgroundTaskEvent(dto.raw)).toEqual(decodedBefore);
    }
  });

  it('is behaviour-preserving for the decoder on every row', () => {
    // The projection keeps raw exactly when the decoder can use it, so
    // decoding the DTO must always equal decoding the original. This is the
    // property the whole design rests on.
    const rows = [
      row({ raw: null }),
      row({ raw: { type: 'message' } }),
      row({ raw: { type: 'unknown', providerType: 'codex' } }),
      row({ raw: { type: 'unknown', providerType: 'claude', raw: { subtype: 'nope' } } }),
      row({ raw: { type: 'background_task', phase: 'progress', taskId: 't2' } }),
      row({ raw: { type: 'background_task', phase: 'bogus', taskId: 't3' } }),
    ];
    for (const r of rows) {
      expect(decodeBackgroundTaskEvent(toChatEventDTO(r).raw)).toEqual(
        decodeBackgroundTaskEvent(r.raw),
      );
    }
  });

  it('tolerates a null or non-object raw', () => {
    for (const raw of [null, undefined, 'a string', 42, ['a']] as unknown[]) {
      const dto = toChatEventDTO(row({ raw } as Partial<ChatEventRecord>));
      expect(dto.rawSubtype).toBeNull();
      expect(dto.rawModel).toBeNull();
      expect(dto.rawUsage).toBeNull();
    }
  });

  it('preserves every other field untouched', () => {
    const original = row({
      content: 'body text',
      toolName: 'Bash',
      raw: { type: 'message', junk: 'x'.repeat(3000) },
    } as Partial<ChatEventRecord>);
    const dto = toChatEventDTO(original);
    for (const key of Object.keys(original) as (keyof ChatEventRecord)[]) {
      if (key === 'raw') continue;
      expect(dto[key as keyof typeof dto]).toEqual(original[key]);
    }
  });

  it('maps a list', () => {
    expect(toChatEventDTOs([row(), row({ id: 'b' })]).map((d) => d.id)).toEqual(['019f-aaa', 'b']);
  });
});
