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

  it('explains an unsigned Mac build in place, with no way off the page, and points to Telegram', () => {
    const document = render({ needsSignedBuild: true, onUseTelegram() {}, status: { supported: true, enabled: true, error: 'The operating system could not show this notification. The operation couldn’t be completed. (UNErrorDomain error 1.)' } });
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Not in this build');
    expect(document.querySelector('section')?.textContent).toContain('macOS shows notifications only from apps signed with an Apple Developer ID.');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Set up Telegram']);
  });

  it('says Telegram still reaches the person when it is already on', () => {
    const document = render({ needsSignedBuild: true, telegramReady: true, onUseTelegram() {} });
    expect(document.querySelector('section')?.textContent).toContain('Your Telegram channel still reaches you.');
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('waits for the first check before deciding a build is unsigned', () => {
    expect(render({ needsSignedBuild: true, checking: true, status: null }).querySelector('[role="status"]')?.textContent).toBe('Checking…');
  });

  it('opens System Settings when a signed build is blocked there', () => {
    const blocked = { supported: true, enabled: true, error: 'macOS is blocking notifications from Ri. Open System Settings, then Notifications, choose Ri and turn on Allow notifications.' };
    const document = render({ status: blocked, localControls: true, canOpenSystemSettings: true, onOpenSystemSettings() {} });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(blocked.error);
    expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Open Notification Settings', 'Check again']);
    // An older desktop without the shortcut keeps its own controls.
    expect(render({ status: blocked, localControls: true }).querySelector('button')?.textContent).toBe('Disable desktop notifications');
  });

  it('turns notifications on in place from a connected Home when the desktop can ask natively', () => {
    expect(render({ localControls: true, canOpenSettings: true }).querySelector('button')?.textContent).toBe('Enable desktop notifications');
  });
});

describe('desktopNeedsSignedBuild', () => {
  it('holds for a Mac build without an Apple signature, including older desktops that can’t say', async () => {
    const { desktopNeedsSignedBuild } = await import('@/lib/notifications/desktop-contract');
    expect(desktopNeedsSignedBuild('darwin', { appSigned: false })).toBe(true);
    expect(desktopNeedsSignedBuild('darwin', {})).toBe(true);
    expect(desktopNeedsSignedBuild('darwin', null)).toBe(true);
    expect(desktopNeedsSignedBuild('darwin', { appSigned: true })).toBe(false);
    expect(desktopNeedsSignedBuild('linux', {})).toBe(false);
    expect(desktopNeedsSignedBuild(undefined, null)).toBe(false);
  });
});
