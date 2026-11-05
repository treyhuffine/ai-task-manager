import fs from 'node:fs';
import { expect, it } from 'vitest';
import { integrationMeta } from '@/components/integrations/integration-meta';
import { SLACK_ACCOUNT_USER_SCOPES, slackAccountCreateUrl, slackAccountManifest } from './slack-account-setup';

it('prefills Slack app creation with the current callback and the published MCP user permissions', () => {
  const callback = 'https://ri.example/api/integrations/mcp-oauth/builtin_slack';
  const url = new URL(slackAccountCreateUrl(integrationMeta('slack').appUrl!, callback)!);
  expect(url.origin + url.pathname).toBe('https://api.slack.com/apps');
  expect(url.searchParams.get('new_app')).toBe('1');
  const manifest = JSON.parse(url.searchParams.get('manifest_json')!);
  expect(manifest.oauth_config.redirect_urls).toEqual([callback]);
  const captured = JSON.parse(fs.readFileSync(new URL('../../../docs/integration-audit/fifth-wave-discovery.json', import.meta.url), 'utf8'));
  const published = captured.records.find((record: { id: string }) => record.id === 'slack').discovery.resourceMetadata.scopes_supported;
  expect(manifest.oauth_config.scopes.user).toEqual(published);
  expect(SLACK_ACCOUNT_USER_SCOPES).toHaveLength(30);
  expect(manifest.oauth_config.scopes).not.toHaveProperty('bot');
  expect(manifest.oauth_config).not.toHaveProperty('pkce_enabled');
  expect(manifest).not.toHaveProperty('settings');
});

it('uses each Ri address without keeping a previous callback or adding credentials to the link', () => {
  const manifest = slackAccountManifest('https://another-ri.example/api/integrations/mcp-oauth/builtin_slack');
  expect(manifest.oauth_config.redirect_urls).toEqual(['https://another-ri.example/api/integrations/mcp-oauth/builtin_slack']);
  expect(Object.keys(manifest)).toEqual(['display_information', 'oauth_config']);
});

it('does not create an app link when Ri has no callback address', () => {
  expect(slackAccountCreateUrl(integrationMeta('slack').appUrl!, '')).toBeNull();
});
