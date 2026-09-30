/**
 * Opt-in, read-only qualification for the four pending hosted task pickers.
 *
 * pnpm tsx scripts/capture-task-picker-contract.ts --server <existing-server-id> --output /tmp/tools.json
 * pnpm tsx scripts/capture-task-picker-contract.ts --server <existing-server-id> --output /tmp/sample.json --read filter_tasks --input /tmp/arguments.json
 *
 * Default: tools/list only. A sample requires an explicit read + argument file.
 * Uses an existing access token without OAuth registration, login or refresh.
 * Output is a new 0600 file. Sample files may contain private task data.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRedactor } from '@connectors/engine';
import { connectMcpClient } from '@connectors/engine/mcp';
import { captureTaskPickerContract, TASK_PICKER_QUALIFICATION_READS, type TaskPickerQualificationProvider } from '../src/lib/connectors/task-picker-contract';

const redactor = createRedactor();

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: pnpm tsx scripts/capture-task-picker-contract.ts --server <existing-server-id> --output <new-file> [--read <tool-name> --input <arguments.json>]');
    return;
  }
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--server', '--output', '--read', '--input'].includes(name) || !value || value.startsWith('--') || options.has(name)) {
      throw new Error('Use --help for the required options.');
    }
    options.set(name, value);
  }
  const serverId = options.get('--server');
  const output = options.get('--output');
  if (!serverId || !output || options.has('--read') !== options.has('--input')) throw new Error('Use --help for the required options.');
  const outputPath = path.resolve(output);
  // Validate the destination before touching any account. Never overwrite data.
  try { await fs.lstat(outputPath); throw new Error('The output file already exists. Choose a new path.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  const { getMcpServerStore, mcpAuthHeaders, withTimeout, MCP_TIMEOUT_MS } = await import('../src/lib/connectors/runtime');
  const { hostedMcpDefinition } = await import('../src/lib/connectors/hosted-mcp');
  const { isCurrentMcpTransport } = await import('../src/lib/connectors/mcp-lifecycle');
  const { registerMcpSecrets } = await import('../src/lib/connectors/mcp-secrets');
  const store = getMcpServerStore();
  const entry = store.get(serverId);
  const definition = entry ? hostedMcpDefinition(entry) : undefined;
  if (!entry?.enabled || !definition || !(definition.id in TASK_PICKER_QUALIFICATION_READS)) {
    throw new Error('Select an enabled built-in ClickUp, Trello, TickTick or Wrike server from Settings.');
  }

  let headers: Record<string, string> | undefined;
  if (entry.auth.kind === 'oauth') {
    const state = await store.getOAuthState(entry.id);
    registerMcpSecrets(redactor, state ?? {});
    const tokens = state?.tokens as { access_token?: unknown } | undefined;
    if (typeof tokens?.access_token !== 'string' || !tokens.access_token) throw new Error('Connect this account in Settings before capturing its contract.');
    headers = { Authorization: `Bearer ${tokens.access_token}` };
  } else {
    const secret = await store.openSecret(entry.id);
    if (!secret) throw new Error('Connect this account in Settings before capturing its contract.');
    redactor.register(secret, 'credential');
    headers = mcpAuthHeaders(entry.auth, secret);
  }
  let sample: { tool: string; input: Record<string, unknown> } | undefined;
  if (options.has('--read')) {
    const input: unknown = JSON.parse(await fs.readFile(options.get('--input')!, 'utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The input file must contain a JSON argument object.');
    sample = { tool: options.get('--read')!, input: input as Record<string, unknown> };
  }
  const client = await withTimeout(connectMcpClient({ url: entry.url, name: 'task-picker-qualification', headers }), MCP_TIMEOUT_MS, 'Connect task-picker qualification', (late) => late.close());
  try {
    const assertCurrent = () => {
      if (!isCurrentMcpTransport(entry, store)) throw new Error('The selected account changed. Restart the capture.');
    };
    const capture = await captureTaskPickerContract(definition.id as TaskPickerQualificationProvider, {
      listTools: () => { assertCurrent(); return withTimeout(client.listTools(), MCP_TIMEOUT_MS, 'Discover task-picker tools'); },
      callTool: (input) => { assertCurrent(); return withTimeout(client.callTool(input), 30_000, 'Read task-picker sample'); },
    }, sample);
    assertCurrent();
    await fs.writeFile(outputPath, `${JSON.stringify(redactor.redact(capture), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Saved ${sample ? 'tool definitions and the requested private sample' : 'tool definitions'} to ${outputPath}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(redactor.redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
