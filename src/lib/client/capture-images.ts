import { isAllowedMime, resolveMime } from '@/lib/attachments/mime';

export const CAPTURE_MAX_IMAGES = 10;
export const CAPTURE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const CAPTURE_MAX_TEXT_LENGTH = 100_000;

/** All capture entry points share the same limits, including restored drafts. */
export function chooseCaptureImages(
  existing: readonly File[],
  incoming: readonly File[],
): { files: File[]; errors: string[] } {
  const files = [...existing];
  const errors = new Set<string>();
  // Deduplicate one browser event only. Re-selecting a file is intentional.
  const seen = new Set<File>();
  let totalBytes = existing.reduce((total, file) => total + file.size, 0);

  for (const file of incoming) {
    if (seen.has(file)) continue;
    seen.add(file);

    const type = resolveMime(file.type, file.name);
    if (!type.startsWith('image/') || !isAllowedMime(type)) {
      errors.add('Only supported image files can be added.');
      continue;
    }
    if (file.size === 0) {
      errors.add('Empty image files cannot be added.');
      continue;
    }
    if (files.length >= CAPTURE_MAX_IMAGES) {
      errors.add(`A capture can include up to ${CAPTURE_MAX_IMAGES} images.`);
      continue;
    }
    if (totalBytes + file.size > CAPTURE_MAX_IMAGE_BYTES) {
      errors.add('Images in a capture must total 20 MiB or less.');
      continue;
    }

    files.push(type === file.type ? file : new File([file], file.name, {
      type,
      lastModified: file.lastModified,
    }));
    totalBytes += file.size;
  }

  return { files, errors: [...errors] };
}

type TransferItem = {
  kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry?(): { isDirectory: boolean; name?: string } | null;
};

export type CaptureDataTransfer = {
  items?: ArrayLike<TransferItem> | null;
  files?: ArrayLike<File> | null;
};

function fingerprint(file: File): string {
  return JSON.stringify([file.name, file.size, file.type, file.lastModified]);
}

/**
 * Reads file payloads only, never clipboard HTML, links or directory contents.
 * Some browsers expose distinct File wrappers for items and files. Match those
 * representations by metadata without collapsing distinct item occurrences.
 */
export function transferFiles(transfer: CaptureDataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  const seen = new Set<File>();
  const represented = new Map<string, number>();
  const directories = new Set<string>();

  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== 'file') continue;
    let file: File | null;
    let directory = false;
    try {
      const entry = item.webkitGetAsEntry?.();
      directory = entry?.isDirectory ?? false;
      if (directory && entry?.name) directories.add(entry.name);
      file = item.getAsFile();
    } catch {
      // Browsers may refuse an individual item. The FileList can still work.
      continue;
    }
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const key = fingerprint(file);
    represented.set(key, (represented.get(key) ?? 0) + 1);
    if (!directory) files.push(file);
  }

  for (const file of Array.from(transfer.files ?? [])) {
    if (file.size === 0 && directories.has(file.name)) continue;
    const key = fingerprint(file);
    const count = represented.get(key) ?? 0;
    if (count > 0) {
      represented.set(key, count - 1);
      seen.add(file);
      continue;
    }
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}
