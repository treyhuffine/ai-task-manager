import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/harness/skills/global';
export const runtime = 'nodejs';

export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
export const PUT = withCompression(serveOperation(operation.PUTInput, operation.PUT));
