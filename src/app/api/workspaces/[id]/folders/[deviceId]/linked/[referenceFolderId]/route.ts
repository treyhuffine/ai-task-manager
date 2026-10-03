import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/workspaces/[id]/folders/[deviceId]/linked/[referenceFolderId]';


export const PUT = withCompression(serveOperation(operation.PUTInput, operation.PUT));

export const dynamic = 'force-dynamic';
