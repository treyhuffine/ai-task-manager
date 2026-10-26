'use client';

import { FileText } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { pdfThumbnailUrl } from '@/lib/sessions/reply-pdf';
import { ArtifactCard } from './artifact-card';
import type { ArtifactPreview } from './artifact-preview-provider';
import { PreviewImage } from './preview-image';

/** A PDF in a chat: its first page, drawn on the Home, opening the PDF in
 * the shared preview dialog. `src` serves the PDF (`reply-pdf.ts`), and
 * `source` says where it is: the path an agent wrote, or the upload's name. */
export function PdfPreviewCard({ src, name, source, description }: { src: string; name: string; source: string; description?: string }) {
  const preview = useMemo<ArtifactPreview>(() => ({ kind: 'pdf', src, name, source }), [src, name, source]);
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null);
  const onErrorChange = useCallback((message: string | undefined) => setFailure(message ? { src, message } : null), [src]);
  const error = failure?.src === src ? failure.message : undefined;
  const details = (
    <span className="block max-h-60 space-y-1 overflow-y-auto">
      <span className="block font-medium">{name}</span>
      {source !== name && <span className="block font-mono text-[11px] wrap-anywhere">{source}</span>}
      {error && <span className="block">{error}</span>}
    </span>
  );
  return (
    <ArtifactCard preview={preview} name={name} details={details} aria-label={`Open PDF: ${name}`} aria-description={description !== name ? description : undefined} icon={<FileText size={13} className="shrink-0 text-muted-foreground" />}>
      {/* The top of the first page, as a document's card shows it. */}
      <PreviewImage src={pdfThumbnailUrl(src)} alt={`First page of ${name}`} onErrorChange={onErrorChange} className="block h-full w-full bg-white object-cover object-top" />
    </ArtifactCard>
  );
}
