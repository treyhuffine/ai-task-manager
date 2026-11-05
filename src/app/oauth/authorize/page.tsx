/**
 * Where an app's "Connect" lands (docs/mcp-oauth.md). ChatGPT, Claude or
 * another MCP client opens this page in the owner's browser. It signs the
 * browser in if it has to, names the app and what it could do, and sends the
 * owner's Allow or Cancel back to the app through `/api/oauth/authorize`.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { Check, X } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { aiClient } from '@/lib/external-ai/client-config';
import { isTeamAuthority } from '@/lib/home/authority';
import { clientLabel } from '@/lib/oauth/clients';
import { AUTHORIZE_FIELDS, consentCopy, consentFields, signedIn } from '@/lib/oauth/consent';
import { checkAuthorizeRequest } from '@/lib/oauth/flow';
import { issuerFor, OAUTH_PATHS } from '@/lib/oauth/issuer';
import { AiClientLogo } from '@/components/settings/ai-client-logo';
import { ConsentButtons } from './consent-buttons';
import { SignInToContinue } from './sign-in';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `Connect to ${APP_NAME}`, robots: { index: false } };

const CAN = [
  'Search and read your tasks, notes and areas',
  'Add and change tasks, notes and areas, and start, finish or archive tasks',
  'See today’s deck and change its order',
];

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">{children}</div>
    </main>
  );
}

function Problem({ title, message, back }: { title: string; message: string; back?: string }) {
  return (
    <Shell>
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">Nothing was connected. {back ? 'Tell the app, or close this tab and try again from it.' : 'Close this tab and try again from the app.'}</p>
        {back && (
          <a href={back} className="inline-block pt-1 text-sm font-medium text-foreground underline underline-offset-2">
            Return to {returnHost(back)}
          </a>
        )}
      </div>
    </Shell>
  );
}

function returnHost(location: string): string {
  const url = new URL(location);
  return url.protocol === 'https:' ? url.hostname : url.protocol === 'http:' ? 'the app on this computer' : 'the app';
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const field of AUTHORIZE_FIELDS) {
    const value = raw[field];
    if (typeof value === 'string') params.set(field, value);
  }
  let team: boolean;
  try { team = isTeamAuthority(); } catch { team = true; }
  if (team) return <Problem title="This is a team’s Ri" message="A team connects AI clients from its own settings, with each member’s key." />;

  const requestHeaders = await headers();
  const issuer = issuerFor(requestHeaders, `http://${requestHeaders.get('host') ?? 'localhost'}/`);
  if (!signedIn(await cookies())) {
    return <Shell><SignInToContinue client={clientLabel(params.get('client_id'))} /></Shell>;
  }

  const check = await checkAuthorizeRequest(params, issuer);
  if (check.kind === 'fatal') return <Problem title="This app can’t connect" message={check.message} />;
  // Shown, never redirected unasked: anyone can register a client (docs/mcp-oauth.md, "Security").
  if (check.kind === 'redirect') return <Problem title="This app’s request can’t be used" message={check.description} back={check.location} />;
  const copy = consentCopy(check.request);

  return (
    <Shell>
      <form method="post" action={OAUTH_PATHS.decide} className="space-y-5">
        {consentFields(params, check.request).map(([field, value]) => <input key={field} type="hidden" name={field} value={value} />)}
        <div className="flex items-center gap-2">
          <AiClientLogo id={aiClient(check.request.kind).logo} size={16} />
          <span aria-hidden className="h-px w-5 bg-border" />
          <AiClientLogo id="ri" size={16} />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-snug text-foreground">Connect {copy.name} to your Ri</h1>
          <p className="text-xs text-muted-foreground">{copy.origin}</p>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-foreground">It will be able to:</p>
          <ul className="space-y-1.5">
            {CAN.map(item => (
              <li key={item} className="flex gap-2 text-sm text-foreground">
                <Check size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden /> {item}
              </li>
            ))}
            <li className="flex gap-2 text-sm text-muted-foreground">
              <X size={14} className="mt-0.5 shrink-0" aria-hidden /> Not your chats, the Stream, files or settings, and it can’t start agents
            </li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          {copy.destination} Disconnect it any time in Settings → Connect your agent.
        </p>
        <ConsentButtons />
        <p className="text-center text-[11px] text-muted-foreground/70">{new URL(issuer).host}</p>
      </form>
    </Shell>
  );
}
