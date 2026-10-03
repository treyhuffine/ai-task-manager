import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/sessions/[id]/deliveries';


export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));

export const dynamic = 'force-dynamic';
