/**
 * The `box` toolkit — files & folders over the Box Content API. Non-OAuth-scope-gated (Box
 * scopes are app-level), so actions declare no `scopes`. Output mappers return clean shapes.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

interface RawItem {
  id?: string;
  name?: string;
  type?: string;
  size?: number;
  modified_at?: string;
}

function itemSummary(i: RawItem) {
  return {
    id: i.id,
    name: i.name,
    type: i.type,
    ...(i.size !== undefined ? { size: i.size } : {}),
    ...(i.modified_at !== undefined ? { modifiedAt: i.modified_at } : {}),
  };
}

export const boxToolkit = defineToolkit({
  id: 'box',
  providerId: 'box',
  displayName: 'Box',
  actions: [
    httpAction({
      id: 'box.list_folder_items',
      description: 'List the files and folders inside a Box folder (root folder id is "0").',
      input: z.object({ folderId: z.string().default('0') }),
      request: (i) => ({ method: 'GET', path: `/folders/${encodeURIComponent(i.folderId)}/items` }),
      output: (raw) => {
        const r = raw as { entries?: RawItem[] };
        return { entries: (r.entries ?? []).map(itemSummary) };
      },
    }),

    httpAction({
      id: 'box.get_file',
      description: 'Get a Box file’s metadata by id.',
      input: z.object({ fileId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/files/${encodeURIComponent(i.fileId)}` }),
      output: (raw) => itemSummary(raw as RawItem),
    }),

    httpAction({
      id: 'box.search',
      description: 'Search Box for files and folders by keyword.',
      input: z.object({ query: z.string() }),
      request: (i) => ({ method: 'GET', path: '/search', query: { query: i.query } }),
      output: (raw) => {
        const r = raw as { entries?: RawItem[] };
        return { entries: (r.entries ?? []).map(itemSummary) };
      },
    }),

    httpAction({
      id: 'box.create_folder',
      description: 'Create a new folder in Box (defaults to the root folder).',
      mutating: true,
      risk: 'medium',
      input: z.object({ name: z.string(), parentId: z.string().default('0') }),
      request: (i) => ({ method: 'POST', path: '/folders', body: { name: i.name, parent: { id: i.parentId } } }),
      output: (raw) => itemSummary(raw as RawItem),
    }),

    httpAction({
      id: 'box.delete_file',
      description: 'Permanently delete a Box file by id.',
      mutating: true,
      risk: 'high',
      input: z.object({ fileId: z.string() }),
      request: (i) => ({ method: 'DELETE', path: `/files/${encodeURIComponent(i.fileId)}` }),
      output: () => ({ deleted: true }),
    }),
  ],
});
