/**
 * The `google_drive` toolkit. Reuses the existing Google connection — asking the agent to
 * touch Drive on a Calendar/Gmail connection triggers incremental consent (§7) for the Drive
 * scopes, no re-connect. Reads use `drive.readonly`; create/delete use `drive.file`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { GOOGLE_SCOPES } from './provider';

const DRIVE = '/drive/v3';

interface RawFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

function fileSummary(f: RawFile) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    ...(f.size !== undefined ? { size: Number(f.size) } : {}),
  };
}

export const googleDrive = defineToolkit({
  id: 'google_drive',
  providerId: 'google',
  displayName: 'Google Drive',
  actions: [
    httpAction({
      id: 'google_drive.list_files',
      description: 'List or search Drive files. Use `query` for a Drive query string (e.g. "name contains \'report\'").',
      scopes: [GOOGLE_SCOPES.driveReadonly],
      input: z.object({
        query: z.string().optional().describe('Drive `q` query, e.g. "mimeType=\'application/pdf\'"'),
        pageSize: z.number().int().positive().max(1000).default(25),
        orderBy: z.string().optional().describe('e.g. "modifiedTime desc"'),
      }),
      request: (i) => ({
        method: 'GET',
        path: `${DRIVE}/files`,
        query: {
          q: i.query,
          pageSize: i.pageSize,
          orderBy: i.orderBy,
          fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size),nextPageToken',
        },
      }),
      output: (raw) => {
        const r = raw as { files?: RawFile[]; nextPageToken?: string };
        return { files: (r.files ?? []).map(fileSummary), nextPageToken: r.nextPageToken };
      },
    }),

    httpAction({
      id: 'google_drive.get_file',
      description: 'Get a Drive file’s metadata by id.',
      scopes: [GOOGLE_SCOPES.driveReadonly],
      input: z.object({ fileId: z.string() }),
      request: (i) => ({
        method: 'GET',
        path: `${DRIVE}/files/${encodeURIComponent(i.fileId)}`,
        query: { fields: 'id,name,mimeType,modifiedTime,webViewLink,size' },
      }),
      output: (raw) => fileSummary(raw as RawFile),
    }),

    httpAction({
      id: 'google_drive.export_file',
      description: 'Export a Google Doc/Sheet/Slide as text (default text/plain) and return its content.',
      scopes: [GOOGLE_SCOPES.driveReadonly],
      input: z.object({
        fileId: z.string(),
        mimeType: z.string().default('text/plain').describe('Export MIME type, e.g. text/plain, text/csv'),
      }),
      request: (i) => ({
        method: 'GET',
        path: `${DRIVE}/files/${encodeURIComponent(i.fileId)}/export`,
        query: { mimeType: i.mimeType },
      }),
      output: (raw) => ({ content: typeof raw === 'string' ? raw : JSON.stringify(raw) }),
    }),

    httpAction({
      id: 'google_drive.create_folder',
      description: 'Create a folder in Drive (optionally inside a parent folder).',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.driveFile],
      input: z.object({ name: z.string(), parentId: z.string().optional() }),
      request: (i) => ({
        method: 'POST',
        path: `${DRIVE}/files`,
        body: {
          name: i.name,
          mimeType: 'application/vnd.google-apps.folder',
          ...(i.parentId ? { parents: [i.parentId] } : {}),
        },
      }),
      output: (raw) => fileSummary(raw as RawFile),
    }),

    httpAction({
      id: 'google_drive.delete_file',
      description: 'Permanently delete a Drive file by id.',
      mutating: true,
      risk: 'high',
      scopes: [GOOGLE_SCOPES.driveFile],
      input: z.object({ fileId: z.string() }),
      request: (i) => ({ method: 'DELETE', path: `${DRIVE}/files/${encodeURIComponent(i.fileId)}` }),
      output: () => ({ deleted: true }),
    }),
  ],
});
