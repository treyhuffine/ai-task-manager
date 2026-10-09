'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { useCreateArea } from '@/hooks/use-areas';
import { AreaSelect } from '@/components/shared/area-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * A team's Areas (docs/homes-spec.md §9.1): how the team organizes its
 * shared work. Any member makes, renames and retires them, and they grant
 * or hide nothing.
 */

export function NewAreaDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: (id: string) => void }) {
  const [name, setName] = useState('');
  const create = useCreateArea();
  const close = (next: boolean) => {
    if (!next) setName('');
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New area</DialogTitle>
          <DialogDescription>Everyone in the team sees it and can file work under it.</DialogDescription>
        </DialogHeader>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            create.mutate(
              { name: trimmed },
              {
                onSuccess: (area) => {
                  onCreated?.(area.id);
                  close(false);
                },
                onError: (err) => toast.error(apiErrorText(err)),
              },
            );
          }}
        >
          <label className="sr-only" htmlFor="new-team-area">Area name</label>
          <input
            id="new-team-area"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Garden, Taxes, Launch…"
            className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary/60"
          />
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Area picker on shared work, with New area… for the team. */
export function TeamAreaSelect({ value, onChange }: { value: string | null; onChange: (areaId: string | null) => void }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <AreaSelect value={value} onChange={onChange} onNewArea={() => setCreating(true)} />
      <NewAreaDialog open={creating} onOpenChange={setCreating} onCreated={onChange} />
    </>
  );
}
