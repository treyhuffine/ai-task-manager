'use client';

/**
 * Creating a schedule: `TriggerForm` with no schedule, plus the panel that
 * shows a new webhook's credentials once. Used by the Schedules window and
 * the /triggers/new page.
 */

import { cn } from '@/lib/utils';
import { TriggerForm, type TriggerFormProps, type WebhookCredentials } from './trigger-form';

export type { WebhookCredentials };

export function TriggerCreateForm({ onCreated, onCancel }: Pick<TriggerFormProps, 'onCreated' | 'onCancel'>) {
  return <TriggerForm onCreated={onCreated} onCancel={onCancel} />;
}

// ── Webhook credentials panel ────────────────────────────────
//
// Co-located here because both the page and the modal use it after a
// successful webhook create.

export function WebhookCredentialsPanel({
  publicId,
  secret,
  onContinue,
}: {
  publicId: string;
  secret: string;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Webhook ready</h2>
      <p className="text-sm text-muted-foreground">
        Save the secret below. It&apos;s shown once and never displayed
        again. Sign each request body with HMAC-SHA256 using this
        secret and send the hex as <code className="font-mono">X-Signature</code>,
        plus the plaintext as <code className="font-mono">X-Webhook-Secret</code>.
      </p>
      <CredentialRow label="Public ID" value={publicId} />
      <CredentialRow label="Secret" value={secret} mono />
      <div className="p-3 rounded-md bg-muted text-[12px] text-muted-foreground space-y-1">
        <p>Endpoint:</p>
        <code className="font-mono break-all">POST /api/webhooks/triggers/{publicId}</code>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
      >
        I&apos;ve saved the secret, continue
      </button>
    </div>
  );
}

function CredentialRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <code
          className={cn(
            'flex-1 px-2 py-1.5 rounded border border-border bg-background break-all',
            mono ? 'font-mono text-xs' : 'text-sm',
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(value)}
          className="px-2 py-1.5 rounded-md text-xs border border-border hover:bg-muted"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
