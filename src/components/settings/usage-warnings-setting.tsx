'use client';

import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';

export function UsageWarningsSetting({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const preference = useUserState();
  const update = useUpdateUserState();
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={id} className={compact ? 'text-[11px]' : 'text-[12px] font-medium'}>Show usage warnings</label>
        {!compact && <p id={`${id}-description`} className="mt-0.5 text-[11px] text-muted-foreground">Highlight Usage when a subscription is nearly used up.</p>}
      </div>
      <Switch
        id={id}
        size="sm"
        checked={preference.data?.usageWarnings ?? true}
        disabled={!preference.isSuccess}
        aria-describedby={compact ? undefined : `${id}-description`}
        onCheckedChange={(usageWarnings) => update.mutate({ usageWarnings })}
      />
    </div>
  );
}
