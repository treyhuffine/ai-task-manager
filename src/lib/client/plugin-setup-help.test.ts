import { describe, expect, it, vi } from 'vitest';
import { sendPluginSetupHelp, type PluginSetupHelpRequest } from './plugin-setup-help';

describe('setup help message delivery', () => {
  it('ensures the app main chat and uses normal delivery with a stable event ID', async () => {
    const ensureMainChat = vi.fn(async () => ({ session: { id: 'app-main' } }));
    const sendMessage = vi.fn(async () => ({}));
    const request = { eventId: 'event-one', content: 'Help with OpenSEO' };
    expect(await sendPluginSetupHelp(request, { ensureMainChat, sendMessage })).toBe('app-main');
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith('app-main', request.content, { eventId: 'event-one' });
  });
  it('retries an indeterminate send against the same chat and ID without creating another main chat', async () => {
    const ensureMainChat = vi.fn(async () => ({ session: { id: 'app-main' } }));
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce({});
    const request: PluginSetupHelpRequest = { eventId: 'same-event', content: 'Setup request' };
    await expect(sendPluginSetupHelp(request, { ensureMainChat, sendMessage })).rejects.toThrow('Network interrupted');
    expect(await sendPluginSetupHelp(request, { ensureMainChat, sendMessage })).toBe('app-main');
    expect(ensureMainChat).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0]).toEqual(sendMessage.mock.calls[1]);
  });
  it('does not send until the main chat can be resolved, and retries resolving on failure', async () => {
    const ensureMainChat = vi.fn().mockRejectedValueOnce(new Error('Home offline')).mockResolvedValueOnce({ session: { id: 'main' } });
    const sendMessage = vi.fn(async () => ({}));
    const request: PluginSetupHelpRequest = { eventId: 'event', content: 'Setup request' };
    await expect(sendPluginSetupHelp(request, { ensureMainChat, sendMessage })).rejects.toThrow('Home offline');
    expect(sendMessage).not.toHaveBeenCalled();
    await sendPluginSetupHelp(request, { ensureMainChat, sendMessage });
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
