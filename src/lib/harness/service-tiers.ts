import type { ModelOption } from './options';
import type { ServiceTier } from '@/db/types';

export interface ServiceTierOption {
  id: ServiceTier;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function serviceTierLabel(id: string): string {
  if (id === 'default') return 'Normal';
  if (id === 'priority' || id === 'fast') return 'Fast';
  if (id === 'ultrafast') return 'Ultrafast';
  return id;
}

/** A catalog advertises support, not paid-tier entitlement. Unknown is selectable. */
export function serviceTierOptions(model: ModelOption | null | undefined): ServiceTierOption[] {
  return (model?.serviceTiers ?? []).map(tier => ({
    id: tier.id,
    label: ['default', 'priority', 'fast', 'ultrafast'].includes(tier.id) ? serviceTierLabel(tier.id) : tier.name,
    hint: tier.availability === 'unavailable' ? tier.reason : tier.description,
    disabled: tier.availability === 'unavailable',
  }));
}

/** Model changes may keep a valid explicit speed, but never enable a paid tier. */
export function serviceTierForModel(model: ModelOption | null | undefined, preferred?: string | null): ServiceTier | null {
  const options = serviceTierOptions(model);
  const canonical = preferred === 'fast' && options.some(option => option.id === 'priority') ? 'priority' : preferred;
  if (canonical && options.some(option => option.id === canonical && !option.disabled)) return canonical;
  return options.some(option => option.id === 'default' && !option.disabled) ? 'default' : null;
}

/** Reject explicit unsupported selections at every server and runner boundary. */
export function assertServiceTier(model: ModelOption | null | undefined, requested?: string | null): void {
  if (requested == null) return;
  const id = requested === 'fast' && model?.serviceTiers?.some(tier => tier.id === 'priority') ? 'priority' : requested;
  const tier = model?.serviceTiers?.find(option => option.id === id);
  if (!tier || tier.availability === 'unavailable') {
    throw new Error(tier?.reason ?? `${model?.label ?? 'This model'} does not offer ${serviceTierLabel(requested)} speed. Refresh models or choose Normal.`);
  }
}
