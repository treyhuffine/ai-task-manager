'use client';

/**
 * A folder on one of the person's devices: typed, or chosen with Browse,
 * which lists that device's folders from wherever this screen is
 * (docs/homes-spec.md §4.2). A device that isn't running Ri can't be
 * browsed, and a typed path is checked there when it's back.
 */

import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderPickerDialog } from '@/components/workspaces/folder-picker-dialog';
import { Tip } from '@/components/ui/tip';

export function FolderField({
  value,
  onChange,
  device,
  browsable,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (folder: string) => void;
  device: { id: string; name: string };
  browsable: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <div className="flex min-w-0 gap-2">
        <Input
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-8 min-w-0 flex-1 font-mono text-[12px]"
        />
        <Tip label={browsable ? undefined : `${device.name} isn't running Ri right now. Type the path instead.`}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setPicking(true);
            }}
            disabled={!browsable}
            className="h-8 shrink-0 gap-1.5 text-[12px]"
          >
            <FolderOpen size={13} />
            Browse
          </Button>
        </Tip>
      </div>
      <FolderPickerDialog
        open={picking}
        onOpenChange={setPicking}
        device={device}
        initialPath={value.trim() || undefined}
        onChoose={onChange}
      />
    </>
  );
}
