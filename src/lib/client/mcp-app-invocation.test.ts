import { expect, it, vi } from 'vitest';
import { runConnectedInvocation } from './mcp-app-invocation';
const approval = {kind: 'approval' as const, ids: ['approval'], preview: {}};
const result = {kind: 'result' as const, result: {content: []}};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
function setup() {
  const controller = new AbortController();
  return {controller, options: {signal: controller.signal, invoke: vi.fn(async () => result as typeof result | typeof approval),
    approve: vi.fn(async () => {}), cancel: vi.fn(async () => {}), ask: vi.fn(async () => true)}};
}

it('cancels a pending invocation when abort overtakes its approval response', async () => {
  const {controller, options} = setup(), response = deferred<typeof approval>();
  options.invoke.mockReturnValueOnce(response.promise);
  const run = runConnectedInvocation(options), rejected = expect(run).rejects.toMatchObject({name: 'AbortError'});
  controller.abort(); response.resolve(approval); await rejected;
  expect(options.cancel).toHaveBeenCalledTimes(1); expect(options.ask).not.toHaveBeenCalled();
  expect(options.approve).not.toHaveBeenCalled(); expect(options.invoke).toHaveBeenCalledTimes(1);
});
it('clears a displayed approval when its bridge signal aborts', async () => {
  const {controller, options} = setup();
  options.invoke.mockResolvedValueOnce(approval);
  options.ask.mockImplementationOnce(() => new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true})));
  const run = runConnectedInvocation(options), rejected = expect(run).rejects.toMatchObject({name: 'AbortError'});
  await vi.waitFor(() => expect(options.ask).toHaveBeenCalledTimes(1));
  controller.abort(); await rejected;
  expect(options.cancel).toHaveBeenCalledTimes(1); expect(options.approve).not.toHaveBeenCalled();
});
it('does not start an approved retry after the frame closes during approval acknowledgement', async () => {
  const {controller, options} = setup(), acknowledgement = deferred<void>();
  options.invoke.mockResolvedValueOnce(approval); options.approve.mockReturnValueOnce(acknowledgement.promise);
  const run = runConnectedInvocation(options), rejected = expect(run).rejects.toMatchObject({name: 'AbortError'});
  await vi.waitFor(() => expect(options.approve).toHaveBeenCalledTimes(1));
  controller.abort(); acknowledgement.resolve(); await rejected;
  expect(options.invoke).toHaveBeenCalledTimes(1); expect(options.cancel).toHaveBeenCalledTimes(1);
});
it('retries an approved operation once and does not cancel a completed request', async () => {
  const {options} = setup(); options.invoke.mockResolvedValueOnce(approval);
  expect(await runConnectedInvocation(options)).toEqual(result.result);
  expect(options.invoke).toHaveBeenCalledTimes(2); expect(options.approve).toHaveBeenCalledWith(['approval'], true);
  expect(options.cancel).not.toHaveBeenCalled();
});
it('clears an approval when another request prevents the prompt from being shown', async () => {
  const {options} = setup(); options.invoke.mockResolvedValueOnce(approval);
  options.ask.mockRejectedValueOnce(new Error('Another operation is awaiting approval'));
  await expect(runConnectedInvocation(options)).rejects.toThrow('Another operation is awaiting approval');
  expect(options.cancel).toHaveBeenCalledTimes(1); expect(options.approve).not.toHaveBeenCalled();
  expect(options.invoke).toHaveBeenCalledTimes(1);
});
