'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { EmailDraft } from '@/db/types';
import { trpcClient } from '@/lib/trpc/client';
import { emailDraftPatchSchema, type EmailDraftFields } from '@/lib/email/validation';

type Patch = Partial<EmailDraftFields>;

/** Coalesce edits during a save, serialize writes, and retain unsaved input after failures. */
export function useEmailDraft(id: string, sessionId: string, incoming: EmailDraft) {
  const [acknowledged, setAcknowledged] = useState(incoming);
  const [edits, setEdits] = useState<Patch>({});
  const [conflict, setConflict] = useState<EmailDraft | null>(null);
  const base = useRef(incoming);
  const pending = useRef<Patch>({});
  const local = useRef<Patch>({});
  const running = useRef(false);
  const storageKey = `email-draft:${sessionId}:${id}`;
  const confirmed = incoming.revision > acknowledged.revision ? incoming : acknowledged;
  // A sent card must show what was actually sent, never an unsaved local overlay.
  const draft = confirmed.status === 'draft' ? { ...confirmed, ...edits } : confirmed;

  useEffect(() => {
    // An in-flight edit stays based on what the human actually saw. Adopting
    // a live AI revision here would silently rebase and overwrite its edits.
    if (!running.current && !Object.keys(local.current).length && incoming.revision > base.current.revision) base.current = incoming;
  }, [incoming]);

  const persist = () => {
    try {
      if (Object.keys(local.current).length) sessionStorage.setItem(storageKey, JSON.stringify({ revision: base.current.revision, patch: local.current }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The active mutation still protects input when storage is unavailable. */ }
  };

  useEffect(() => {
    // Restore only this tab's unsaved input. It remains local until the user retries saving.
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const parsed = emailDraftPatchSchema.safeParse(saved?.patch);
      if (parsed.success && Object.keys(parsed.data).length) {
        local.current = pending.current = parsed.data;
        setEdits(parsed.data);
        if (saved.revision !== incoming.revision) setConflict(incoming);
      }
    } catch { /* A malformed local recovery copy is ignored. */ }
  // A card's identity is fixed for its mounted lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const save = useMutation({
    meta: { carriesInput: true },
    retry: false,
    mutationFn: async () => {
      running.current = true;
      try {
        while (Object.keys(pending.current).length) {
          const patch = pending.current;
          pending.current = {};
          try {
            const result = await trpcClient.email.update.mutate({ id, sessionId, expectedRevision: base.current.revision, patch });
            if (result.draft.revision > base.current.revision) base.current = result.draft;
            setAcknowledged(previous => result.draft.revision > previous.revision ? result.draft : previous);
            for (const key of Object.keys(patch) as (keyof EmailDraftFields)[]) {
              if (local.current[key] === patch[key]) delete local.current[key];
            }
            setEdits({ ...local.current });
            persist();
          } catch (error) {
            pending.current = { ...patch, ...pending.current };
            throw error;
          }
        }
      } finally { running.current = false; }
    },
    onError: async () => {
      const latest = await trpcClient.email.get.query({ id, sessionId }).catch(() => null);
      if (latest && latest.draft.revision !== base.current.revision) setConflict(latest.draft);
    },
  });

  const change = (patch: Patch) => {
    if (!running.current && !Object.keys(local.current).length && confirmed.revision > base.current.revision) base.current = confirmed;
    pending.current = { ...pending.current, ...patch };
    local.current = { ...local.current, ...patch };
    setEdits({ ...local.current });
    persist();
    if (!running.current && !save.isPending && !save.isError && !conflict) {
      running.current = true;
      save.mutate();
    }
  };

  const resolve = async (keepEdits: boolean) => {
    const latest = await trpcClient.email.get.query({ id, sessionId });
    base.current = latest.draft;
    setAcknowledged(latest.draft);
    setConflict(null);
    save.reset();
    if (keepEdits && latest.draft.status === 'draft') {
      running.current = true;
      save.mutate();
    } else {
      pending.current = local.current = {};
      setEdits({});
      persist();
    }
  };

  const accept = (next: EmailDraft) => {
    base.current = next;
    setAcknowledged(next);
  };
  return { draft, confirmed, edits, conflict, save, change, resolve, accept, hasEdits: Object.keys(edits).length > 0 };
}
