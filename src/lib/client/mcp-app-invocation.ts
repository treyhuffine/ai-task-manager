import type { RouterOutputs } from '@/lib/trpc/router';

type Outcome = RouterOutputs['connectedApps']['invoke'];
type Approval = Extract<Outcome, {kind: 'approval'}>;

/** One browser request, including its native approval wait. Cancellation is
 * recorded by invocation ID so it also covers late and reordered responses. */
export async function runConnectedInvocation(options: {
  signal: AbortSignal;
  invoke: () => Promise<Outcome>;
  approve: (ids: string[], approved: boolean) => Promise<unknown>;
  cancel: () => Promise<unknown>;
  ask: (approval: Approval, signal: AbortSignal) => Promise<boolean>;
}) {
  const {signal} = options;
  signal.throwIfAborted();
  let cancellation: Promise<unknown> | undefined;
  let awaitingApproval = false;
  const cancel = () => { cancellation ??= options.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    let outcome = await options.invoke();
    signal.throwIfAborted();
    if (outcome.kind === 'approval') {
      awaitingApproval = true;
      const approved = await options.ask(outcome, signal);
      signal.throwIfAborted();
      await options.approve(outcome.ids, approved);
      signal.throwIfAborted();
      if (!approved) {cancel(); throw new Error('You declined this operation');}
      outcome = await options.invoke();
      signal.throwIfAborted();
      if (outcome.kind === 'approval') {cancel(); throw new Error('Approval expired. Try the operation again.');}
    }
    return outcome.result;
  } catch (error) {
    // A second simultaneous request may be unable to show its approval, or
    // saving a decision may fail. Neither should leave an orphaned request.
    if (awaitingApproval) cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    // If abort overtook an approval response, also wait for its cleanup before
    // completing this handler. A failed cleanup never invites an effect retry.
    if (signal.aborted) cancel();
    await cancellation;
  }
}
