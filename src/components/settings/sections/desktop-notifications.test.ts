import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { DesktopNotifications } from './desktop-notifications';

function render(props: Partial<Parameters<typeof DesktopNotifications>[0]> = {}) {
  return parseHTML(renderToStaticMarkup(createElement(DesktopNotifications, {
    status: { supported: true, enabled: false }, checking: false, busy: false,
    localControls: false, canOpenSettings: true,
    onToggle() {}, onOpenSettings() {}, onCheck() {}, ...props,
  }))).document;
}

describe('this computer’s notification setup', () => {
  it('makes a disabled computer actionable regardless of shared channels', () => {
    const document = render();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Off');
    expect(document.querySelector('button')?.textContent).toBe('Enable desktop notifications');
    expect(document.querySelector('section')?.className).toContain('border-amber');
  });

  it('shows confirmed consent with management for a connected viewer', () => {
    const document = render({ status: { supported: true, enabled: true } });
    expect(document.querySelector('[role="status"]')?.textContent).toBe('On');
    expect(document.querySelector('button')?.textContent).toBe('Open notification settings');
    expect(document.querySelector('section')?.textContent).toContain('Enabled on this computer.');
    expect(document.querySelector('section')?.textContent).toContain('Use Test on the Desktop channel');
  });

  it('does not claim On after a failed status read or native presentation error', () => {
    for (const props of [
      { error: 'Waiting for Ri.', status: { supported: true, enabled: true } },
      { status: { supported: true, enabled: true, error: 'The operating system could not show this notification.' } },
    ]) {
      const document = render(props);
      expect(document.querySelector('[role="status"]')?.textContent).toBe('Needs attention');
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
      expect([...document.querySelectorAll('button')].some(button => button.textContent === 'Check again')).toBe(true);
    }
  });

  it('keeps unknown older-shell status distinct from Off and offers setup', () => {
    const document = render({ status: null });
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Check setup');
    expect(document.querySelector('button')?.textContent).toBe('Enable desktop notifications');
  });

  it('does not offer enable for an unsupported computer or before its initial check', () => {
    const unsupported = render({ status: { supported: false, enabled: false } });
    expect(unsupported.querySelector('[role="status"]')?.textContent).toBe('Unavailable');
    expect(unsupported.querySelector('button')?.textContent).toBe('Open notification settings');
    const checking = render({ status: null, checking: true });
    expect(checking.querySelector('[role="status"]')?.textContent).toBe('Checking…');
    expect(checking.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  });

  it('retains local enable and disable controls for a Home desktop', () => {
    expect(render({ localControls: true }).querySelector('button')?.textContent).toBe('Enable desktop notifications');
    expect(render({ localControls: true, status: { supported: true, enabled: true } }).querySelector('button')?.textContent).toBe('Disable desktop notifications');
  });
});
