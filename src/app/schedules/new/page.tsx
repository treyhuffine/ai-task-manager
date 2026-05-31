'use client';

/**
 * `/schedules/new` — full-page wrapper around
 * `<ScheduleCreateForm>`. Kept for deep linking; the rail's Schedules
 * modal renders the same form inline without a page navigation.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  ScheduleCreateForm,
  WebhookCredentialsPanel,
  type WebhookCredentials,
} from '@/components/schedules/schedule-create-form';
import type { ScheduleRecord } from '@/db/types';

export default function NewSchedulePage() {
  const router = useRouter();
  const [createdWebhook, setCreatedWebhook] = useState<WebhookCredentials | null>(null);

  function handleCreated(schedule: ScheduleRecord, webhook?: WebhookCredentials) {
    if (webhook) {
      setCreatedWebhook(webhook);
      return;
    }
    router.push(`/schedules/${schedule.id}`);
  }

  if (createdWebhook) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-lg w-full border border-border rounded-lg p-6 bg-card">
          <WebhookCredentialsPanel
            publicId={createdWebhook.publicId}
            secret={createdWebhook.secret}
            onContinue={() => router.push('/schedules')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          type="button"
          onClick={() => router.push('/schedules')}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-base font-semibold">Create scheduled task</h1>
      </header>

      <div className="px-6 py-8 max-w-xl mx-auto">
        <ScheduleCreateForm
          onCreated={handleCreated}
          onCancel={() => router.push('/schedules')}
        />
      </div>
    </div>
  );
}
