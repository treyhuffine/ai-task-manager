/**
 * How the orchestrator looks: an image, or an emoji on a color, or (with
 * neither) the Ri mark for the default name and its initial for any other.
 * Stored on `user_state.orchestrator{Emoji,Image,Color}`, every one null until
 * the user picks, and drawn by `OrchestratorMark`.
 *
 * `parseOrchestratorLook` is the one gate for writes (PATCH /api/user-state):
 * it folds blanks to null, keeps an emoji to one, holds colors to the palette
 * and images to attachments that are images. Pure, so the client and the
 * server share it.
 */

import type { Attachment } from '@/db/types';

export interface OrchestratorColor {
  hex: string;
  label: string;
}

/**
 * The colors an emoji or initial can sit on. A fixed palette rather than any
 * hex: every one is checked for a readable initial (`textColorOn`), and the
 * swatches stay a short row instead of a color picker.
 */
export const ORCHESTRATOR_COLORS: readonly OrchestratorColor[] = [
  { hex: '#e8664f', label: 'Coral' },
  { hex: '#f2a93b', label: 'Amber' },
  { hex: '#8cc63f', label: 'Lime' },
  { hex: '#2fb67c', label: 'Green' },
  { hex: '#22b5c9', label: 'Teal' },
  { hex: '#4f7cf0', label: 'Blue' },
  { hex: '#8b6cf0', label: 'Violet' },
  { hex: '#e2609a', label: 'Pink' },
  { hex: '#7c736a', label: 'Stone' },
  { hex: '#f3ead8', label: 'Cream' },
];

const PALETTE = new Set(ORCHESTRATOR_COLORS.map((c) => c.hex));

/** Most emoji are one grapheme. Two allows a flag or a pair, and nothing longer reads as an avatar. */
const MAX_EMOJI_GRAPHEMES = 2;

/** Upload names are `<uuidv7>.<ext>` (src/lib/attachments/save.ts). */
const ATTACHMENT_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Readable text for an initial on `hex`: dark on light colors, white on the rest. */
export function textColorOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.4 ? '#1c1917' : '#ffffff';
}

export function isOrchestratorColor(value: unknown): value is string {
  return typeof value === 'string' && PALETTE.has(value.toLowerCase());
}

export type OrchestratorLookPatch = {
  orchestratorEmoji?: string | null;
  orchestratorColor?: string | null;
  orchestratorImage?: Attachment | null;
};

/**
 * The look fields of a user-state write, checked and normalized, or the
 * reason they're refused. Fields the body leaves out stay out of the patch.
 */
export function parseOrchestratorLook(
  body: Record<string, unknown>,
): { patch: OrchestratorLookPatch } | { error: string } {
  const patch: OrchestratorLookPatch = {};

  if ('orchestratorEmoji' in body) {
    const raw = body.orchestratorEmoji;
    if (raw !== null && typeof raw !== 'string') return { error: 'orchestratorEmoji must be text, or null for none' };
    const emoji = typeof raw === 'string' ? raw.trim() : '';
    if (emoji && (graphemes(emoji).length > MAX_EMOJI_GRAPHEMES || /[\p{L}\p{N}]/u.test(emoji.replace(/\p{Extended_Pictographic}/gu, '')))) {
      return { error: 'orchestratorEmoji must be a single emoji' };
    }
    patch.orchestratorEmoji = emoji || null;
  }

  if ('orchestratorColor' in body) {
    const raw = body.orchestratorColor;
    if (raw !== null && !isOrchestratorColor(raw)) return { error: 'orchestratorColor must be one of the palette colors, or null' };
    patch.orchestratorColor = raw === null ? null : (raw as string).toLowerCase();
  }

  if ('orchestratorImage' in body) {
    const raw = body.orchestratorImage;
    if (raw === null) {
      patch.orchestratorImage = null;
    } else {
      const image = raw as Partial<Attachment> | undefined;
      if (
        !image ||
        typeof image !== 'object' ||
        typeof image.fileName !== 'string' ||
        !ATTACHMENT_FILE_NAME.test(image.fileName) ||
        typeof image.mimeType !== 'string' ||
        !image.mimeType.startsWith('image/')
      ) {
        return { error: 'orchestratorImage must be an uploaded image attachment, or null' };
      }
      patch.orchestratorImage = {
        fileName: image.fileName,
        originalName: typeof image.originalName === 'string' ? image.originalName : image.fileName,
        mimeType: image.mimeType,
        size: typeof image.size === 'number' ? image.size : 0,
        uploadedAt: typeof image.uploadedAt === 'string' ? image.uploadedAt : new Date().toISOString(),
      };
    }
  }

  return { patch };
}
