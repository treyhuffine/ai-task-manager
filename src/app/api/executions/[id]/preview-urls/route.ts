import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/executions/[id]/preview-urls';
export const runtime = 'nodejs';

export const PUT = withCompression(serveOperation(operation.PUTInput, operation.PUT));
