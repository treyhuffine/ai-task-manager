import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/connectors/connectDirect';


export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST, { prepareBody: body => {
  if (!body || typeof body !== 'object' || !('fields' in body) || !body.fields || typeof body.fields !== 'object') return body;
  return { ...body, fields: Object.fromEntries(Object.entries(body.fields).filter(([, value]) => typeof value === 'string')) };
} }));
