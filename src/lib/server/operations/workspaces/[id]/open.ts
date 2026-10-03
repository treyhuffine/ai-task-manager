import { agentOpenPlace, openAppsOnViewer, openInputSchema, openOnViewer } from '@/lib/open/on-viewer';
import type { OperationContext } from '@/lib/server/operation';
import { z } from 'zod/v4';
export const GETInput = z.object({ params: z.object({ id: z.string().min(1) }).strict() }).strict();
export const POSTInput = GETInput.extend({ body: openInputSchema });
export async function GET(input: z.infer<typeof GETInput>, context: OperationContext) { return openAppsOnViewer(context, agentOpenPlace(input.params.id)); }
export async function POST(input: z.infer<typeof POSTInput>, context: OperationContext) { return openOnViewer(context, agentOpenPlace(input.params.id), input.body); }
