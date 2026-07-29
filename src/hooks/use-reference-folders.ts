import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { referenceFoldersApi } from '@/lib/api/reference-folders';
import type { FileMentionItem } from '@/components/chat/editor/mention-menu/types';
import type { CreateReferenceFolderInput, UpdateReferenceFolderInput } from '@/db/types';

const REFERENCE_FOLDERS_KEY = ['reference-folders'] as const;

/**
 * Reference folders visible from a workspace (its own plus every global one).
 * Pass null for the global list alone.
 *
 * Git state and existence come back with the rows and go stale quickly by
 * nature — the folder is a live checkout somebody else may be committing to —
 * so this refetches on focus rather than trusting a long cache.
 */
export function useReferenceFolders(workspaceId: string | null) {
  return useQuery({
    queryKey: [...REFERENCE_FOLDERS_KEY, workspaceId],
    queryFn: () => referenceFoldersApi.list(workspaceId),
    staleTime: 10_000,
  });
}

/**
 * Invalidate every scope, not just the one that changed. A global reference is
 * visible from every workspace, so a write to one scope can change what
 * another workspace sees.
 */
function useInvalidateReferenceFolders() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: REFERENCE_FOLDERS_KEY });
}

export function useCreateReferenceFolder() {
  const invalidate = useInvalidateReferenceFolders();
  return useMutation({
    mutationFn: (input: CreateReferenceFolderInput) => referenceFoldersApi.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateReferenceFolder() {
  const invalidate = useInvalidateReferenceFolders();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateReferenceFolderInput & { id: string }) =>
      referenceFoldersApi.update(id, input),
    onSuccess: invalidate,
  });
}

export function useArchiveReferenceFolder() {
  const invalidate = useInvalidateReferenceFolders();
  return useMutation({
    mutationFn: (id: string) => referenceFoldersApi.archive(id),
    onSuccess: invalidate,
  });
}

/**
 * Who points at this workspace. Separate query key from the outbound list
 * because it answers the opposite question and changes for different reasons.
 */
export function useReferencedBy(workspaceId: string | null) {
  return useQuery({
    queryKey: [...REFERENCE_FOLDERS_KEY, 'referenced-by', workspaceId],
    queryFn: () => referenceFoldersApi.referencedBy(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

/**
 * Reference folders visible from a session's workspace, for the composer's
 * `@`-picker. Separate from `useReferenceFolders` because the composer only
 * knows its session id, and this shape is deliberately slim (no git probe).
 */
export function useSessionReferenceFolders(sessionId: string | null) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'reference-folders'],
    queryFn: () => referenceFoldersApi.forSession(sessionId!),
    enabled: !!sessionId,
    staleTime: 60_000,
  });
}

/**
 * Lazily fetch one reference folder's file list, cached through the query
 * client so a drill-down costs one request no matter how many keystrokes the
 * user types inside it.
 *
 * Returned as a plain async function rather than a hook result because the
 * caller is the Tiptap suggestion plugin, which lives outside React's render
 * cycle and asks for data imperatively.
 */
export function useLoadReferenceTree() {
  const qc = useQueryClient();
  return useCallback(
    async (referenceId: string): Promise<FileMentionItem[]> => {
      const res = await qc.fetchQuery({
        queryKey: [...REFERENCE_FOLDERS_KEY, referenceId, 'tree'],
        queryFn: () => referenceFoldersApi.tree(referenceId),
        // A reference folder is somebody else's checkout that could be
        // rebuilt under us, but re-listing on every drill-down would be
        // wasteful. Five minutes is long enough to feel instant while
        // browsing and short enough to notice a branch switch.
        staleTime: 5 * 60_000,
      });
      return res.entries.map((e) => ({ kind: e.kind, path: e.path, name: e.name }));
    },
    [qc],
  );
}
