import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/settings/base-url';
export const runtime = 'nodejs';

export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
export const PATCH = withCompression(serveOperation(operation.PATCHInput, operation.PATCH));
export const DELETE = withCompression(serveOperation(operation.DELETEInput, operation.DELETE));
