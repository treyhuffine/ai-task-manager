/**
 * The hub's consent screen (docs/personal-apps.md "The hub"): a personal app asks to use the
 * person's accounts through Ri. The person chooses which accounts, which tools on each, and which
 * of Ri's own services. What Ri enforces is that choice, stated on its own. The app's account of
 * what it's for is shown apart, as its own words, and promises nothing.
 */
import { AppWindow, Info } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { hubConsentFor } from '@/lib/integrations/hub/consent';
import { consentCopy, consentFields } from '@/lib/oauth/consent';
import type { AuthorizeRequest } from '@/lib/oauth/flow';
import { OAUTH_PATHS } from '@/lib/oauth/issuer';
import { ConsentButtons } from './consent-buttons';

function host(url: string | undefined) {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

export async function HubConsent({ request, params, issuer }: { request: AuthorizeRequest; params: URLSearchParams; issuer: string }) {
  const options = await hubConsentFor(request);
  const copy = consentCopy(request);
  const name = request.client.name;
  const from = host(request.client.clientUri);
  return (
    <form method="post" action={OAUTH_PATHS.decide} className="space-y-5">
      {consentFields(params, request).map(([field, value]) => <input key={field} type="hidden" name={field} value={value} />)}
      <div className="flex items-center gap-2 text-muted-foreground"><AppWindow size={16} aria-hidden /><span className="text-xs">An app wants your accounts</span></div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold leading-snug text-foreground">Let {name} use your accounts through {APP_NAME}?</h1>
        <p className="text-xs text-muted-foreground">{from ? `${name} runs at ${from}. ` : ''}{copy.origin}.</p>
      </div>

      {request.client.purpose && (
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Info size={13} aria-hidden />What {name} says it&apos;s for</p>
          <p className="text-sm text-foreground">“{request.client.purpose}”</p>
          <p className="text-[11px] text-muted-foreground">This is the app&apos;s own description. {APP_NAME} doesn&apos;t enforce it. What {APP_NAME} enforces is what you choose below.</p>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">What {name} can reach</legend>
        <p className="text-[11px] text-muted-foreground">Only the accounts and tools you tick. Anything that changes something outside {APP_NAME}, like sending an email, asks you every time.</p>
        {options.accounts.length === 0 && <p className="text-xs text-muted-foreground">You haven&apos;t connected any accounts to {APP_NAME} yet.</p>}
        {options.accounts.map((account) => {
          const asked = account.tools.filter((tool) => tool.requested);
          return (
            <details key={account.connectionId} open={asked.length > 0} className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm">
                <span className="font-medium">{account.service}</span> <span className="text-muted-foreground">· {account.account}</span>
                {asked.length > 0 && <span className="ml-1 text-[11px] text-muted-foreground">({asked.length} asked for)</span>}
              </summary>
              <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-border px-3 py-2">
                {account.tools.map((tool) => (
                  <li key={tool.name}>
                    <label className="flex items-start gap-2 text-xs">
                      <input type="checkbox" name={`tool:${account.connectionId}`} value={tool.name} defaultChecked={tool.requested} className="mt-0.5" />
                      <span><span className="font-mono text-[11px] text-foreground">{tool.name}</span>{tool.write && <span className="text-muted-foreground"> · asks you each time</span>}
                        <span className="block text-muted-foreground">{tool.description}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-foreground">{APP_NAME}&apos;s own services</legend>
        {options.services.map((service) => (
          <label key={service.name} className="flex items-start gap-2 text-xs">
            <input type="checkbox" name="service" value={service.name} defaultChecked={service.requested} className="mt-0.5" />
            <span className="text-foreground">{service.description}</span>
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        {name} never gets your passwords or your accounts&apos; own keys, only a token for {APP_NAME} that expires. Change or turn off its access any time on its page in {APP_NAME}.
      </p>
      <ConsentButtons />
      <p className="text-center text-[11px] text-muted-foreground/70">{new URL(issuer).host}</p>
    </form>
  );
}
