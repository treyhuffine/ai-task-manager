'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { api, apiErrorText } from '@/lib/api/client';
import { openConnectorAuthorization } from '@/lib/client/desktop';

function ConnectionRequest() {
  const params = useSearchParams();
  const provider = params.get('provider') ?? '';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  let scopes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(params.get('scopes') ?? '[]');
    if (Array.isArray(parsed) && parsed.length <= 100 && parsed.every(item => typeof item === 'string' && item.length <= 500)) scopes = parsed;
  } catch { /* The server validates the provider and its allowed scopes. */ }
  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ authorizationUrl: string; desktopFlowId?: string }>('/connectors/connect', {
        providerId: provider, scopes, authConfigId: params.get('client') ?? undefined,
        existingConnectionId: params.get('connection') ?? undefined,
      });
      await openConnectorAuthorization(result.authorizationUrl);
      setMessage('Finish connecting in your browser.');
    } catch (error) { setMessage(apiErrorText(error)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 p-8">
    <h1 className="text-2xl font-semibold">Connect {provider || 'an account'}</h1>
    <p>A tool needs your permission to connect or update access. Review the permissions on the provider’s sign-in page.</p>
    {scopes.length > 0 && <details><summary>Requested access</summary><ul className="mt-2 break-all text-sm">{scopes.map(scope => <li key={scope}>{scope}</li>)}</ul></details>}
    <Button disabled={busy || !provider} onClick={() => void connect()}>{busy ? 'Preparing sign-in…' : 'Continue to sign-in'}</Button>
    {message && <p role="status">{message}</p>}
    <Link href="/?settings=connectors" className="text-sm underline">Back to connections</Link>
  </main>;
}

export default function ConnectPage() {
  return <Suspense fallback={<p className="p-8">Loading connection…</p>}><ConnectionRequest /></Suspense>;
}
