'use client';

/**
 * Trigger detail at /triggers/<id>: a header over `TriggerDetail`, the same
 * view the Schedules window shows beside the schedule's builder chat. Every
 * field edits in place.
 */

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTrigger } from '@/hooks/use-triggers';
import { describeFrequency } from '@/lib/scheduler/frequency';
import { isReservedTrigger } from '@/lib/triggers/reserved';
import { AwakeNote } from '@/components/triggers/awake-note';
import { TriggerDetail } from '@/components/triggers/trigger-detail';

export default function TriggerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { data: trigger, isLoading } = useTrigger(id ?? null);

  if (isLoading || !trigger || !id) {
    return (
      <div className="min-h-dvh bg-background text-foreground flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const managed = isReservedTrigger(id);

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          onClick={() => router.push('/triggers')}
          aria-label="Back to schedules"
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold truncate">{trigger.name}</h1>
            {managed && (
              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded-md bg-muted text-muted-foreground">
                Managed
              </span>
            )}
          </div>
          {trigger.description && (
            <p className="text-[12px] text-muted-foreground truncate">
              {trigger.description}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {describeFrequency({
              kind: trigger.kind,
              cronExpression: trigger.cronExpression,
              intervalSeconds: trigger.intervalSeconds,
              runAt: trigger.runAt,
              timezone: trigger.timezone,
            })}
            {trigger.enabled ? '' : ' · paused'}
          </p>
          {trigger.kind !== 'manual' && <AwakeNote />}
        </div>
      </header>

      <main className="px-6 py-6 max-w-3xl mx-auto">
        <TriggerDetail trigger={trigger} onDeleted={() => router.push('/triggers')} />
      </main>
    </div>
  );
}
