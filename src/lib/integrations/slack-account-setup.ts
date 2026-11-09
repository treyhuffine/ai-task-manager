import { APP_NAME } from '@/constants/app';

// Slack's published MCP consent scopes. Keep app creation aligned with its public
// resource metadata, which remains authoritative for the actual OAuth request.
export const SLACK_ACCOUNT_USER_SCOPES = [
  'canvases:read', 'canvases:write',
  'channels:history', 'channels:read', 'channels:write', 'chat:write', 'emoji:read',
  'files:read', 'files:write', 'groups:history', 'groups:read', 'groups:write',
  'im:history', 'im:read', 'im:write', 'lists:read', 'lists:write',
  'mpim:history', 'mpim:read', 'mpim:write', 'reactions:read', 'reactions:write',
  'search:read.files', 'search:read.im', 'search:read.mpim', 'search:read.private',
  'search:read.public', 'search:read.users', 'users:read', 'users:read.email',
] as const;

export function slackAccountManifest(redirectUri: string) {
  return {
    display_information: { name: `${APP_NAME} Slack account` },
    oauth_config: {
      redirect_urls: [redirectUri],
      scopes: { user: [...SLACK_ACCOUNT_USER_SCOPES] },
    },
    settings: { is_mcp_enabled: true },
  };
}

/** Only link to Slack's known app settings, never an arbitrary URL from a remote error. */
export function slackMcpAccessIssue(error?: string | null): { settingsUrl: string } | null {
  if (!error?.includes('App is not enabled for Slack MCP server access')) return null;
  const appId = error.replaceAll('\\/', '/').match(/https:\/\/api\.slack\.com\/apps\/(A[A-Z0-9]+)\/app-assistant\b/)?.[1];
  return { settingsUrl: appId ? `https://api.slack.com/apps/${appId}/app-assistant` : 'https://api.slack.com/apps' };
}

/** Slack's documented app-creation link accepts a URL-encoded manifest. */
export function slackAccountCreateUrl(appUrl: string, redirectUri: string): string | null {
  if (!redirectUri) return null;
  const url = new URL(appUrl);
  url.searchParams.set('manifest_json', JSON.stringify(slackAccountManifest(redirectUri)));
  return url.toString();
}
