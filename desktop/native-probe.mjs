import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const runtime = createRequire(path.join(process.cwd(), 'package.json'));

// Resolve against the working folder so packaging checks the deployed graph.
setTimeout(() => { console.error('Native dependency probe timed out'); process.exit(1); }, 30_000).unref();
void (async () => {
  const db = new (runtime('better-sqlite3'))(':memory:');
  runtime('sqlite-vec').load(db);
  console.info('SQLite/vector:', db.prepare('select vec_version() version').get());
  db.close();
  const nextModules = path.join(process.cwd(), '.next-desktop/node_modules');
  if (fs.existsSync(nextModules)) for (const name of fs.readdirSync(nextModules).filter(name => /^sqlite-vec-[a-f0-9]+$/.test(name))) {
    for (const adapter of [runtime(path.join(nextModules, name)), await import(pathToFileURL(path.join(nextModules, name, 'index.mjs')).href)]) {
      const nextDb = new (runtime('better-sqlite3'))(':memory:');
      try {
        adapter.load(nextDb);
        assert(nextDb.prepare('select vec_version() version').get().version);
      } finally { nextDb.close(); }
    }
    console.info('Next SQLite/vector CJS and ESM external:', name);
  }
  assert(runtime('@napi-rs/canvas').createCanvas(2, 2).toBuffer('image/png').length);
  assert((await runtime('sharp')({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer()).length);
  console.info('Canvas/sharp ready');
  await new Promise((resolve, reject) => {
    const terminal = runtime('node-pty').spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/echo',
      process.platform === 'win32' ? ['/c', 'echo PTY ready'] : ['PTY ready']);
    let output = '';
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
      try {
        if (process.platform === 'win32') terminal.kill();
        assert.equal(exitCode, 0);
        assert(output.includes('PTY ready'));
        console.info('PTY output and natural exit verified');
        resolve();
      } catch (error) { reject(error); }
    });
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
