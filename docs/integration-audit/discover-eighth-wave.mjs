import fs from 'node:fs/promises';
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';

// Public discovery only. Do not register clients, authorize accounts or call tools.
// DataForSEO answers an anonymous GET with 405 and no challenge, so one anonymous
// MCP initialization POST records the 401 challenge that names the scope.
const candidates = [
  ['dataforseo', 'https://mcp.dataforseo.com/v3/mcp'],
];
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'discovery', version: '0' },
} };
const records = await Promise.all(candidates.map(async ([id, endpoint]) => {
  const requests = [];
  const getOnly = async (input, init = {}) => {
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'GET') throw new Error('Public GET requests only');
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });
    requests.push({ url: input instanceof Request ? input.url : String(input), status: response.status, final_url: response.url });
    return response;
  };
  const record = { id, endpoint, checked_at: new Date().toISOString(), requests };
  try {
    const response = await getOnly(endpoint, { headers: { Accept: 'application/json, text/event-stream' } });
    record.endpoint_status = response.status;
    record.www_authenticate = response.headers.get('www-authenticate');
    await response.body?.cancel();
    const challenge = await fetch(endpoint, { method: 'POST', body: JSON.stringify(initialize), signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' } });
    record.initialize_status = challenge.status;
    record.initialize_www_authenticate = challenge.headers.get('www-authenticate');
    await challenge.body?.cancel();
    const challenged = record.www_authenticate ?? record.initialize_www_authenticate ?? '';
    const resourceMetadata = /resource_metadata="([^"]+)"/.exec(challenged)?.[1];
    record.discovery = await discoverOAuthServerInfo(endpoint, { fetchFn: getOnly,
      ...(resourceMetadata ? { resourceMetadataUrl: new URL(resourceMetadata) } : {}) });
  } catch (error) { record.error = error instanceof Error ? error.message : String(error); }
  return record;
}));
await fs.writeFile(new URL('./eighth-wave-discovery.json', import.meta.url), `${JSON.stringify({
  checked_at: new Date().toISOString(),
  method: 'GET-only MCP SDK OAuth discovery, plus one anonymous initialization POST for the challenge. No client registration, authorization or account reads.', records,
}, null, 2)}\n`);
for (const record of records) console.log(JSON.stringify(record));
