import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/workspaces/[id]';


export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
export const PATCH = withCompression(serveOperation(operation.PATCHInput, operation.PATCH));
