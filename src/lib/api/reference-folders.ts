import { api } from './client';
import type { TreeEntry } from './sessions';
import type {
  ResolvedReferenceFolder,
  ReferenceFolderRecord,
  CreateReferenceFolderInput,
  UpdateReferenceFolderInput,
} from '@/db/types';

export const referenceFoldersApi = {
  /**
   * Rows visible from a workspace: its own plus every global one, already
   * resolved to absolute paths with existence and git state attached.
   * Omit `workspaceId` for the global rows alone.
   */
  list(workspaceId?: string | null): Promise<ResolvedReferenceFolder[]> {
    return api.get<ResolvedReferenceFolder[]>('/reference-folders', {
      query: workspaceId ? { workspaceId } : undefined,
    });
  },

  create(input: CreateReferenceFolderInput): Promise<ResolvedReferenceFolder> {
    return api.post<ResolvedReferenceFolder>('/reference-folders', input);
  },

  update(id: string, input: UpdateReferenceFolderInput): Promise<ResolvedReferenceFolder> {
    return api.patch<ResolvedReferenceFolder>(`/reference-folders/${id}`, input);
  },

  archive(id: string): Promise<ReferenceFolderRecord> {
    return api.post<ReferenceFolderRecord>(`/reference-folders/${id}/archive`);
  },

  /**
   * Flat file list for one reference folder, backing the `@alias` drill-down.
   * Paths are relative to the reference's root; the composer joins them onto
   * `absolutePath` for the chip.
   */
  tree(id: string): Promise<ReferenceTreeResponse> {
    return api.get<ReferenceTreeResponse>(`/reference-folders/${id}/tree`);
  },

  /** Reference folders visible from a session's workspace, for the picker. */
  forSession(sessionId: string): Promise<{ referenceFolders: SessionReferenceFolder[] }> {
    return api.get<{ referenceFolders: SessionReferenceFolder[] }>(
      `/sessions/${sessionId}/reference-folders`,
    );
  },

  /** Who points at this workspace. References are one-way, so this is the
   *  only way a workspace learns it is being read. */
  referencedBy(workspaceId: string): Promise<{ referencedBy: ReferencedByEntry[] }> {
    return api.get<{ referencedBy: ReferencedByEntry[] }>(
      `/workspaces/${workspaceId}/referenced-by`,
    );
  },
};

export interface ReferencedByEntry {
  id: string;
  alias: string;
  /** Null when the reference is global — every workspace sees it. */
  workspaceId: string | null;
  workspaceName: string | null;
}

export interface ReferenceTreeResponse {
  entries: TreeEntry[];
  /** True when the folder was larger than the listing cap. */
  truncated: boolean;
}

/** The slim shape the composer's picker needs. */
export interface SessionReferenceFolder {
  id: string;
  alias: string;
  absolutePath: string;
  exists: boolean;
}
