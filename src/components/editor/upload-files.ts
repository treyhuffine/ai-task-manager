import type { Editor } from '@tiptap/core'
import { uploadAttachment } from '@/lib/attachments/client'
import { attachmentUrl } from '@/lib/attachments/view'
import type { Attachment } from '@/db/types'

/**
 * Upload a batch of image files, insert them as Image nodes starting at
 * `startPos`, and emit each Attachment through the optional callback.
 *
 * Uses `editor.commands.insertContentAt`, which is schema-aware: when the
 * target sits inside an empty textblock (e.g. a paragraph the user just
 * cleared with `/image`), it widens the range to swallow the empty block
 * so the image lands on that line instead of getting pushed below it.
 *
 * Each file uploads independently; failures are logged and skipped so a
 * single bad file doesn't block the others. Insertion happens after the
 * upload resolves so the editor doesn't show placeholder gaps or
 * broken-image icons pointing at not-yet-saved files.
 */
/**
 * Where an editor's files go, when not this Ri's own attachments: a shared
 * task in My Ri stores them at its team (docs/homes-spec.md §9.4).
 */
export interface AttachmentStore {
  upload(file: File): Promise<Attachment>
  url(fileName: string): string
}

export async function insertUploadedFiles(
  editor: Editor,
  files: File[],
  startPos: number,
  onAttachment?: (a: Attachment) => void,
  store?: AttachmentStore,
): Promise<void> {
  let pos = startPos
  for (const file of files) {
    try {
      const attachment = store ? await store.upload(file) : await uploadAttachment(file)
      const src = store ? store.url(attachment.fileName) : attachmentUrl(attachment.fileName)
      // Clamp each iteration: the document may have grown or shrunk as
      // earlier files in the batch were inserted, and the cursor is a
      // safer landing spot than a stale absolute position.
      const target = Math.min(pos, editor.state.doc.content.size)
      editor
        .chain()
        .insertContentAt(target, {
          type: 'image',
          attrs: { src, alt: attachment.originalName },
        })
        .run()
      // After insertion, the selection lands just past the new content.
      pos = editor.state.selection.to
      onAttachment?.(attachment)
    } catch (err) {
      console.error('[editor] attachment upload failed', err)
    }
  }
}
