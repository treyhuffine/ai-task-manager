import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const coreRoutes = new Set([
  '/tasks', '/tasks/[id]', '/tasks/[id]/complete', '/tasks/[id]/transition', '/tasks/[id]/reorder', '/tasks/[id]/executions',
  '/tasks/attention', '/tasks/counts', '/tasks/deadlines', '/notes', '/notes/[id]', '/areas', '/areas/[id]',
]);
// These are language-neutral, cookie, byte-stream, native-device or discovery protocols.
// A new application JSON route must have a typed procedure instead of joining this list.
const protocolRoutes = new Set([
  '/[transport]', '/attachments', '/attachments/[fileName]', '/capture', '/integrations/[transport]', '/integrations/callback',
  '/integrations/mcp-oauth/[sid]', '/desktop/activity', '/desktop/notifications', '/desktop/oauth/complete', '/desktop/oauth/events',
  '/health', '/live', '/orchestrator/[transport]', '/orchestrator/actions/[name]', '/orchestrator/browser/[transport]', '/orchestrator/results/[transport]', '/playground/chat',
  // Signed harness reports and reviewer completion keep their language-neutral wire contract.
  '/results/reports', '/results/review-reports',
  '/preview/settings/connect-device', '/session', '/sessions/[id]/reply-image', '/sessions/[id]/stream', '/sessions/[id]/terminals/[terminalId]/stream', '/sessions/stream',
  '/stt-bench', '/trpc/[trpc]', '/version', '/webhooks/pebble', '/webhooks/pocket', '/webhooks/triggers/[public_id]',
  '/workers/enroll', '/workers/grants', '/workers/me/associations', '/workers/me/attachments/[fileName]', '/workers/me/commands/[id]/ack',
  '/workers/me/events', '/workers/me/heartbeat', '/workers/me/requests/[id]/result', '/workers/me', '/workers/me/stream',
  '/workers/me/terminals/output', '/workspaces/[id]/terminals/[terminalId]/stream',
]);

describe('complete UI migration coverage', () => {
  it('accounts for every route with a typed procedure or an explicit protocol boundary', () => {
    const mapped = new Set<string>();
    for (const file of ['src/lib/trpc/operation-router.ts', 'src/lib/trpc/results-router.ts']) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'operationContext'
          && node.arguments[2] && ts.isStringLiteral(node.arguments[2])) mapped.add(node.arguments[2].text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const uncovered = files('src/app/api').filter(file => file.endsWith('/route.ts'))
      .map(file => '/' + path.relative('src/app/api', path.dirname(file)))
      .filter(route => !mapped.has(route) && !coreRoutes.has(route) && !protocolRoutes.has(route));
    expect(uncovered).toEqual([]);
    expect(mapped.size).toBeGreaterThan(250);
  });

  it('keeps application JSON consumers on the typed client and query values out of transport options', () => {
    const failures: string[] = [];
    for (const file of ['src/app', 'src/components', 'src/hooks', 'src/lib/api'].flatMap(files)
      .filter(file => /\.tsx?$/.test(file) && !file.includes('.test.') && !file.startsWith('src/app/api/'))) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(source) === 'api' && ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)) {
          const versionDiscovery = file === 'src/components/desktop/service-connection.tsx' && node.arguments[0]?.getText(source) === "'/version'";
          if (!versionDiscovery) failures.push(`${file}: ${node.expression.getText(source)}`);
        }
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'rpcOptions' && ts.isObjectLiteralExpression(node.arguments[0])) {
          if (node.arguments[0].properties.some(property => property.name?.getText(source) === 'query')) failures.push(`${file}: dropped query options`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(failures).toEqual([]);
  });

  it('keeps domain operations independent of HTTP handlers and raw database writes', () => {
    const failures: string[] = [];
    for (const file of files('src/lib/server/operations').filter(file => file.endsWith('.ts'))) {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('@/app/api/') || /\bget(?:Raw)?Db\(|\.prepare\(/.test(source)) failures.push(file);
    }
    expect(failures).toEqual([]);
  });
});
