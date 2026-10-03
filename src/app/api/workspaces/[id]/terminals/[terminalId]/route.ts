import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/workspaces/[id]/terminals/[terminalId]';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
export const DELETE = serveOperation(operation.DELETEInput, operation.DELETE);
