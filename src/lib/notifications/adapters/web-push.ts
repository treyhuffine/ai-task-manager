/**
 * Web-push adapter (spec §2.11/§2.16). A `web_push` channel represents "all this user's browsers";
 * `deliver()` fans out to every stored subscription, prunes dead ones (404/410), and reports
 * **sent if ≥1** subscription accepted (else throws → the delivery row is marked failed).
 */
import webpush from 'web-push';
import { listWebPushSubscriptions, deleteWebPushSubscriptionByEndpoint } from '@/lib/db/queries';
import type { NotificationChannelAdapter, RenderedNotification } from '../types';
import { configureWebPush } from '../web-push/vapid';
import { fitText } from '../message-text';

/** A push service must accept 4,096 bytes. Encryption (aes128gcm) takes 103 of them. */
export const WEB_PUSH_PAYLOAD_MAX = 4096 - 103;

/** The payload, its body fitted so no push service refuses it for size. The OS trims what it shows. */
export function webPushPayload({ title, body, url }: RenderedNotification): string {
  const payload = (text: string) => JSON.stringify({ title, body: text, url });
  return payload(fitText(body, WEB_PUSH_PAYLOAD_MAX, (text) => Buffer.byteLength(payload(text), 'utf8')));
}

export const webPushAdapter: NotificationChannelAdapter = {
  kind: 'web_push',

  async deliver(channel, rendered) {
    const subscriptions = listWebPushSubscriptions(channel.userId);
    if (subscriptions.length === 0) throw new Error('no web push subscriptions for this user');

    configureWebPush();
    const payload = webPushPayload(rendered);

    let sent = 0;
    const errors: string[] = [];
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            deleteWebPushSubscriptionByEndpoint(s.endpoint); // expired/gone → prune
          } else {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }),
    );

    if (sent === 0) {
      throw new Error(
        `web push reached 0/${subscriptions.length} subscriptions${errors.length ? `: ${errors[0]}` : ' (all expired/pruned)'}`,
      );
    }
    return {};
  },
};
