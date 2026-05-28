"use client";

import type { Attachment } from '@/db/types';
import { attachmentUrl, isAudioAttachment } from '@/lib/attachments/view';

interface StreamAttachmentsProps {
  attachments: Attachment[] | null | undefined;
}

/**
 * Renders attachments for a stream item inline with the text. Audio
 * attachments get a compact `<audio controls>` player — the capture flow
 * stores the raw recording when transcription fails or no STT is configured,
 * and this is the surface the user uses to actually listen to it.
 *
 * Images and other files fall through to a simple download link. Most
 * stream-item attachments are audio today; images/PDFs arrive here rarely.
 */
export function StreamAttachments({ attachments }: StreamAttachmentsProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 mt-1">
      {attachments.map((a) => {
        const url = attachmentUrl(a.fileName);
        if (isAudioAttachment(a)) {
          return (
            <audio
              key={a.fileName}
              controls
              preload="none"
              src={url}
              className="h-7 max-w-full"
              aria-label={a.originalName}
            />
          );
        }
        if (a.mimeType.startsWith('image/')) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={a.fileName}
              src={url}
              alt={a.originalName}
              className="max-h-32 rounded border border-border object-cover"
            />
          );
        }
        return (
          <a
            key={a.fileName}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-primary hover:underline truncate"
          >
            {a.originalName}
          </a>
        );
      })}
    </div>
  );
}
