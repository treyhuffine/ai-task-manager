import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const help = vi.hoisted(() => ({ ask: vi.fn(), isPending: false, error: null as string | null, available: true }));
vi.mock('@/hooks/use-plugin-setup-help', () => ({ usePluginSetupHelp: () => help }));
import { PluginSetupHelpButton } from './setup-help-button';
function render(disabled = false) { return renderToStaticMarkup(createElement(PluginSetupHelpButton, { target: { kind: 'plugins' }, disabled })); }

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
  it('disables duplicate clicks while sending, and respects the surrounding form state', () => {
    help.isPending = true;
    expect(render()).toContain('Asking your main agent…');
    expect(render()).toContain('disabled=""');
    help.isPending = false;
    expect(render(true)).toContain('disabled=""');
  });
});
