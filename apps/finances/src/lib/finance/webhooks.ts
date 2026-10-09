import {
  createHash,
  createPublicKey,
  verify,
  timingSafeEqual,
  type JsonWebKey,
} from 'node:crypto';
import { z } from 'zod/v4';
import { financeSourceCall } from './sources';
import * as q from '@/lib/db/queries';
const claimsSchema = z.object({
  iat: z.number().int(),
  request_body_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export function verifyPlaidWebhook(
  token: string,
  bytes: Uint8Array,
  jwk: JsonWebKey,
  now = Date.now(),
) {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 10000)
    throw new Error('Invalid webhook verification');
  const header = z
    .object({ alg: z.literal('ES256'), kid: z.string().min(1).max(100) })
    .parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
  const claims = claimsSchema.parse(
    JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
  );
  if (claims.iat * 1000 > now + 30000 || now - claims.iat * 1000 > 300000)
    throw new Error('Webhook verification expired');
  const signature = Buffer.from(parts[2], 'base64url');
  if (
    signature.length !== 64 ||
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    !verify(
      'sha256',
      Buffer.from(parts[0] + '.' + parts[1]),
      {
        key: createPublicKey({ key: jwk, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      },
      signature,
    )
  )
    throw new Error('Webhook signature mismatch');
  const digest = createHash('sha256').update(bytes).digest();
  if (!timingSafeEqual(digest, Buffer.from(claims.request_body_sha256, 'hex')))
    throw new Error('Webhook body mismatch');
  return header.kid;
}
export async function processFinanceWebhook(bytes: Uint8Array, token: string) {
  if(!q.getFinanceSettings()?.enabled||!q.getFinanceSettings()?.restoreReviewed)return {paused:true};
  if (bytes.length > 1024 * 1024) throw new Error('Webhook exceeds limit');
  const data = z
    .object({
      item_id: z.string().max(128),
      webhook_type: z.string().max(80),
      webhook_code: z.string().max(100),
    })
    .parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  const item = q.findFinanceItemBySource(data.item_id);
  if (!item || item.status !== 'active')
    throw new Error('Webhook Item unavailable');
  const header = z
    .object({ alg: z.literal('ES256'), kid: z.string().max(100) })
    .parse(
      JSON.parse(
        Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'),
      ),
    );
  const response = (await financeSourceCall(
    item.connectionId,
    'plaid.finance_call',
    { path: '/webhook_verification_key/get', body: { key_id: header.kid } },
  )) as { key: JsonWebKey & { expired_at?: number | null } };
  if (response.key.expired_at && response.key.expired_at * 1000 < Date.now())
    throw new Error('Webhook key expired');
  verifyPlaidWebhook(token, bytes, response.key);
  const digest = createHash('sha256').update(bytes).update(token).digest('hex');
  return q.queueFinanceWebhook('plaid',digest,item.connectionId);
}
