/**
 * Web-push adapter (spec §2.11/§2.16). A `web_push` channel represents "all this user's browsers";
 * `deliver()` fans out to every stored subscription, prunes dead ones (404/410), and reports
 * **sent if ≥1** subscription accepted (else throws → the delivery row is marked failed).
 */
import webpush from 'web-push';
import { listWebPushSubscriptions, deleteWebPushSubscriptionByEndpoint } from '@/lib/db/queries';
import type { NotificationChannelAdapter } from '../types';
import { configureWebPush } from '../web-push/vapid';

export const webPushAdapter: NotificationChannelAdapter = {
  kind: 'web_push',

  async deliver(channel, rendered) {
    const subscriptions = listWebPushSubscriptions(channel.userId);
    if (subscriptions.length === 0) throw new Error('no web push subscriptions for this user');

    configureWebPush();
    const payload = JSON.stringify({ title: rendered.title, body: rendered.body, url: rendered.url });

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
