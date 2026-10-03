import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { values: {}, secrets: {} } }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_RI_CURSOR_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_RI_OPENCODE_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderSetup() {
  const { RuntimeSetup } = await import('./runtime-setup');
  return renderToStaticMarkup(createElement(RuntimeSetup));
}

describe('runtime setup harness fields', () => {
  it('offers executable overrides in registry order with Codex first', async () => {
    const html = await renderSetup();
    const labels = ['Codex', 'Claude Code', 'Cursor', 'OpenCode', 'Antigravity'].map((name) => `${name} executable`);
    const positions = labels.map((label) => html.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('Embeddings API key');
  });

  it('hides disabled harness fields while retaining the core runtime settings', async () => {
    vi.stubEnv('NEXT_PUBLIC_RI_CURSOR_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_RI_OPENCODE_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'false');
    const html = await renderSetup();
    expect(html).toContain('Codex executable');
    expect(html).toContain('Claude Code executable');
    expect(html).not.toContain('Cursor executable');
    expect(html).not.toContain('OpenCode executable');
    expect(html).not.toContain('Antigravity executable');
    expect(html).toContain('Parakeet server URL');
  });
});
