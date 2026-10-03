import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/skills/[ref]/move';
export const runtime = 'nodejs';

export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST));
