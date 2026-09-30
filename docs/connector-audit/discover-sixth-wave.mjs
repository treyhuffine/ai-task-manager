import fs from 'node:fs/promises';
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';

// This capture is intentionally read-only. Never register OAuth clients or
// request account data while qualifying public discovery metadata.
const candidates = [
  ['robinhood', 'https://agent.robinhood.com/mcp/trading'],
  ['posthog', 'https://mcp.posthog.com/mcp'],
  ['paypal-production', 'https://mcp.paypal.com/http'],
  ['paypal-sandbox', 'https://mcp.sandbox.paypal.com/http'],
  ['paypal-production-current', 'https://mcp.paypal.com/mcp'],
  ['paypal-sandbox-current', 'https://mcp.sandbox.paypal.com/mcp'],
  ['docusign-production', 'https://mcp.docusign.com/mcp'],
  ['docusign-demo', 'https://mcp-d.docusign.com/mcp'],
];
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
    const resourceMetadata = /resource_metadata="([^"]+)"/.exec(record.www_authenticate ?? '')?.[1];
    record.discovery = await discoverOAuthServerInfo(endpoint, { fetchFn: getOnly,
      ...(resourceMetadata ? { resourceMetadataUrl: new URL(resourceMetadata) } : {}) });
  } catch (error) { record.error = error instanceof Error ? error.message : String(error); }
  return record;
}));
await fs.writeFile(new URL('./sixth-wave-discovery.json', import.meta.url), `${JSON.stringify({
  checked_at: new Date().toISOString(),
  method: 'GET-only MCP SDK OAuth discovery. No client registration, authorization or account reads.', records,
}, null, 2)}\n`);
for (const record of records) console.log(JSON.stringify(record));
