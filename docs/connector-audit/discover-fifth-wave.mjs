import fs from 'node:fs/promises';
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';

// Public metadata only. Never register a client or access an account.
const candidates = [
  ['twitter', 'https://api.x.com/mcp'],
  ['slack', 'https://mcp.slack.com/mcp'],
  ['asana', 'https://mcp.asana.com/v2/mcp'],
  ['hubspot', 'https://mcp.hubspot.com/'],
  ['box', 'https://mcp.box.com/'],
  ['zoom', 'https://mcp.zoom.us/mcp/zoom/streamable'],
  ['dropbox', 'https://mcp.dropbox.com/mcp'],
];
const records = await Promise.all(candidates.map(async ([id, endpoint]) => {
  const requests = [];
  const getOnly = async (input, init = {}) => {
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'GET') throw new Error('Only public GET requests are authorized');
    const url = input instanceof Request ? input.url : String(input);
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });
    requests.push({ url, status: response.status, final_url: response.url });
    return response;
  };
  const record = { id, endpoint, checked_at: new Date().toISOString(), requests };
  try {
    const challenge = await getOnly(endpoint, { headers: { Accept: 'application/json, text/event-stream' } });
    record.endpoint_status = challenge.status;
    record.www_authenticate = challenge.headers.get('www-authenticate');
    await challenge.body?.cancel();
    const resourceMetadata = /resource_metadata="([^"]+)"/.exec(record.www_authenticate ?? '')?.[1];
    record.discovery = await discoverOAuthServerInfo(endpoint, { fetchFn: getOnly, ...(resourceMetadata ? { resourceMetadataUrl: new URL(resourceMetadata) } : {}) });
  } catch (error) { record.error = error instanceof Error ? error.message : String(error); }
  console.log(JSON.stringify(record));
  return record;
}));
await fs.writeFile(new URL('./fifth-wave-discovery.json', import.meta.url), JSON.stringify({
  checked_at: new Date().toISOString(),
  method: 'GET-only MCP SDK OAuth discovery. No client registration, authorization or account reads.',
  records,
}, null, 2) + '\n');
