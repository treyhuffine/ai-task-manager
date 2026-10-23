import { describe, expect, it } from 'vitest';
import { compactModels } from './compact-models';
import type { ModelOption } from '@/lib/harness/options';

const models: ModelOption[] = ['6.1', 'Astra', 'Sol', 'Luna', 'Legacy'].map(id => ({ id, label: id }));
const ids = (rows: ModelOption[]) => rows.map(row => row.id);

describe('compact model choices', () => {
  it('shows two recent choices even when the whole catalog is enabled', () => {
    expect(ids(compactModels(models, ['Astra', '6.1', 'Sol', 'Luna'], '6.1', 'Sol'))).toEqual(['Astra', '6.1']);
  });

  it('keeps an older selected model visible without dropping recent choices', () => {
    expect(ids(compactModels(models, ['Astra', '6.1'], 'Legacy', null))).toEqual(['Legacy', 'Astra', '6.1']);
  });

  it('skips disabled, missing and unavailable choices before applying the limit', () => {
    const enabled = [...models.filter(model => model.id !== 'Sol'), { id: 'Retired', label: 'Retired', availability: 'unavailable' as const }];
    expect(ids(compactModels(enabled, ['Sol', 'Retired', 'Missing', 'Astra', 'Astra', '6.1'], null, null))).toEqual(['Astra', '6.1']);
  });

  it('uses just the configured default on a cold start', () => {
    expect(ids(compactModels(models, [], null, 'Astra'))).toEqual(['Astra']);
    expect(ids(compactModels(models, [], '6.1', 'Astra'))).toEqual(['6.1', 'Astra']);
  });

  it('falls back to one available model instead of expanding the entire catalog', () => {
    expect(ids(compactModels(models, [], null, 'Missing'))).toEqual(['6.1']);
    expect(compactModels([], [], null, null)).toEqual([]);
  });

  it('keeps an unavailable current model identifiable but does not otherwise recommend it', () => {
    const retired = { id: 'Retired', label: 'Retired', availability: 'unavailable' as const };
    expect(compactModels([retired], [], 'Retired', 'Retired')).toEqual([retired]);
    expect(compactModels([retired], [], null, 'Retired')).toEqual([]);
  });

  it('does not keep an unused pinned ID in the compact list forever', () => {
    const pinned = { id: 'Exact model', label: 'Exact model', custom: true };
    expect(ids(compactModels([...models, pinned], ['Astra', '6.1'], null, null))).toEqual(['Astra', '6.1']);
    expect(ids(compactModels([...models, pinned], ['Astra', '6.1'], pinned.id, null))).toEqual([pinned.id, 'Astra', '6.1']);
  });
});
