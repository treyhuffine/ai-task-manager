import { createAppTRPCClient, trpcClient } from '@/lib/trpc/client';
import { currentSpaceId } from './document';

/**
 * My Ri's own typed API, from any page. Inside a team's space document
 * `trpcClient` is the team's (src/lib/spaces/document.ts), so the few places
 * there that need My Ri (the space selector) use this one.
 */
export const myRiClient = currentSpaceId() ? createAppTRPCClient({ getMode: () => 'http' }) : trpcClient;
