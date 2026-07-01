'use client';

/**
 * `/triggers/new` — full-page wrapper around
 * `<TriggerCreateForm>`. Kept for deep linking; the rail's Triggers
 * modal renders the same form inline without a page navigation.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  TriggerCreateForm,
  WebhookCredentialsPanel,
  type WebhookCredentials,
} from '@/components/triggers/trigger-create-form';
import type { TriggerRecord } from '@/db/types';

export default function NewTriggerPage() {
  const router = useRouter();
  const [createdWebhook, setCreatedWebhook] = useState<WebhookCredentials | null>(null);

  function handleCreated(trigger: TriggerRecord, webhook?: WebhookCredentials) {
    if (webhook) {
      setCreatedWebhook(webhook);
      return;
    }
    router.push(`/triggers/${trigger.id}`);
  }

  if (createdWebhook) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-lg w-full border border-border rounded-lg p-6 bg-card">
          <WebhookCredentialsPanel
            publicId={createdWebhook.publicId}
            secret={createdWebhook.secret}
            onContinue={() => router.push('/triggers')}
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
          onClick={() => router.push('/triggers')}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-base font-semibold">Create scheduled task</h1>
      </header>

      <div className="px-6 py-8 max-w-xl mx-auto">
        <TriggerCreateForm
          onCreated={handleCreated}
          onCancel={() => router.push('/triggers')}
        />
      </div>
    </div>
  );
}
