import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/deck';

export const maxDuration = 60;
export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
