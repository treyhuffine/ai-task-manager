import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const help = vi.hoisted(() => ({ ask: vi.fn(), isPending: false, error: null as string | null, available: true }));
vi.mock('@/hooks/use-plugin-setup-help', () => ({ usePluginSetupHelp: () => help }));
import { PluginSetupHelpButton } from './setup-help-button';
function render(disabled = false, compact = false) { return renderToStaticMarkup(createElement(PluginSetupHelpButton, { target: { kind: 'plugins' }, disabled, compact })); }

describe('setup help button', () => {
  it('offers a direct request without sending on mount', () => {
    const html = render();
    expect(html).toContain('Get setup help');
    expect(html).not.toContain('disabled=""');
    expect(help.ask).not.toHaveBeenCalled();
  });
  it('keeps a failure visible beside the retry action', () => {
    help.error = 'Could not ask your main agent. Home offline.';
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('Home offline');
    expect(html).toContain('Get setup help');
    help.error = null;
  });
  it('fits a header row: its label folds away on a narrow one and stays its accessible name', () => {
    help.error = 'Could not ask your main agent. Home offline.';
    const html = render(false, true);
    expect(html).toContain('aria-label="Get setup help"');
    expect(html).toContain('hidden @lg:inline');
    expect(html).not.toContain('role="alert"');
    help.error = null;
    help.isPending = true;
    expect(render(false, true)).toContain('aria-label="Asking your main agent…"');
    expect(render(false, true)).toContain('disabled=""');
    help.isPending = false;
  });
  it('disables duplicate clicks while sending, and respects the surrounding form state', () => {
    help.isPending = true;
    expect(render()).toContain('Asking your main agent…');
    expect(render()).toContain('disabled=""');
    help.isPending = false;
    expect(render(true)).toContain('disabled=""');
  });
});
