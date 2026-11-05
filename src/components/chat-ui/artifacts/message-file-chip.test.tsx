import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TipProvider } from '@/components/ui/tip';
import { ArtifactPreviewProvider } from './artifact-preview-provider';
import { MessageFileChip } from './message-file-chip';

const chip = (fileName: string, originalName: string, mimeType: string) => renderToStaticMarkup(
  <TipProvider><ArtifactPreviewProvider><MessageFileChip attachment={{ fileName, originalName, mimeType, size: 2048, uploadedAt: '2026-11-05T00:00:00.000Z' }} /></ArtifactPreviewProvider></TipProvider>,
);

describe('MessageFileChip', () => {
  it('shows a type Ri has no name for as a download under its own name', () => {
    const html = chip('01a1-scene.glb', 'scene.glb', 'application/octet-stream');
    expect(html).toContain('href="/api/attachments/01a1-scene.glb"');
    expect(html).toContain('download="scene.glb"');
    expect(html).toContain('2.0 KB');
    expect(html).not.toContain('Open file');
  });

  it('still opens a file Ri can show in the shared preview', () => {
    const html = chip('01a1-budget.xlsx', 'budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(html).toContain('Open file: budget.xlsx');
    expect(html).not.toContain('download=');
  });
});
