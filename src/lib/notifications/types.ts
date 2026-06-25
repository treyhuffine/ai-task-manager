/**
 * Notifier runtime types (spec §2.2). The EVENT is presentation-neutral domain data the emission
 * point hands to `notify()`; the RENDERED notification is what an adapter actually sends. Keeping
 * them separate is the rule — don't pre-bake channel-specific text into the event.
 */
import type { NotificationChannelRecord } from '@/db/types';
import type { NotificationEventType } from './events';

export interface NotificationEvent {
  type: NotificationEventType;
  userId: string;
  /** Stable per occurrence ("execution.finished:<runId>") — idempotency across re-fires (§2.16). */
  dedupeKey: string;
  title: string;
  /** Human detail; for execution.finished this is the run summary. */
  body: string;
  /** Relative app deep link ("/executions/<id>"); `render()` resolves an absolute base for external channels. */
  url: string;
  /** Optional structured extras a richer channel could format from. */
  [key: string]: unknown;
}

export interface RenderedNotification {
  title: string;
  body: string;
  /** Resolved per channel: absolute for external (Telegram), relative for same-origin (web push). */
  url: string;
}

export interface DeliveryResult {
  /** Provider's message id when available (e.g. Telegram message_id), for later correlation. */
  providerMessageId?: string;
}

/**
 * One adapter per channel target, resolved by `(kind, providerId)` (spec §2.17). `validateConfig`
 * guards the channel's `config` shape; `deliver` maps the rendered notification to the channel's
 * transport. Shared `render()` (render.ts) handles the neutral shape + deep-link base resolution.
 */
export interface NotificationChannelAdapter {
  kind: NotificationChannelRecord['kind'];
  /** Present for connector adapters (telegram/slack/…); absent for web_push/in_app. */
  providerId?: string;
  validateConfig?(channel: NotificationChannelRecord): void;
  deliver(channel: NotificationChannelRecord, rendered: RenderedNotification): Promise<DeliveryResult>;
}
