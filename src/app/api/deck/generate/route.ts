import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/deck/generate';

export const maxDuration = 60;
export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST));
