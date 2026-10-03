import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/stream/autonomy';


export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
export const PUT = withCompression(serveOperation(operation.PUTInput, operation.PUT));
