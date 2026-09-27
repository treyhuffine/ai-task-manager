'use client';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { documentSaves, draftDisposition } from '@/lib/client/document-saves';

export function useDocumentAutosave<Input extends { id: string }>(
  kind: 'notes' | 'tasks' | 'areas', id: string | null | undefined,
  entity: object | null | undefined, writer: (input: Input) => Promise<unknown>,
) {
  const key = id ? `${kind}:${id}` : null;
  const current = useRef(entity);
  useEffect(() => { current.current = entity; }, [entity]);
  const recovered = useRef<string | null>(null);
  const save = useCallback((patch: Omit<Input, 'id'>) => {
    if (!key || !id) return;
    try {
      documentSaves.schedule(key, patch, (current.current ?? {}) as Record<string, unknown>, delta => writer({ id, ...delta } as Input));
    } catch {
      toast.error('Could not retain your draft. Keep this window open until changes are saved.');
      void documentSaves.flush(key).catch(() => {});
    }
  }, [id, key, writer]);

  useEffect(() => {
    if (!key || !entity || recovered.current === key) return;
    recovered.current = key;
    if (documentSaves.has(key)) return;
    try {
      const draft = documentSaves.draft(key);
      if (!draft) return;
      const action = draftDisposition(draft, entity as Record<string, unknown>);
      if (action === 'saved') documentSaves.discard(key);
      // Matching the old base does not prove the draft is still current. The
      // server may have been edited back to that value, or an acknowledged
      // draft may have survived a denied storage cleanup. Recover explicitly.
      else toast.warning(action === 'conflict'
        ? 'A retained draft differs from the saved document.'
        : 'A retained draft is available for this document.', {
        duration: Infinity,
        action: { label: 'Restore draft', onClick: () => save(draft.patch as Omit<Input, 'id'>) },
        cancel: { label: 'Discard draft', onClick: () => {
          try { documentSaves.discard(key); }
          catch { toast.error('Could not discard the retained draft. It was left in storage.'); }
        } },
      });
    } catch { toast.error('Could not read the retained draft. It was left in storage.'); }
  }, [key, entity, save]);

  useEffect(() => () => { if (key) void documentSaves.flush(key).catch(() => {}); }, [key]);
  return save;
}
