import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/stream/decisions/[id]/undo';


export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST));
