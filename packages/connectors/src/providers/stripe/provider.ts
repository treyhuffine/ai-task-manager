/**
 * The Stripe provider — secret API key (sk_…) sent as `Authorization: Bearer`. No OAuth flow.
 * `identify()` resolves the account via GET /account. Stripe expects form-encoded request
 * bodies, so write actions use `rawBody` with `application/x-www-form-urlencoded`.
 */
import { bearer } from '../../auth/direct';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

interface Account {
  id?: string;
  email?: string;
  business_profile?: { name?: string };
}

export function stripe(): Provider {
  return defineProvider({
    id: 'stripe',
    displayName: 'Stripe',
    baseUrl: 'https://api.stripe.com/v1',
    auth: bearer(),
    async identify(http: AuthedHttp) {
      const a = await http.get<Account>('/account');
      if (!a.id) throw new Error('stripe identify: /account returned no id');
      return {
        accountId: a.id,
        ...(a.email !== undefined ? { email: a.email } : {}),
        label: a.business_profile?.name ?? a.email ?? a.id,
      };
    },
  });
}

/** Stripe wants form-encoded bodies; serialize a flat object, dropping undefined. */
export function stripeForm(obj: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}
