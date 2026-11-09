import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const runtime = createRequire(path.join(process.cwd(), 'package.json'));

setTimeout(() => { console.error('Native dependency probe timed out'); process.exit(1); }, 30_000).unref();
void (async () => {
  const db = new (runtime('better-sqlite3'))(':memory:');
  runtime('sqlite-vec').load(db);
  assert(db.prepare('select vec_version() version').get().version);
  db.close();
  assert(runtime('@napi-rs/canvas').createCanvas(2, 2).toBuffer('image/png').length);
  assert((await runtime('sharp')({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer()).length);
  await new Promise((resolve, reject) => {
    const terminal = runtime('node-pty').spawn('/bin/echo', ['PTY ready']);
    let output = '';
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
      try { assert.equal(exitCode, 0); assert(output.includes('PTY ready')); resolve(); }
      catch (error) { reject(error); }
    });
  });
  console.info('Native SQLite/vector, canvas, sharp and PTY passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
