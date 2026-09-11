import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentMetadataRepairError } from '@/lib/attachments/repair-metadata';

vi.mock('@/lib/db/queries', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/db/queries')>(),
  repairNoteAttachmentMetadata: vi.fn(),
}));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));

import { repairNoteAttachmentMetadata } from '@/lib/db/queries';
import { runAction } from './dispatch';

const input = { source_note_id: 'source', target_note_id: 'target', file_names: ['first.png'] };
const action = 'repair_note_attachment_metadata';

describe('attachment repair action contract', () => {
  beforeEach(() => { vi.mocked(repairNoteAttachmentMetadata).mockReset(); });

  it('dispatches the explicit snake_case contract through the query layer', async () => {
    const result = { sourceNoteId: 'source', targetNoteId: 'target', repairedFileNames: ['first.png'], unchangedFileNames: [] };
    vi.mocked(repairNoteAttachmentMetadata).mockResolvedValue(result);
    expect(await runAction(action, input, { remote: false })).toEqual({ ok: true, action, result });
    expect(repairNoteAttachmentMetadata).toHaveBeenCalledWith({
      sourceNoteId: 'source', targetNoteId: 'target', fileNames: ['first.png'],
    });
  });

  it.each([true, undefined])('rejects non-local context %s before accessing storage', async (remote) => {
    const result = await runAction(action, input, { remote } as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(repairNoteAttachmentMetadata).not.toHaveBeenCalled();
  });

  it.each([[], ['../first.png']].map((file_names) => ({ file_names })))('rejects invalid filename selections $file_names at the boundary', async ({ file_names }) => {
    expect(await runAction(action, { ...input, file_names }, { remote: false }))
      .toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(repairNoteAttachmentMetadata).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'not_found', 'invalid_params'] as const)('maps query error %s to ActionError envelope', async (code) => {
    vi.mocked(repairNoteAttachmentMetadata).mockRejectedValue(new AttachmentMetadataRepairError(code, 'Safe repair rejected.'));
    expect(await runAction(action, input, { remote: false }))
      .toMatchObject({ ok: false, error: { code, message: 'Safe repair rejected.' } });
  });
});
