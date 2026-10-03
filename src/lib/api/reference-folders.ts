import type {
	CreateReferenceFolderInput,
	UpdateReferenceFolderInput
} from '@/db/types';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import type { RouterOutputs } from '@/lib/trpc/router';

export const referenceFoldersApi = {
  /**
   * Rows visible from a workspace: its own plus every global one, already
   * resolved to absolute paths with existence and git state attached.
   * Omit `workspaceId` for the global rows alone.
   */
  list(workspaceId?: string | null) {
    return trpcClient.referenceFolders.list.query({query: rpcQuery(workspaceId ? { workspaceId } : undefined)});
  },

  create(input: CreateReferenceFolderInput) {
    return trpcClient.referenceFolders.create.mutate({body: input});
  },

  update(id: string, input: UpdateReferenceFolderInput) {
    return trpcClient.referenceFolders.update.mutate({params: {id: id}, body: input});
  },

  archive(id: string) {
    return trpcClient.referenceFolders.archivePost.mutate({params: {id: id}});
  },

  /**
   * Flat file list for one reference folder, backing the `@alias` drill-down.
   * Paths are relative to the reference's root; the composer joins them onto
   * `absolutePath` for the chip.
   */
  tree(id: string) {
    return trpcClient.referenceFolders.treeGet.query({params: {id: id}});
  },

  /** Reference folders visible from a session's workspace, for the picker. */
  forSession(sessionId: string) {
    return trpcClient.sessions.referenceFoldersGet.query({params: {id: sessionId}});
  },

  /** Who points at this workspace. References are one-way, so this is the
   *  only way a workspace learns it is being read. */
  referencedBy(workspaceId: string) {
    return trpcClient.workspaces.referencedByGet.query({params: {id: workspaceId}});
  },
};

export type ReferencedByEntry = RouterOutputs['workspaces']['referencedByGet']['referencedBy'][number];

export type ReferenceTreeResponse = RouterOutputs['referenceFolders']['treeGet'];

/** The slim shape the composer's picker needs. */
export type SessionReferenceFolder = RouterOutputs['sessions']['referenceFoldersGet']['referenceFolders'][number];
