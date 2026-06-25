/**
 * The GitLab provider — authenticated with a Personal Access Token (PAT) over `Authorization:
 * Bearer`. Defaults to gitlab.com; a self-hosted instance uses a different per-instance
 * `base_url` (e.g. https://gitlab.example.com/api/v4) — a future per-connection override, not
 * wired here.
 */
import { bearer } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export function gitlab(): Provider {
  return defineProvider({
    id: 'gitlab',
    displayName: 'GitLab',
    baseUrl: 'https://gitlab.com/api/v4',
    auth: bearer(),
    async identify(http: AuthedHttp) {
      const me = await http.get<{ id: number; username: string; email?: string; name?: string }>('/user');
      return {
        accountId: String(me.id),
        ...(me.email !== undefined ? { email: me.email } : {}),
        label: me.username,
      };
    },
  });
}
