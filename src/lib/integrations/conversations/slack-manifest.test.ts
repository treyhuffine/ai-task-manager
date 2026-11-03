import { expect, it } from 'vitest';
import { z } from 'zod/v4';
import { slackConversationManifest } from './slack';

// Slack's published field contract, rather than a snapshot of our generator.
// https://docs.slack.dev/reference/app-manifest/#features
const appearance = z.object({
  display_information: z.object({ name: z.string().min(1).max(35) }),
  features: z.object({
    app_home: z.object({ messages_tab_enabled: z.literal(true), messages_tab_read_only_enabled: z.literal(false) }).strict(),
    bot_user: z.object({ display_name: z.string().regex(/^[a-z0-9_.-]{1,80}$/) }).strict(),
    agent_view: z.object({ agent_description: z.string().min(1).max(300) }).strict(),
  }).strict(),
});

it.each(['Ri Personal', 'Ri Team (Product)', '日本語', 'a'.repeat(35)])('generates valid Slack agent appearance and writable DMs for %s', name => {
  const manifest = slackConversationManifest(name);
  expect(appearance.safeParse(manifest).success).toBe(true);
  expect(manifest.display_information.name).toBe(name);
  expect(manifest.settings.socket_mode_enabled).toBe(true);
  expect(manifest.oauth_config.scopes.bot).toEqual(expect.arrayContaining(['assistant:write', 'app_mentions:read', 'chat:write', 'im:history']));
  expect(manifest.settings.event_subscriptions.bot_events).toEqual(expect.arrayContaining(['app_home_opened', 'app_mention', 'message.im', 'agent_session_stopped']));
});

it('rejects the unsupported agent_view.enabled field that Slack reported', () => {
  const manifest = slackConversationManifest('Ri Personal');
  expect(appearance.safeParse({ ...manifest, features: { ...manifest.features, agent_view: { enabled: true } } }).success).toBe(false);
});

it('rejects names outside Slack’s app-name limit before a manifest can be copied', () => {
  expect(() => slackConversationManifest('a'.repeat(36))).toThrow();
  expect(() => slackConversationManifest('   ')).toThrow();
});
