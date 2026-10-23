'use client';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { documentSaves, draftDisposition } from '@/lib/client/document-saves';
import { useOptionalHomeContext } from '@/components/home/home-context';
import { documentCredential } from '@/lib/home/document-binding';
import { homeDocumentKey, assertDocumentCredential } from '@/lib/home/document-scope';
import { getAuthToken } from '@/lib/api/client';

function useDocumentKey(kind: string, id: string | null | undefined, author?: { homeId: string; viewerId: string }) {
  const context = useOptionalHomeContext();
  const dataset = typeof document !== 'undefined' ? document.documentElement.dataset : null;
  const scope = author ?? (context ? { homeId: context.home.id, viewerId: context.viewer.id }
    : dataset?.riHome && dataset.riViewer ? { homeId: dataset.riHome, viewerId: dataset.riViewer } : null);
  return id ? homeDocumentKey(kind, id, scope) : null;
}

/** Keep current-session edits visible through rollback, blur and refetch. The
 * shared query cache still represents the server, and older retained drafts
 * remain untouched until the person explicitly restores them. */
export function usePendingDocument<Entity extends object>(
  kind: 'notes' | 'tasks' | 'areas', id: string | null | undefined,
  entity: Entity | null | undefined,
): Entity | null | undefined {
  const key = useDocumentKey(kind, id);
  const subscribe = useCallback((listener: () => void) => key ? documentSaves.subscribe(key, listener) : () => {}, [key]);
  const snapshot = useCallback(() => key ? documentSaves.pendingPatch(key) : undefined, [key]);
  const patch = useSyncExternalStore(subscribe, snapshot, () => undefined);
  return useMemo(() => entity && patch ? { ...entity, ...patch } : entity, [entity, patch]);
}

export function useDocumentAutosave<Input extends { id: string }>(
  kind: 'notes' | 'tasks' | 'areas', id: string | null | undefined,
  entity: object | null | undefined, writer: (input: Input) => Promise<unknown>,
  author?: { homeId: string; viewerId: string },
) {
  const context = useOptionalHomeContext();
  const key = useDocumentKey(kind, id, author);
  const personal = !author && (context?.home.kind === 'personal' || (typeof document !== 'undefined' && document.documentElement.dataset.riAuthority === 'personal'));
  const credential = documentCredential(getAuthToken());
  const current = useRef(entity);
  useEffect(() => { current.current = entity; }, [entity]);
  const recovered = useRef<string | null>(null);
  const restoredLegacy = useRef<{ key: string; destination: string; snapshot: string } | null>(null);
  const save = useCallback((patch: Omit<Input, 'id'>) => {
    if (!key || !id) return;
    try {
      documentSaves.schedule(key, patch, (current.current ?? {}) as Record<string, unknown>, async delta => {
        assertDocumentCredential(credential, documentCredential(getAuthToken()));
        const legacy = restoredLegacy.current?.destination === key ? restoredLegacy.current : null;
        const result = await writer({ id, ...delta } as Input);
        if (legacy) {
          // Only the acknowledged restore retires its old copy. A concurrent
          // legacy editor may have replaced it while this request was in flight.
          try {
            if (JSON.stringify(documentSaves.draft(legacy.key)) === legacy.snapshot) documentSaves.discard(legacy.key);
          } catch { /* Retain the old draft for explicit recovery. */ }
          if (restoredLegacy.current === legacy) restoredLegacy.current = null;
        }
        return result;
      });
    } catch {
      toast.error('Could not retain your draft. Keep this window open until changes are saved.');
      void documentSaves.flush(key).catch(() => {});
    }
  }, [id, key, writer, credential]);

  useEffect(() => {
    if (!key || !entity || recovered.current === key) return;
    recovered.current = key;
    if (documentSaves.has(key)) return;
    try {
      const legacyKey = `${kind}:${id}`;
      // Keep old personal drafts recoverable by an explicit restore. A team
      // never reads an unscoped draft, whose original audience is unknown.
      const scopedDraft = documentSaves.draft(key);
      const draft = scopedDraft ?? (personal ? documentSaves.draft(legacyKey) : null);
      const retainedKey = scopedDraft ? key : legacyKey;
      if (!draft) return;
      const action = draftDisposition(draft, entity as Record<string, unknown>);
      if (action === 'saved') documentSaves.discard(retainedKey);
      // Matching the old base does not prove the draft is still current. The
      // server may have been edited back to that value, or an acknowledged
      // draft may have survived a denied storage cleanup. Recover explicitly.
      else toast.warning(action === 'conflict'
        ? 'A retained draft differs from the saved document.'
        : 'A retained draft is available for this document.', {
        duration: Infinity,
        action: { label: 'Restore draft', onClick: () => {
          if (retainedKey !== key) restoredLegacy.current = { key: retainedKey, destination: key, snapshot: JSON.stringify(draft) };
          save(draft.patch as Omit<Input, 'id'>);
        } },
        cancel: { label: 'Discard draft', onClick: () => {
          try { documentSaves.discard(retainedKey); }
          catch { toast.error('Could not discard the retained draft. It was left in storage.'); }
        } },
      });
    } catch { toast.error('Could not read the retained draft. It was left in storage.'); }
  }, [key, entity, save, personal, kind, id]);

  useEffect(() => () => { if (key) void documentSaves.flush(key).catch(() => {}); }, [key]);
  return save;
}
