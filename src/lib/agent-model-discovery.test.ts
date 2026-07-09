import { describe, expect, it } from 'vitest';
import { parseCodexModelCatalog } from './agent-model-discovery';

describe('parseCodexModelCatalog', () => {
  it('returns visible CLI models in catalog order with picker labels', () => {
    const result = parseCodexModelCatalog(JSON.stringify({
      models: [
        {
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5',
          description: 'Frontier model.',
          visibility: 'list',
        },
        {
          slug: 'gpt-5.6-sol',
          display_name: 'GPT-5.6-Sol',
          description: 'Latest frontier agentic coding model.',
          visibility: 'list',
        },
        {
          slug: 'hidden-model',
          display_name: 'Hidden-Model',
          visibility: 'hide',
        },
      ],
    }));

    expect(result).toEqual([
      { id: 'gpt-5.5', label: '5.5', hint: 'Frontier model' },
      { id: 'gpt-5.6-sol', label: '5.6 Sol', hint: 'Latest frontier agentic coding model' },
    ]);
  });

  it('rejects an empty visible catalog so callers use the fallback', () => {
    expect(() => parseCodexModelCatalog('{"models":[]}')).toThrow('no visible models');
  });
});
