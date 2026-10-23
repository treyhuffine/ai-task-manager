/** The ordinary SDK server pool, with a local fake binary and no provider account. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('gives separate Homes distinct authenticated OpenCode listeners even for the same project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-opencode-homes-')); roots.push(root);
  const binary = path.join(root, 'fake-opencode.cjs');
  fs.writeFileSync(binary, `const http=require('node:http');const args=process.argv;const port=Number(args[args.indexOf('--port')+1]);if(!port)throw Error('Native OpenCode requires an explicit assigned port');const expected='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64');const server=http.createServer((req,res)=>{if(req.headers.authorization!==expected){res.writeHead(401);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({home:process.env.FIXTURE_HOME}));});server.listen(port,'127.0.0.1',()=>console.log('opencode server listening on http://127.0.0.1:'+port));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  const location = new URL('./providers/opencode/server.js', import.meta.resolve('@agentex/agent'));
  const { acquireOpenCodeServer } = await import(/* @vite-ignore */ pathToFileURL(location.pathname).href) as { acquireOpenCodeServer(binary: string, args: string[], env: Record<string, string>, cwd: string): Promise<{ client: { baseUrl: string; json(path: string): Promise<unknown> }; retire(input: { force: boolean }): Promise<void>; release(): void }> };
  const personal = await acquireOpenCodeServer(process.execPath, [binary], { ...process.env, FIXTURE_HOME: 'personal' } as Record<string, string>, root);
  let team: Awaited<ReturnType<typeof acquireOpenCodeServer>> | undefined;
  try {
    team = await acquireOpenCodeServer(process.execPath, [binary], { ...process.env, FIXTURE_HOME: 'team' } as Record<string, string>, root);
    expect(personal.client.baseUrl).not.toBe(team.client.baseUrl);
    expect(await personal.client.json('/who')).toEqual({ home: 'personal' });
    expect(await team.client.json('/who')).toEqual({ home: 'team' });
    expect((await fetch(team.client.baseUrl + '/who')).status).toBe(401);
  } finally { await personal.retire({ force: true }); personal.release(); if (team) { await team.retire({ force: true }); team.release(); } }
}, 30_000);
