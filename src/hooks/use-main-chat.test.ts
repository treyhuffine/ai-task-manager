import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('@/lib/trpc/client', () => ({ trpcClient: {} }));

const { mainChatKey, switchToMainChat } = await import('./use-main-chat');

describe('switchToMainChat', () => {
  it('keeps the new chat when a read of the old one was already in flight', async () => {
    const qc = new QueryClient();
    const old = { session: { id: 'old' } };
    const fresh = { session: { id: 'fresh' } };
    let answer!: (value: typeof old) => void;
    // A refetch of the current chat that started before the old one was archived.
    const inFlight = qc
      .fetchQuery({ queryKey: mainChatKey(null), queryFn: () => new Promise<typeof old>((resolve) => (answer = resolve)) })
      .catch(() => undefined);

    await switchToMainChat(qc, null, fresh as never);
    answer(old);
    await inFlight;

    expect(qc.getQueryData(mainChatKey(null))).toEqual(fresh);
  });
});
