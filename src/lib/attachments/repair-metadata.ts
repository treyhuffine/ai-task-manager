import fs from 'node:fs';
import path from 'node:path';
import type { Attachment, NoteRecord } from '@/db/types';
import { getAttachmentsDir } from '@/lib/config/paths';
import { extractReferencedFileNames } from './derive';
import { ALLOWED_MIMES, extForFile, extFromName } from './mime';

export class AttachmentMetadataRepairError extends Error {
  constructor(public code: 'not_found' | 'invalid_params' | 'conflict', message: string) {
    super(message);
    this.name = 'AttachmentMetadataRepairError';
  }
}

export const REPAIR_ATTACHMENT_FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;
export const MAX_ATTACHMENT_METADATA_REPAIRS = 100;

type AttachmentNote = Pick<NoteRecord, 'id' | 'body' | 'attachments'>;

/** Repair only generated copy stubs, never overwrite different real metadata. */
export function planNoteAttachmentMetadataRepair(input: {
  source: AttachmentNote;
  target: AttachmentNote;
  fileNames: string[];
}): { attachments: Attachment[]; repairedFileNames: string[] } {
  const { source, target, fileNames } = input;
  if (source.id === target.id) {
    throw new AttachmentMetadataRepairError('invalid_params', 'Source and target notes must be different.');
  }
  if (!fileNames.length || fileNames.length > MAX_ATTACHMENT_METADATA_REPAIRS ||
      new Set(fileNames).size !== fileNames.length ||
      fileNames.some((name) => !REPAIR_ATTACHMENT_FILE_NAME.test(name))) {
    throw new AttachmentMetadataRepairError('invalid_params', 'Select 1 to 100 distinct storage filenames, without paths.');
  }

  const sourceReferences = new Set(extractReferencedFileNames(source.body));
  const targetReferences = new Set(extractReferencedFileNames(target.body));
  const replacements = new Map<string, Attachment>();
  for (const fileName of fileNames) {
    if (!sourceReferences.has(fileName) || !targetReferences.has(fileName)) {
      throw new AttachmentMetadataRepairError('conflict', `Attachment must be referenced in both note bodies: ${fileName}`);
    }
    const sourceRows = (source.attachments ?? []).filter((a) => a.fileName === fileName);
    const targetRows = (target.attachments ?? []).filter((a) => a.fileName === fileName);
    if (sourceRows.length !== 1 || targetRows.length !== 1) {
      throw new AttachmentMetadataRepairError('conflict', `Expected exactly one attachment record in each note: ${fileName}`);
    }
    const authoritative = sourceRows[0];
    const prior = targetRows[0];
    if (typeof authoritative.originalName !== 'string' || !authoritative.originalName.trim() ||
        !ALLOWED_MIMES.has(authoritative.mimeType) ||
        !Number.isSafeInteger(authoritative.size) || authoritative.size <= 0 ||
        typeof authoritative.uploadedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T/.test(authoritative.uploadedAt) ||
        !Number.isFinite(Date.parse(authoritative.uploadedAt)) ||
        extForFile(authoritative.mimeType, authoritative.originalName) !== extFromName(fileName)) {
      throw new AttachmentMetadataRepairError('conflict', `Source attachment metadata is incomplete or inconsistent: ${fileName}`);
    }

    // The filename is an exact, path-free shared storage identity. Do not
    // follow symlinks or accept metadata describing different on-disk bytes.
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(path.join(getAttachmentsDir(), fileName));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AttachmentMetadataRepairError('not_found', `Attachment file not found: ${fileName}`);
      }
      throw err;
    }
    if (!stat.isFile() || stat.size !== authoritative.size) {
      throw new AttachmentMetadataRepairError('conflict', `Attachment file must be a regular file matching the source size: ${fileName}`);
    }

    if (prior.originalName === authoritative.originalName && prior.mimeType === authoritative.mimeType &&
        prior.size === authoritative.size && prior.uploadedAt === authoritative.uploadedAt) continue;
    if (prior.originalName !== fileName || prior.mimeType !== 'application/octet-stream' || prior.size !== 0) {
      throw new AttachmentMetadataRepairError('conflict', `Target attachment has non-stub metadata and cannot be overwritten: ${fileName}`);
    }
    replacements.set(fileName, {
      ...prior,
      originalName: authoritative.originalName,
      mimeType: authoritative.mimeType,
      size: authoritative.size,
      uploadedAt: authoritative.uploadedAt,
    });
  }
  return {
    attachments: (target.attachments ?? []).map((a) => replacements.get(a.fileName) ?? a),
    repairedFileNames: [...replacements.keys()],
  };
}
