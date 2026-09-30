'use client';

import { useId } from 'react';
import type { HostedMcpEndpointSetup } from '@connectors/engine/providers';
import type { HostedEndpointSelection } from '@/lib/client/connector-endpoint';
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
      : setup.selectedUrl;
    return <div className="space-y-1 text-xs">
      <p className="font-medium">{setup.label}</p>
      <p className="break-all text-muted-foreground">{selection ?? 'Saved selection unavailable'}</p>
      <p className="text-muted-foreground">Disconnect to change this selection.</p>
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
