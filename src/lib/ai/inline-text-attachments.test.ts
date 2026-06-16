import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { UIMessage } from 'ai';
import { APP_SHORT_ID } from '@/constants/app';

// Integration test for the orchestrator chat's attachment rewriter.
// Covers the cases that matter for "what does the model actually see":
//   1. Text/code/json file → inlined as <attachment> tag
//   2. SVG file → inlined as XML source (NOT base64)
//   3. Image (PNG) → base64 data URL on the file part
//   4. Missing file on disk → dropped with warning
//   5. Audio with no STT → dropped (would never reach Anthropic readable)
//
// The image-normalize path (HEIC + downscale) is exercised separately;
// here we only verify a normal PNG round-trips intact.

function buildMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'test-msg',
    role: 'user',
    parts,
  };
}

describe('inlineTextAttachments', () => {
  let tmpDir: string;
  let attachmentsDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-inline-'));
    attachmentsDir = path.join(tmpDir, 'attachments');
    fs.mkdirSync(attachmentsDir, { recursive: true });
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeAttachment(name: string, data: string | Buffer): string {
    fs.writeFileSync(path.join(attachmentsDir, name), data);
    return `/api/attachments/${name}`;
  }

  it('inlines text file parts as <attachment> tags', async () => {
    const url = writeAttachment('note.txt', 'hello from a file');
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([
        { type: 'text', text: 'see ' },
        { type: 'file', mediaType: 'text/plain', filename: 'note.txt', url },
        { type: 'text', text: ' please' },
      ]),
    ]);
    const parts = out[0]!.parts;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', text: 'see ' });
    expect(parts[1]?.type).toBe('text');
    expect((parts[1] as { text: string }).text).toContain('<attachment filename="note.txt">');
    expect((parts[1] as { text: string }).text).toContain('hello from a file');
    expect(parts[2]).toEqual({ type: 'text', text: ' please' });
  });

  it('inlines SVG as XML source, not base64', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10" /></svg>';
    const url = writeAttachment('icon.svg', svg);
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([{ type: 'file', mediaType: 'image/svg+xml', filename: 'icon.svg', url }]),
    ]);
    const part = out[0]!.parts[0]!;
    expect(part.type).toBe('text');
    expect((part as { text: string }).text).toContain('<svg xmlns');
    // Must NOT have been base64-encoded
    expect((part as { text: string }).text).not.toContain('data:image/svg');
  });

  it('base64-encodes PNG images and preserves the file part', async () => {
    // Smallest valid PNG — 1×1 transparent pixel.
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    const url = writeAttachment('px.png', onePxPng);
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([{ type: 'file', mediaType: 'image/png', filename: 'px.png', url }]),
    ]);
    const part = out[0]!.parts[0] as { type: string; mediaType: string; url: string };
    expect(part.type).toBe('file');
    expect(part.mediaType).toBe('image/png');
    expect(part.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('drops file parts pointing at a missing on-disk file', async () => {
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([
        { type: 'text', text: 'before ' },
        { type: 'file', mediaType: 'image/png', filename: 'gone.png', url: '/api/attachments/missing.png' },
        { type: 'text', text: ' after' },
      ]),
    ]);
    expect(out[0]!.parts).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('drops audio parts when no STT provider is available', async () => {
    const url = writeAttachment('memo.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    vi.doMock('@/lib/stt/transcribe', () => ({
      pickProvider: vi.fn().mockRejectedValue(new Error('No speech-to-text provider available')),
      transcribe: vi.fn(),
    }));
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([
        { type: 'text', text: 'listen ' },
        { type: 'file', mediaType: 'audio/webm', filename: 'memo.webm', url },
      ]),
    ]);
    // Audio fell through extractor (returned null), then base64 path
    // (audio not in INLINE_BASE64_MEDIA_PREFIXES) — dropped with warning.
    expect(out[0]!.parts).toEqual([{ type: 'text', text: 'listen ' }]);
  });

  it('inlines audio transcripts when STT succeeds', async () => {
    const url = writeAttachment('memo.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    vi.doMock('@/lib/stt/transcribe', () => ({
      pickProvider: vi.fn().mockResolvedValue('local/parakeet-tdt-0.6b-v3'),
      transcribe: vi.fn().mockResolvedValue('this is the transcript'),
    }));
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([
        { type: 'file', mediaType: 'audio/webm', filename: 'memo.webm', url },
      ]),
    ]);
    const part = out[0]!.parts[0] as { type: string; text: string };
    expect(part.type).toBe('text');
    expect(part.text).toContain('kind="audio-transcript"');
    expect(part.text).toContain('this is the transcript');
  });

  it('passes non-file parts through unchanged', async () => {
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([
        { type: 'text', text: 'just text' },
      ]),
    ]);
    expect(out[0]!.parts).toEqual([{ type: 'text', text: 'just text' }]);
  });

  it('handles legacy data-URL text parts (back-compat)', async () => {
    const dataUrl = 'data:text/plain;base64,' + Buffer.from('legacy text').toString('base64');
    const { inlineTextAttachments } = await import('./inline-text-attachments');
    const out = await inlineTextAttachments([
      buildMessage([
        { type: 'file', mediaType: 'text/plain', filename: 'legacy.txt', url: dataUrl },
      ]),
    ]);
    const part = out[0]!.parts[0] as { type: string; text: string };
    expect(part.type).toBe('text');
    expect(part.text).toContain('legacy text');
  });
});
