import { saveAttachment } from '@/lib/attachments/save';
import { ATTACHMENT_FILE_NAME } from '@/lib/attachments/markers';
import { isAllowedMime, normalizeMime } from '@/lib/attachments/mime';
import type { Attachment } from '@/db/types';
import type { ModelContext, View } from './store';

/**
 * Files in a view's model context (docs/connected-mcp-apps.md, "Model
 * context"). An image block, or an embedded resource's blob, is saved as an
 * ordinary attachment when a message freezes the context, and the block
 * keeps only its `[[file:<name>]]` marker. The model gets the file the way
 * it gets one the person attached (the marker becomes its path), and
 * `chat_events.raw` never holds the bytes.
 *
 * Files are saved once per context update: sending again with the same
 * context reuses them.
 */

/** One image in context may be this large. The whole update is capped at 768 KiB already. */
export const MAX_CONTEXT_FILE_BYTES = 768 * 1024;

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const marker = (attachment: Attachment) => `[[file:${attachment.fileName}]]`;

function bytes(data: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const buffer = Buffer.from(data, 'base64');
  return buffer.byteLength && buffer.byteLength <= MAX_CONTEXT_FILE_BYTES ? buffer : null;
}

/** A display name for a saved block: its title, the resource's file name, or the kind. */
function nameOf(block: Record<string, unknown>, fallback: string) {
  const title = record(block._meta)['openai/title'];
  if (typeof title === 'string' && title.trim()) return title.trim().slice(0, 120);
  const uri = record(block.resource).uri;
  if (typeof uri === 'string') return uri.split(/[\\/]/).filter(Boolean).pop()?.slice(0, 120) || fallback;
  return fallback;
}

async function materializeBlock(block: Record<string, unknown>, files: Attachment[]): Promise<Record<string, unknown>> {
  if (block.type === 'image' && typeof block.data === 'string') {
    const mimeType = normalizeMime(typeof block.mimeType === 'string' ? block.mimeType : '');
    const data = bytes(block.data);
    if (!data || !mimeType.startsWith('image/') || !isAllowedMime(mimeType)) {
      return { type: 'text', text: '[An image from the app could not be attached]', ...(block.annotations ? { annotations: block.annotations } : {}) };
    }
    const attachment = await saveAttachment({ data, originalName: nameOf(block, 'image'), mimeType });
    files.push(attachment);
    const rest = { ...block };
    delete rest.data;
    return { ...rest, mimeType, file: marker(attachment) };
  }
  const resource = record(block.resource);
  if (block.type === 'resource' && typeof resource.blob === 'string') {
    const mimeType = normalizeMime(typeof resource.mimeType === 'string' ? resource.mimeType : '');
    const data = bytes(resource.blob);
    const kept = { ...resource };
    delete kept.blob;
    if (!data || !mimeType || !isAllowedMime(mimeType)) return { ...block, resource: { ...kept, note: 'Binary content from the app was not attached' } };
    const attachment = await saveAttachment({ data, originalName: nameOf(block, 'resource'), mimeType });
    files.push(attachment);
    return { ...block, resource: { ...kept, mimeType, file: marker(attachment) } };
  }
  return block;
}

/**
 * The view's current context with its files saved, and those files. Cached
 * on the view by `updateId`, so an unchanged context is not saved twice.
 */
export async function materializeContextFiles(view: View): Promise<{ context: ModelContext | null; files: Attachment[] }> {
  const context = view.context;
  if (!context) return { context: null, files: [] };
  const cached = view.contextFiles;
  if (cached && cached.updateId === view.contextUpdateId && cached.source === context) return { context: cached.context, files: cached.files };
  const files: Attachment[] = [];
  const content: Record<string, unknown>[] = [];
  for (const block of context.content) content.push(await materializeBlock(block, files));
  const saved: ModelContext = { ...context, content };
  view.contextFiles = { updateId: view.contextUpdateId, source: context, context: saved, files };
  return { context: saved, files };
}

/**
 * The attachments a message's frozen app context names (`files` on each
 * frozen item), checked to be stored attachments. Dispatch adds them to the
 * message's own, so their markers become paths for the harness.
 */
export function contextAttachments(frozen: unknown): Attachment[] {
  if (!Array.isArray(frozen)) return [];
  const seen = new Set<string>();
  return frozen.flatMap(item => (Array.isArray(record(item).files) ? record(item).files as unknown[] : [])).flatMap((raw): Attachment[] => {
    const file = record(raw);
    if (typeof file.fileName !== 'string' || !ATTACHMENT_FILE_NAME.test(file.fileName) || seen.has(file.fileName)) return [];
    if (typeof file.mimeType !== 'string' || typeof file.originalName !== 'string' || typeof file.size !== 'number' || typeof file.uploadedAt !== 'string') return [];
    seen.add(file.fileName);
    return [{ fileName: file.fileName, originalName: file.originalName, mimeType: file.mimeType, size: file.size, uploadedAt: file.uploadedAt }];
  });
}
