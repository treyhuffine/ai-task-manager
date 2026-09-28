'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureStorage, type CaptureDraftSession, type CaptureDraftSummary, type CaptureDraftValue } from '@/lib/client/capture-storage';
import { registerCaptureWriter, retainCaptureDraft } from '@/lib/client/capture-draft';

const empty = (): CaptureDraftValue => ({ text: '', usedVoice: false, files: [], submission: 'editing' });
const hasContent = (value: CaptureDraftValue) => !!value.text || value.files.length > 0;
const message = (error: unknown) => error instanceof Error ? error.message : 'Device storage is unavailable.';

type SaveState = { phase: 'loading' | 'saving' | 'saved' | 'error'; error?: string };

/** The live composer stays authoritative. Recovery is always an explicit
 * choice, and acknowledged captures are never automatically submitted again. */
export function useCaptureDraft(open: boolean) {
  const [value, setValue] = useState<CaptureDraftValue>(empty);
  const current = useRef(value);
  const [previews, setPreviews] = useState<{ id: string; file: File }[]>([]);
  const updateValue = useCallback((next: CaptureDraftValue) => {
    current.current = next; setValue(next);
    setPreviews(previous => {
      const available = new Map<File, string[]>();
      for (const entry of previous) available.set(entry.file, [...(available.get(entry.file) ?? []), entry.id]);
      return next.files.map(file => ({ file, id: available.get(file)?.shift() ?? crypto.randomUUID() }));
    });
  }, []);
  const session = useRef<CaptureDraftSession | undefined>(undefined);
  const owner = useRef({});
  const mounted = useRef(false);
  const revision = useRef(0);
  const dirty = useRef(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const missing = useRef<string[]>([]);
  const [missingFiles, setMissingFiles] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>({ phase: 'loading' });
  const [recoveries, setRecoveries] = useState<CaptureDraftSummary[]>([]);
  const [recoveryError, setRecoveryError] = useState<string>();
  const [recovering, setRecovering] = useState(false);

  const refreshRecoveries = useCallback(async () => {
    try {
      const values = await captureStorage.recoverable();
      if (mounted.current) { setRecoveries(values); setRecoveryError(undefined); }
    } catch (error) { if (mounted.current) setRecoveryError(message(error)); }
  }, []);

  const persist = useCallback((next: CaptureDraftValue): Promise<void> => {
    const serial = ++revision.current;
    dirty.current = true;
    updateValue(next); setSave({ phase: 'saving' });
    retainCaptureDraft(owner.current, true);
    const operation = missing.current.length
      ? Promise.reject(new Error('Review the missing images before saving this recovered capture.'))
      : session.current ? session.current.save(next) : Promise.reject(new Error('Device storage is unavailable. Keep this window open and retry.'));
    pending.current = operation;
    void operation.then(() => {
      if (!mounted.current || serial !== revision.current) return;
      dirty.current = false; retainCaptureDraft(owner.current, false); setSave({ phase: 'saved' });
    }, error => {
      if (mounted.current && serial === revision.current) setSave({ phase: 'error', error: message(error) });
    });
    return operation;
  }, [updateValue]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const unregister = registerCaptureWriter(owner.current, () => pending.current);
    const revisions = revision;
    void (async () => {
      await refreshRecoveries();
      try {
        const created = await captureStorage.create();
        if (cancelled) { created.release(); return; }
        session.current = created;
        if (dirty.current) void persist(current.current).catch(() => {});
        else setSave({ phase: 'saved' });
      } catch (error) { if (!cancelled) setSave({ phase: 'error', error: message(error) }); }
    })();
    return () => {
      cancelled = true; mounted.current = false; revisions.current++;
      session.current?.release(); session.current = undefined; unregister();
    };
  }, [refreshRecoveries, persist]);

  useEffect(() => { if (open) void refreshRecoveries(); }, [open, refreshRecoveries]);


  const edit = useCallback((patch: Partial<CaptureDraftValue>) => {
    void persist({ ...current.current, ...patch }).catch(() => {});
  }, [persist]);

  const retry = useCallback(async () => {
    setRecovering(true);
    try {
      if (!session.current) session.current = await captureStorage.create();
      await persist(current.current);
    } catch (error) { setSave({ phase: 'error', error: message(error) }); }
    finally { setRecovering(false); }
  }, [persist]);

  const clear = useCallback(async () => {
    ++revision.current;
    // The storage tombstone precedes asynchronous blob cleanup. Keep the
    // visible draft if storage refuses the explicit discard.
    await session.current?.discard();
    session.current?.release(); session.current = undefined;
    updateValue(empty()); dirty.current = false;
    pending.current = Promise.resolve();
    missing.current = []; setMissingFiles([]); retainCaptureDraft(owner.current, false);
    setSave({ phase: 'loading' });
    try { session.current = await captureStorage.create(); setSave({ phase: 'saved' }); }
    catch (error) { setSave({ phase: 'error', error: message(error) }); }
    await refreshRecoveries();
  }, [refreshRecoveries, updateValue]);

  const discard = useCallback(async () => {
    setRecovering(true);
    try { await clear(); return true; }
    catch (error) { setSave({ phase: 'error', error: message(error) }); retainCaptureDraft(owner.current, dirty.current); return false; }
    finally { setRecovering(false); }
  }, [clear]);

  const restore = useCallback(async (id: string) => {
    if (hasContent(current.current)) return;
    setRecovering(true);
    try {
      const recovered = await captureStorage.restore(id);
      try { await session.current?.discard(); } catch { /* An empty reserved slot is recovered separately. */ }
      session.current?.release(); session.current = recovered.session;
      ++revision.current; pending.current = Promise.resolve();
      updateValue(recovered.draft);
      missing.current = recovered.missingFiles; setMissingFiles(recovered.missingFiles);
      dirty.current = recovered.missingFiles.length > 0;
      retainCaptureDraft(owner.current, dirty.current);
      setSave(recovered.missingFiles.length ? { phase: 'error', error: 'Some images could not be recovered. Review the list below.' } : { phase: 'saved' });
      await refreshRecoveries();
    } catch (error) { setRecoveryError(message(error)); }
    finally { setRecovering(false); }
  }, [refreshRecoveries, updateValue]);

  const discardSaved = useCallback(async (id: string) => {
    setRecovering(true);
    let recovered: CaptureDraftSession | undefined;
    try { recovered = (await captureStorage.restore(id)).session; await recovered.discard(); await refreshRecoveries(); }
    catch (error) { setRecoveryError(message(error)); }
    finally { recovered?.release(); setRecovering(false); }
  }, [refreshRecoveries]);

  const acceptRecoveredFiles = useCallback(() => {
    missing.current = []; setMissingFiles([]); void persist(current.current).catch(() => {});
  }, [persist]);

  const markSubmitting = useCallback(async () => {
    // Save the uncertain state before the request. A crash after the server
    // accepted it must offer review, not automatic replay or claimed failure.
    const previous = current.current.submission;
    const operation = persist({ ...current.current, submission: 'uncertain' });
    const serial = revision.current;
    try { await operation; }
    catch (error) {
      // No request was sent. Keep the save failure and guard, but do not label
      // a new capture as an uncertain submission in the live composer.
      if (serial === revision.current) updateValue({ ...current.current, submission: previous });
      throw error;
    }
  }, [persist, updateValue]);

  return { value, previews, edit, save, recoveries, recoveryError, recovering, missingFiles, restore, discardSaved, discard,
    retry, refreshRecoveries, acceptRecoveredFiles, markSubmitting, acknowledge: clear };
}
