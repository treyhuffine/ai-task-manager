import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/connectors/requests/[eventId]';


export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST, { prepareBody: (body) => {
  if (!body || typeof body !== 'object') return body;
  const value = body as Record<string, unknown>;
  return { ...value,
    ...(value.fields && typeof value.fields === 'object' ? { fields: Object.fromEntries(Object.entries(value.fields).filter(([, v]) => typeof v === 'string')) } : {}),
    ...(value.accounts !== undefined ? { accounts: Array.isArray(value.accounts) ? value.accounts.filter(v => typeof v === 'string') : [] } : {}),
  };
} }));
