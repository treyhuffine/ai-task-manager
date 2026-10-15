/**
 * The strategy for a connection whose tokens another service holds (a managed connection source,
 * such as a user's Composio project). Its credential is a `remote_account` reference, never a
 * token, so there is nothing to inject or hand out: every call goes through the host transport
 * that owns the account (`Provider.externalAuth`). Native auth entry points, `ctx.http` and
 * `ctx.getToken` are unavailable for such providers, and this strategy refuses them too.
 */
import type { AuthStrategy, Credentials } from '../core/types';

export function remoteAccount(): AuthStrategy {
  return {
    kind: 'remote_account',
    applyAuth(creds: Credentials): void {
      if (creds.type !== 'remote_account') throw new Error('remoteAccount strategy received wrong credentials');
      throw new Error('A remote account reference cannot authenticate a request. Use its host transport.');
    },
    tokenOf(creds: Credentials): string {
      if (creds.type !== 'remote_account') throw new Error('remoteAccount strategy received wrong credentials');
      throw new Error('A remote account reference has no token.');
    },
  };
}
