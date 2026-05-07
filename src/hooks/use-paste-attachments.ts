'use client';

import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from 'react';
import {
  type PasteAttachment,
  attachmentsToFileUIParts,
  createPasteAttachment,
  shouldConvertPasteToAttachment,
} from '@/lib/chat/paste-attachments';

interface UsePasteAttachmentsResult {
  attachments: PasteAttachment[];
  /** Bind to <textarea onPaste={...}>. Intercepts long pastes; small ones pass through. */
  handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /**
   * Bind to <textarea onKeyDown={...}> alongside your own handler. Returns
   * `true` when a Backspace-on-empty was consumed to drop the last chip,
   * so the caller can short-circuit its own keydown logic.
   */
  handleBackspaceOnEmpty: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  /** Convert current attachments into the FileUIPart shape `sendMessage` expects. */
  toFileParts: () => ReturnType<typeof attachmentsToFileUIParts>;
  hasAttachments: boolean;
}

export function usePasteAttachments(): UsePasteAttachmentsResult {
  const [attachments, setAttachments] = useState<PasteAttachment[]>([]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      // `clipboardData.items` may contain non-text payloads (images, files);
      // those should fall through to whatever upstream paste handling exists
      // — we only care about big text dumps.
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!shouldConvertPasteToAttachment(text)) return;

      event.preventDefault();
      setAttachments((prev) => [
        ...prev,
        createPasteAttachment(text, prev.length + 1),
      ]);
    },
    [],
  );

  const handleBackspaceOnEmpty = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (
        event.key !== 'Backspace' ||
        event.currentTarget.value !== '' ||
        attachments.length === 0
      ) {
        return false;
      }
      event.preventDefault();
      setAttachments((prev) => prev.slice(0, -1));
      return true;
    },
    [attachments.length],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const toFileParts = useCallback(
    () => attachmentsToFileUIParts(attachments),
    [attachments],
  );

  return {
    attachments,
    handlePaste,
    handleBackspaceOnEmpty,
    removeAttachment,
    clearAttachments,
    toFileParts,
    hasAttachments: attachments.length > 0,
  };
}
