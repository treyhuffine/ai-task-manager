'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod/v4';
import { Button } from '@/components/ui/button';
import { accountRpcSchema } from '@/lib/plugins/evaluation-contract';
import { trpcClient } from '@/lib/trpc/client';

type Input = z.infer<typeof accountRpcSchema>;
type Pending = { id: string | number; channel: string; input: Input; approvalIds: string[] };
const messageSchema = z.object({
  kind: z.literal('ri-account-rpc'), handle: z.uuid(), channel: z.uuid(),
  rpc: z.object({ id: z.union([z.string().max(200), z.number()]), method: z.string().max(100), params: z.record(z.string(), z.unknown()).optional() }).strict(),
}).strict();

/** The isolated host receives results, never Ri cookies or provider credentials. */
export function AccountEvaluationBridge({ handle, url, account, frame }: {
  handle: string; url: string; account: string; frame: RefObject<HTMLIFrameElement | null>;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const awaitingApproval = useRef(new Set<string | number>());
  const currentChannel = useRef<string | null>(null);
  const origin = new URL(url).origin;
  function respond(id: string | number, channel: string, result?: unknown, message?: string) {
    if (channel !== currentChannel.current) return;
    frame.current?.contentWindow?.postMessage({ kind: 'ri-account-response', handle, channel, rpc: { jsonrpc: '2.0', id,
      ...(message ? { error: { code: -32000, message } } : { result }) } }, origin);
  }
  useEffect(() => {
    let active = true;
    const inFlight = new Set<string | number>();
    async function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      const parsed = messageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.handle !== handle) return;
      const { rpc, channel } = parsed.data;
      if (rpc.method === 'initialize' && channel !== currentChannel.current) {
        currentChannel.current = channel;
        inFlight.clear(); awaitingApproval.current.clear(); setPending([]); setError(null); setBusy(null);
      }
      if (channel !== currentChannel.current) return;
      if (inFlight.has(rpc.id) || awaitingApproval.current.has(rpc.id) || inFlight.size + awaitingApproval.current.size >= 16) return;
      if (rpc.method === 'ping') { respond(rpc.id, channel, {}); return; }
      const params = rpc.params ?? {};
      const meta = params._meta as Record<string, unknown> | undefined;
      const candidate = accountRpcSchema.safeParse({ handle, method: rpc.method,
        ...(rpc.method === 'tools/call' ? { name: params.name, arguments: params.arguments ?? {}, invocationId: meta?.['ri/evaluationInvocation'], audience: meta?.['ri/evaluationAudience'] ?? 'app' } : {}),
        ...(rpc.method === 'resources/read' ? { uri: params.uri } : {}),
      });
      if (!candidate.success) { respond(rpc.id, channel, undefined, 'Unsupported account view operation.'); return; }
      inFlight.add(rpc.id);
      try {
        const reply = await trpcClient.pluginEvaluation.accountRpc.mutate(candidate.data);
        if (!active || currentChannel.current !== channel) return;
        if (reply.approvalIds?.length) {
          awaitingApproval.current.add(rpc.id);
          setPending(previous => [...previous, { id: rpc.id, channel, input: candidate.data, approvalIds: reply.approvalIds! }]);
        }
        else respond(rpc.id, channel, reply.result);
      } catch (failure) {
        if (active) respond(rpc.id, channel, undefined, failure instanceof Error ? failure.message : 'The account view is unavailable. No call was repeated.');
      } finally { if (currentChannel.current === channel) inFlight.delete(rpc.id); }
    }
    window.addEventListener('message', receive);
    return () => {
      active = false;
      window.removeEventListener('message', receive);
    };
    // Each mount owns exactly one view and its frame-bound channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, origin, frame]);

  async function decide(value: Pending, approve: boolean) {
    if (busy !== null || value.channel !== currentChannel.current) return;
    setBusy(value.id); setError(null);
    try {
      await trpcClient.connectors.approvePost.mutate({ body: { ids: value.approvalIds, decision: approve ? 'approve' : 'deny' } });
      if (approve) {
        const reply = await trpcClient.pluginEvaluation.accountRpc.mutate({ ...value.input, retryApproval: true });
        if (reply.approvalIds?.length) throw new Error('The account or approval changed. Review it again before running.');
        respond(value.id, value.channel, reply.result);
      } else respond(value.id, value.channel, undefined, 'The human declined this call. No tool was run.');
      setPending(previous => previous.filter(item => item.channel !== value.channel || item.id !== value.id));
      if (currentChannel.current === value.channel) awaitingApproval.current.delete(value.id);
    } catch (failure) { if (currentChannel.current === value.channel) setError(failure instanceof Error ? failure.message : 'The approval could not finish.'); }
    finally { if (currentChannel.current === value.channel) setBusy(null); }
  }
  if (!pending.length && !error) return null;
  return <div className="absolute left-4 top-24 z-20 max-h-[60dvh] w-[calc(100%-2rem)] max-w-lg space-y-3 overflow-auto rounded-xl border border-border bg-background p-4 shadow-xl" aria-label="Account view approvals">
    {pending.map(value => <div key={value.id} className="space-y-2">
      <p className="text-sm font-medium">Review app action</p>
      <p className="text-xs text-muted-foreground">{value.input.name} on {account}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs">{JSON.stringify(value.input.arguments, null, 2).slice(0, 4000)}</pre>
      <div className="flex gap-2"><Button size="sm" disabled={busy !== null} onClick={() => void decide(value, true)}>Approve once</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(value, false)}>Decline</Button></div>
    </div>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
