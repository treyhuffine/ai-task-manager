import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/workspaces/[id]/integration-scopes';


export const PUT = withCompression(serveOperation(operation.PUTInput, operation.PUT));
