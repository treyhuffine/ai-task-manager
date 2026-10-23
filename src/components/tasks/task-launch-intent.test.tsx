import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { StartWithAgentButton } from './start-with-agent-button';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), discard: vi.fn(), replace: vi.fn(), taskId: 'remote-task', button: null as ComponentProps<typeof StartWithAgentButton> | null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ workTeam: 'team', workTask: mocks.taskId }), useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/hooks/use-tasks', () => ({ useTask: () => ({}) }));
vi.mock('@/lib/spaces/my-ri-client', () => ({ myRiClient: { spaces: { prepareAgentTask: { mutate: mocks.prepare }, discardPreparedAgentTask: { mutate: mocks.discard } } } }));
vi.mock('./start-with-agent-button', () => ({ StartWithAgentButton: (props: ComponentProps<typeof StartWithAgentButton>) => { mocks.button = props; return createElement('span', null, props.task.id); } }));
import { TaskLaunchIntent } from './task-launch-intent';
let root: Root;
beforeEach(() => {
  vi.clearAllMocks(); mocks.taskId = 'remote-task'; mocks.button = null;
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.defineProperty(window, 'location', { value: { search: '?workTeam=team&workTask=remote-task' }, configurable: true });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const value = { task: { id: 'local-reference', createdAt: 'created', updatedAt: 'prepared' }, prepared: true, restoreReleased: true, preparedUpdatedAt: 'prepared', preparedFingerprint: 'fingerprint', preparedExecutionCount: 2 };

it('uses the ordinary Continue flow and retains its exact cancellation receipt after the intent leaves the URL', async () => {
  mocks.prepare.mockResolvedValue(value);
  await act(async () => root.render(<TaskLaunchIntent/>));
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({ teamId: 'team', taskId: 'remote-task' });
  expect(mocks.button).toMatchObject({ task: { id: 'local-reference' }, autoOpen: true });
  const cancel = mocks.button!.onCancel!;
  mocks.button!.onHandled!();
  expect(mocks.replace).toHaveBeenCalledWith('/', { scroll: false });
  await act(async () => root.render(null));
  cancel();
  expect(mocks.discard).toHaveBeenCalledExactlyOnceWith({ id: 'local-reference', createdAt: 'created', restoreReleased: true, preparedUpdatedAt: 'prepared', preparedFingerprint: 'fingerprint', preparedExecutionCount: 2 });
});

it('discards an abandoned preparation and never opens another task’s stale launcher', async () => {
  const old = Promise.withResolvers<typeof value>();
  mocks.prepare.mockReturnValueOnce(old.promise).mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<TaskLaunchIntent/>));
  mocks.taskId = 'different-task';
  await act(async () => root.render(<TaskLaunchIntent/>));
  await act(async () => old.resolve(value));
  expect(mocks.discard).toHaveBeenCalledTimes(1);
  expect(mocks.button).toBeNull();
});
