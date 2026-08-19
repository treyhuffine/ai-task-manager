'use client';

import { useState } from 'react';
import { CornerDownLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeCustomModelId, type ModelOption, type ProviderId } from '@/lib/agent-options';
import { useAddCustomModel } from '@/hooks/use-agent-harnesses';

/**
 * Type an exact provider model id and use it immediately.
 *
 * The catalog can only ever offer what a provider has published to it, and
 * Claude's entries are deliberately tier aliases (`opus` means "the best
 * current Opus"). Pinning is the one way to say a specific build — day-one
 * access to something the catalog hasn't picked up, or holding a version
 * steady while a new one lands. Saving also selects it, because typing a model
 * id is already an unambiguous statement of which model you want.
 */
export function PinModelInput({
  providerId,
  disabled,
  onPinned,
}: {
  providerId: ProviderId;
  disabled?: boolean;
  onPinned: (model: ModelOption) => void;
}) {
  const [value, setValue] = useState('');
  const add = useAddCustomModel();
  const modelId = normalizeCustomModelId(value);
  const malformed = value.trim().length > 0 && !modelId;

  const submit = async () => {
    if (!modelId || add.isPending) return;
    try {
      const { model } = await add.mutateAsync({ harness: providerId, modelId });
      setValue('');
      onPinned(model);
    } catch (error) {
      toast.error(`Could not pin ${modelId}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    // Deliberately not a <form>: this input is dropped inside hosts that are
    // already forms (the trigger composer) and inside popovers that don't
    // portal. A nested form tag is discarded by the parser, which would hand
    // the submit to the OUTER form and create a trigger instead of a pin.
    <div className="mb-1 rounded-md border border-dashed border-border px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          disabled={disabled || add.isPending}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Stop it reaching an enclosing form or a parent list's key
            // handling; this input owns Enter while it has focus.
            event.preventDefault();
            event.stopPropagation();
            void submit();
          }}
          placeholder="claude-opus-4-8"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || !modelId || add.isPending}
          title="Pin this model ID and use it"
          onClick={() => void submit()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {add.isPending ? <Loader2 size={10} className="animate-spin" /> : <CornerDownLeft size={10} />}
          Pin
        </button>
      </div>
      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">
        {malformed
          ? 'Model IDs have no spaces, for example claude-opus-4-8'
          : 'Sends this exact ID instead of a tier alias. Unpin it any time.'}
      </p>
    </div>
  );
}
