import { z } from 'zod';
import type { NotificationChannelRecord } from '@/db/types';

const endpoint = z.string().max(4096).url().refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}, 'Use a valid HTTPS push endpoint');
const key = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(value => {
  const unpadded = value.replace(/=+$/, '');
  return unpadded.length % 4 !== 1 && (!value.includes('=') || value.length % 4 === 0);
}, 'Use a valid base64url key');

export const webPushEndpointSchema = z.object({ endpoint }).strict();
export const webPushSubscriptionSchema = webPushEndpointSchema.extend({
  keys: z.object({ p256dh: key, auth: key }).strict(),
}).strict();
export const webPushStatusRequestSchema = z.union([webPushSubscriptionSchema, z.object({}).strict()]);

export type WebPushSubscriptionPayload = z.infer<typeof webPushSubscriptionSchema>;
/** Only registration health and existing channel preferences cross this boundary. */
export interface WebPushServerStatus {
  registered: boolean;
  channel: Pick<NotificationChannelRecord, 'enabled' | 'events'> | null;
}
