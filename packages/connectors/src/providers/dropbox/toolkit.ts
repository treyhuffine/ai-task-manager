/**
 * The `dropbox` toolkit — file operations over Dropbox's RPC API (all POST + JSON body).
 * Reads need `files.metadata.read`; create/delete need `files.content.write`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { DROPBOX_SCOPES } from './provider';

export const dropboxToolkit = defineToolkit({
  id: 'dropbox',
  providerId: 'dropbox',
  displayName: 'Dropbox',
  actions: [
    httpAction({
      id: 'dropbox.list_folder',
      description: 'List the entries in a Dropbox folder (root is the empty string "").',
      scopes: [DROPBOX_SCOPES.filesMetadataRead],
      input: z.object({
        path: z.string().default('').describe('Folder path, e.g. "/Documents" ("" = root)'),
        recursive: z.boolean().default(false),
      }),
      request: (i) => ({ method: 'POST', path: '/files/list_folder', body: { path: i.path, recursive: i.recursive } }),
      output: (raw) => {
        const r = raw as { entries?: unknown[]; cursor?: string; has_more?: boolean };
        return { entries: r.entries ?? [], cursor: r.cursor, hasMore: !!r.has_more };
      },
    }),

    httpAction({
      id: 'dropbox.search',
      description: 'Search files and folders by name/content.',
      scopes: [DROPBOX_SCOPES.filesMetadataRead],
      input: z.object({ query: z.string(), maxResults: z.number().int().positive().max(1000).default(25) }),
      request: (i) => ({
        method: 'POST',
        path: '/files/search_v2',
        body: { query: i.query, options: { max_results: i.maxResults } },
      }),
      output: (raw) => {
        const r = raw as { matches?: unknown[] };
        return { matches: r.matches ?? [] };
      },
    }),

    httpAction({
      id: 'dropbox.get_metadata',
      description: 'Get metadata for a file or folder by path.',
      scopes: [DROPBOX_SCOPES.filesMetadataRead],
      input: z.object({ path: z.string() }),
      request: (i) => ({ method: 'POST', path: '/files/get_metadata', body: { path: i.path } }),
    }),

    httpAction({
      id: 'dropbox.create_folder',
      description: 'Create a folder at the given path.',
      mutating: true,
      risk: 'medium',
      scopes: [DROPBOX_SCOPES.filesContentWrite],
      input: z.object({ path: z.string().describe('Full path of the new folder, e.g. "/New Folder"') }),
      request: (i) => ({ method: 'POST', path: '/files/create_folder_v2', body: { path: i.path } }),
      output: (raw) => {
        const r = raw as { metadata?: { id?: string; path_display?: string } };
        return { id: r.metadata?.id, path: r.metadata?.path_display };
      },
    }),

    httpAction({
      id: 'dropbox.delete',
      description: 'Delete a file or folder at the given path.',
      mutating: true,
      risk: 'high',
      scopes: [DROPBOX_SCOPES.filesContentWrite],
      input: z.object({ path: z.string() }),
      request: (i) => ({ method: 'POST', path: '/files/delete_v2', body: { path: i.path } }),
      output: () => ({ deleted: true }),
    }),
  ],
});
