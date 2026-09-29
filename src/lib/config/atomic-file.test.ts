import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';

it('preserves merges from independent processes sharing the config lock', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-config-race-'));
  const file = path.join(directory, 'config.json');
  const helper = path.resolve('src/lib/config/atomic-file.ts');
  try {
    fs.writeFileSync(file, '{}');
    await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise<void>((resolve, reject) => {
      const script = `const fs=require('node:fs'); const {withFileLock,atomicWriteFile}=require(${JSON.stringify(helper)}); for(let i=0;i<15;i++) withFileLock(${JSON.stringify(file)},()=>{const data=JSON.parse(fs.readFileSync(${JSON.stringify(file)},'utf8'));data[${index}]=(data[${index}]||0)+1;atomicWriteFile(${JSON.stringify(file)},JSON.stringify(data));});`;
      const child = spawn(process.execPath, ['--import', 'tsx', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
      let error = ''; child.stderr.on('data', chunk => { error += chunk; }); child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(error)));
    })));
    expect(Object.values(JSON.parse(fs.readFileSync(file, 'utf8')))).toEqual(Array(6).fill(15));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
