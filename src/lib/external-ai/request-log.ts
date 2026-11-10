/**
 * One line in the service log for each request an outside app (ChatGPT,
 * Claude) makes to Ri's MCP: which app, and what it asked for. Without it
 * there's no way to tell, when a view stops drawing in ChatGPT, whether
 * ChatGPT fetched the page, called a tool or never asked at all
 * (docs/mcp-oauth.md, "Views"). Names only: never arguments or results,
 * which hold the person's tasks and notes.
 */
import { getApiKey } from '@/lib/db/queries';

interface RpcCall { method?: unknown; params?: { name?: unknown; uri?: unknown } }

/** What each JSON-RPC message in a body asks for: `tools/call show_deck`, `resources/read ui://...`. */
export function describeMcpBody(body: unknown): string[] {
  const calls = (Array.isArray(body) ? body : [body]) as RpcCall[];
  return calls.flatMap(call => {
    if (!call || typeof call.method !== 'string') return [];
    const target = typeof call.params?.name === 'string' ? call.params.name : typeof call.params?.uri === 'string' ? call.params.uri : '';
    return [`${call.method.slice(0, 60)}${target ? ` ${target.slice(0, 120)}` : ''}`];
  });
}

/** Logs an outside app's request. Never throws, and never holds the request up. */
export async function logOutsideAppRequest(request: Request, apiKeyId: string): Promise<void> {
  try {
    if (request.method !== 'POST') return;
    const asked = describeMcpBody(await request.clone().json());
    if (!asked.length) return;
    const key = getApiKey(apiKeyId);
    const app = key?.name ?? 'An outside app';
    console.log(`[mcp] ${app} (${apiKeyId.slice(0, 8)}): ${asked.join(', ')}`);
  } catch {
    // A body that isn't JSON is the transport's to refuse.
  }
}
