'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- The ownership guardian must bootstrap as CommonJS without importing package code. */
// This guardian executes no package code. It stays responsive even when the
// app hangs, and owns the entire process group after a hard parent crash.
const { spawn } = require('node:child_process');
const entry = process.argv[2];
let child;
let stopping = false;
const buildArgs = process.argv[3] === '--build-args' ? JSON.parse(Buffer.from(process.argv[4], 'base64url').toString('utf8')) : [];
const buildMode = process.argv[3] === '--build-args';
function stop() {
  if (stopping) return;
  stopping = true;
  if (child?.connected) child.disconnect();
  try { process.kill(-process.pid, 'SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch {} process.exit(1); }, 5000);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
child = spawn(process.execPath, [entry, ...buildArgs], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], shell: false });
process.on('message', message => { if (!stopping && child.connected) child.send(message, () => {}); });
child.on('message', message => { if (!stopping && process.connected) process.send(message, () => {}); });
child.on('error', stop);
child.on('exit', code => { if (buildMode && process.connected) process.send({type:'owned-exit',code}, () => {}); if (!stopping) stop(); });
// Never exit on the child's close alone: descendants may still be running.
