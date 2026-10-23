import { createReadStream } from 'node:fs';
import { resolveMime } from '@/lib/attachments/mime';
import { isLocalTextTarget } from '@/lib/sessions/reply-text';
import { archiveEntries, checkOfficeContainer, type ArchiveEntry } from './archives';
import { previewFile } from './source';
import { filePreviewKind, filePreviewMime, type FilePreviewSource } from './preview-types';

interface FileInfo { name: string; size: number; mime: string }
export type FilePreviewData = FileInfo & (
  | { kind: 'video' | 'audio'; url?: string }
  | { kind: 'table'; sheets: { name: string; rows: string[][]; rowOffset?: number; columnOffset?: number }[]; truncated: boolean; source?: string }
  | { kind: 'document'; html: string }
  | { kind: 'slides'; slides: { title: string; text: string }[]; truncated: boolean }
  | { kind: 'archive'; entries: ArchiveEntry[]; truncated: boolean }
  | { kind: 'text'; content: string; markdown: boolean; truncated?: boolean }
  | { kind: 'file'; reason: string }
);

const MAX_INPUT = 16 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;

export async function readFilePreview(source: FilePreviewSource): Promise<FilePreviewData> {
  const file = await previewFile(source);
  const result = await previewContents(file.file, file.name, file.size);
  if ((result.kind === 'audio' || result.kind === 'video') && source.kind === 'attachment' && source.media) return { ...result, kind: source.media };
  return result;
}

/** Bounded content previews. A failed parser leaves the original file downloadable. */
export async function previewContents(file: string, name: string, size: number): Promise<FilePreviewData> {
  const kind = filePreviewKind(name);
  const media = filePreviewMime(name);
  const info = { name, size, mime: media !== 'application/octet-stream' ? media : resolveMime(null, name) };
  if (kind === 'video' || kind === 'audio') return { ...info, kind };
  const fallback = (reason: string): FilePreviewData => ({ ...info, kind: 'file', reason });
  const text = isLocalTextTarget(`./${name}`);
  if (kind === 'file' && !text) return fallback('No preview is available for this file type. Download it to open it.');
  if (size > (text && kind !== 'table' ? MAX_TEXT : MAX_INPUT)) return fallback('This file exceeds the preview size limit. Download it to open it.');
  try {
    const chunks: Buffer[] = [];
    // Enforce the cap on bytes read too, if an agent appends after the stat.
    for await (const chunk of createReadStream(/* turbopackIgnore: true */ file, { end: MAX_INPUT })) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (bytes.length > MAX_INPUT) return fallback('This file exceeds the preview size limit. Download it to open it.');
    if (/\.(docx|pptx|xlsx|odt|odp|ods)$/i.test(name)) await checkOfficeContainer(bytes);
    if (kind === 'archive') return { ...info, kind, ...await archiveEntries(bytes, name) };
    if (kind === 'table') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(bytes, { type: 'buffer', sheetRows: 501, cellHTML: false, cellFormula: false, raw: true, ...(/\.tsv$/i.test(name) ? { FS: '\t' } : {}) });
      let total = 0;
      let truncated = workbook.SheetNames.length > 20;
      const sheets = workbook.SheetNames.slice(0, 20).map(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet?.['!ref']) { if (sheet?.['!fullref']) truncated = true; return { name: sheetName, rows: [] }; }
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const full = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
        if (full.e.r - full.s.r >= 500 || full.e.c - full.s.c >= 100) truncated = true;
        const rows: string[][] = [];
        for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 499); r++) {
          if (total >= MAX_TEXT) { truncated = true; break; }
          const row: string[] = [];
          for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 99); c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            const value = cell ? XLSX.utils.format_cell(cell) : '';
            const shown = value.slice(0, 2000);
            if (shown.length < value.length) truncated = true;
            total += shown.length;
            row.push(shown);
          }
          rows.push(row);
        }
        return { name: sheetName, rows, rowOffset: range.s.r, columnOffset: range.s.c };
      });
      return { ...info, kind, sheets, truncated, ...(/\.(csv|tsv)$/i.test(name) && bytes.length <= MAX_TEXT ? { source: bytes.toString('utf8') } : {}) };
    }
    if (kind === 'document' && /\.docx$/i.test(name)) {
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ buffer: bytes }, { externalFileAccess: false });
      if (result.value.length > 4 * MAX_TEXT) return fallback('This document exceeds the preview limit. Download it to open it.');
      return { ...info, kind, html: result.value };
    }
    if (kind === 'slides' || kind === 'document') {
      const { parseOffice } = await import('officeparser');
      const ast = await parseOffice(bytes, { extractAttachments: false, ignoreNotes: true });
      if (kind === 'document') { const content = ast.toText(); return { ...info, kind: 'text', content: content.slice(0, MAX_TEXT), markdown: false, truncated: content.length > MAX_TEXT }; }
      let length = 0;
      const nodes = ast.content.filter(node => node.type === 'slide');
      let truncated = nodes.length > 200;
      const slides = nodes.slice(0, 200).flatMap((node, index) => {
        if (length >= MAX_TEXT) return [];
        const raw = node.text ?? (node.children ?? []).map(child => child.text ?? '').join('\n\n');
        const text = raw.slice(0, Math.min(20000, MAX_TEXT - length));
        if (text.length < raw.length) truncated = true;
        length += text.length;
        return [{ title: `Slide ${index + 1}`, text }];
      });
      return { ...info, kind, slides, truncated: truncated || slides.length < nodes.length || length >= MAX_TEXT };
    }
    if (bytes.subarray(0, 8192).includes(0)) return fallback('This file contains binary data and cannot be shown as text.');
    if (bytes.length > MAX_TEXT) return fallback('This file exceeds the text preview limit. Download it to open it.');
    return { ...info, kind: 'text', content: bytes.toString('utf8'), markdown: /\.(md|mdx|markdown)$/i.test(name) };
  } catch (error) {
    return fallback(error instanceof Error && error.message.startsWith('This document is too large') ? error.message : 'This file could not be previewed. Download it to open it.');
  }
}
