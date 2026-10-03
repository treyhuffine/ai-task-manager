'use client';

import { useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { APP_NAME } from '@/constants/app';
import { useUserState } from '@/hooks/use-user-state';
import { IdentityEditor, draftFromState, useSaveIdentity, type IdentityDraft } from './identity-editor';

/**
 * The orchestrator's name and look in a dialog, for the pencil on the rail's
 * home row. Module-level open state, like the launcher and settings, so the
 * rail opens it without threading a handle through the tree. Mounted once on
 * the dashboard.
 */

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openIdentityDialog(): void {
  if (open) return;
  open = true;
  emit();
}

function closeIdentityDialog(): void {
  if (!open) return;
  open = false;
  emit();
}

function useIdentityDialogOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
}

export function IdentityDialog() {
  const isOpen = useIdentityDialogOpen();
  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && closeIdentityDialog()}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so each open starts from what's stored. */}
        {isOpen && <IdentityDialogBody />}
      </DialogContent>
    </Dialog>
  );
}

function IdentityDialogBody() {
  const { data: userState } = useUserState();
  const [draft, setDraft] = useState<IdentityDraft>(() => draftFromState(userState));
  const { save, saving } = useSaveIdentity();

  const submit = async () => {
    if (await save(draft)) closeIdentityDialog();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Your assistant</DialogTitle>
        <DialogDescription>
          Its name and how it looks across {APP_NAME}. It answers to a new name from its next reply.
        </DialogDescription>
      </DialogHeader>
      <IdentityEditor draft={draft} onChange={setDraft} onSubmit={() => void submit()} autoFocusName />
      <DialogFooter>
        <button
          type="button"
          onClick={closeIdentityDialog}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
      </DialogFooter>
    </>
  );
}
