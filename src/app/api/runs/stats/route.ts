import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/runs/stats';


export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
