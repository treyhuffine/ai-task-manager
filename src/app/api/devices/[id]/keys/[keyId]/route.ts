import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/devices/[id]/keys/[keyId]';


export const DELETE = withCompression(serveOperation(operation.DELETEInput, operation.DELETE));
