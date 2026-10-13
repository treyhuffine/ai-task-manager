'use client';

import { useId } from 'react';
import type { HostedMcpEndpointSetup } from '@integrations/engine/providers';
import type { HostedEndpointSelection } from '@/lib/client/integration-endpoint';
import { Input } from '@/components/ui/input';

/** Configurable services ask for their documented environment, region or instance. */
export function HostedEndpointFields({ setup, value = {}, onChange, disabled = false }: {
  setup: HostedMcpEndpointSetup;
  value?: HostedEndpointSelection;
  onChange?: (selection: HostedEndpointSelection) => void;
  disabled?: boolean;
}) {
  const id = useId();
  if (setup.locked) {
    const selection = setup.kind === 'region'
      ? setup.options.find(option => option.id === setup.selectedId)?.label
      : setup.kind === 'deployment'
        ? setup.selectedId === 'hosted' ? 'Hosted' : setup.selectedId === 'selfhosted'
          ? `Self-hosted: ${setup.selectedUrl ?? 'address unavailable'} (${setup.selectedAuthMethod === 'none' ? 'no authentication' : 'browser sign-in'})` : undefined
        : setup.selectedUrl;
    return <div className="space-y-1 text-xs">
      <p className="font-medium">{setup.label}</p>
      <p className="break-all text-muted-foreground">{selection ?? 'Saved selection unavailable'}</p>
      <p className="text-muted-foreground">Disconnect to change this selection.</p>
    </div>;
  }
  if (setup.kind === 'deployment') {
    const selfHosted = (value.endpointId ?? 'hosted') === 'selfhosted';
    return <div className="space-y-3">
      <div className="space-y-2">
        <label htmlFor={id} className="text-xs font-medium">{setup.label}</label>
        <select id={id} value={value.endpointId ?? 'hosted'} disabled={disabled}
          onChange={event => onChange?.({ endpointId: event.target.value, ...(event.target.value === 'selfhosted' ? { authMethod: 'oauth' } : {}) })}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs">
          <option value="hosted">Hosted</option><option value="selfhosted">Self-hosted</option>
        </select>
      </div>
      {selfHosted && <>
        <div className="space-y-2">
          <label htmlFor={`${id}-url`} className="text-xs font-medium">Instance URL</label>
          <Input id={`${id}-url`} type="url" value={value.instanceUrl ?? ''} placeholder={setup.placeholder} autoComplete="url" required disabled={disabled}
            onChange={event => onChange?.({ ...value, instanceUrl: event.target.value })} />
          <p className="text-xs text-muted-foreground">Enter the address of your OpenSEO server. Local Docker addresses such as http://localhost:3000 are supported. Ri adds /mcp automatically.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-auth`} className="text-xs font-medium">Authentication</label>
          <select id={`${id}-auth`} value={value.authMethod ?? 'oauth'} disabled={disabled}
            onChange={event => onChange?.({ ...value, authMethod: event.target.value as 'oauth' | 'none' })}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs">
            <option value="oauth">Browser sign-in (Cloudflare Access)</option>
            <option value="none">No authentication (Docker)</option>
          </select>
        </div>
      </>}
    </div>;
  }
  return <div className="space-y-2">
    <label htmlFor={id} className="text-xs font-medium">{setup.label}</label>
    {setup.kind === 'region' ? <select
      id={id}
      value={value.endpointId ?? ''}
      onChange={event => onChange?.({ endpointId: event.target.value })}
      disabled={disabled}
      required
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
    >
      <option value="" disabled>Select {setup.label.toLowerCase()}</option>
      {setup.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select> : <Input
      id={id}
      type="url"
      value={value.instanceUrl ?? ''}
      onChange={event => onChange?.({ instanceUrl: event.target.value })}
      placeholder={setup.placeholder}
      autoComplete="url"
      disabled={disabled}
      required
    />}
    <p className="text-xs text-muted-foreground">{setup.kind === 'region'
      ? 'This selection is saved with your connection.'
      : 'Enter your instance address without a token or password. This address is saved with your connection.'}</p>
  </div>;
}
