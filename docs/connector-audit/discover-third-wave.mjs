import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';

// This audit deliberately permits only public GET requests. It never registers
// a client, authorizes an account, exchanges tokens, or calls an MCP tool.
const candidates = [
  ['intercom', 'https://mcp.intercom.com/mcp'],
  ['miro', 'https://mcp.miro.com/'],
  ['fathom', 'https://api.fathom.ai/mcp'],
  ['read_ai', 'https://api.read.ai/mcp'],
  ['otter', 'https://mcp.otter.ai/mcp'],
  ['ticktick', 'https://mcp.ticktick.com/'],
  ['wrike', 'https://mcp.wrike.com/v2'],
  ['craft', 'https://mcp.craft.do/my/mcp'],
  ['mem', 'https://mcp.mem.ai/mcp'],
  ['reclaim', 'https://mcp.reclaim.ai/'],
  ['fastmail', 'https://api.fastmail.com/mcp'],
];
const records = [];
for (let start = 0; start < candidates.length; start += 4) {
  await Promise.all(candidates.slice(start, start + 4).map(async ([id, endpoint]) => {
    const requests = [];
    const getOnly = async (input, init = {}) => {
      if ((init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET') throw new Error('Only public GET is authorized in this audit');
      const url = input instanceof Request ? input.url : String(input);
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
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
    record.sha256 = createHash('sha256').update(JSON.stringify(record)).digest('hex');
    records.push(record);
    const m = record.discovery?.authorizationServerMetadata;
    console.log(JSON.stringify({ id, endpoint_status: record.endpoint_status, issuer: m?.issuer, registration: m?.registration_endpoint, token_auth: m?.token_endpoint_auth_methods_supported, pkce: m?.code_challenge_methods_supported, scope_count: m?.scopes_supported?.length, error: record.error }));
  }));
}
await fs.writeFile(new URL('./third-wave-discovery.json', import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), method: 'GET-only MCP SDK OAuth discovery, no account authorization or registration', records: records.sort((a, b) => a.id.localeCompare(b.id)) }, null, 2) + '\n');
