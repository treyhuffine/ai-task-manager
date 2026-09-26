import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getConfigDir } from '@/lib/config/paths';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';

const command = z.string().max(4096).refine(value => !value || (path.isAbsolute(value) && !/[\r\n\0]/.test(value)), 'Use an absolute executable path').nullable().optional();
export const EnvironmentInput = z.object({
  CLAUDE_COMMAND: command, CODEX_COMMAND: command, CURSOR_COMMAND: command, OPENCODE_COMMAND: command,
  LOCAL_SPEECH_TO_TEXT_URL: z.string().url().refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }).nullable().optional(),
  GROQ_API_KEY: z.string().max(4096).nullable().optional(), OPENAI_API_KEY: z.string().max(4096).nullable().optional(),
  paths: z.array(z.string().max(4096).refine(value => path.isAbsolute(value) && !value.includes(path.delimiter))).max(30).optional(),
}).strict();
export type EnvironmentSettings = z.infer<typeof EnvironmentInput>;
const secretNames = ['GROQ_API_KEY', 'OPENAI_API_KEY'] as const;
interface Stored { version: 1; values: Omit<EnvironmentSettings, 'GROQ_API_KEY' | 'OPENAI_API_KEY'>; sealed?: string }
function file() { return path.join(getConfigDir(), 'service-environment.json'); }
function keyFile() { return path.join(getConfigDir(), 'service-environment.key'); }
function key(create = false) {
  if (!fs.existsSync(keyFile()) && create) atomicWriteFile(keyFile(), randomBytes(32));
  const value = fs.readFileSync(keyFile());
  if (value.length !== 32) throw new Error('Invalid service environment key');
  return value;
}
function read(): EnvironmentSettings {
  if (!fs.existsSync(file())) return {};
  const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) as Stored;
  if (saved.version !== 1 || !saved.values) throw new Error('Unsupported service environment configuration');
  let secrets = {};
  if (saved.sealed) {
    const data = Buffer.from(saved.sealed, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    secrets = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
  }
  return EnvironmentInput.parse({ ...saved.values, ...secrets });
}
export function environmentStatus() {
  const settings = read();
  const { GROQ_API_KEY, OPENAI_API_KEY, ...values } = settings;
  return { values, secrets: { GROQ_API_KEY: !!(GROQ_API_KEY ?? process.env.GROQ_API_KEY), OPENAI_API_KEY: !!(OPENAI_API_KEY ?? process.env.OPENAI_API_KEY) } };
}
export function saveEnvironment(input: unknown) {
  const patch = EnvironmentInput.parse(input);
  return withFileLock(file(), () => {
    const merged = { ...read(), ...patch };
    for (const [name, value] of Object.entries(merged)) {
      if (name.endsWith('_COMMAND') && value) {
        if (!fs.statSync(String(value)).isFile()) throw new Error(`${name} must name an executable file`);
        fs.accessSync(String(value), fs.constants.X_OK);
      }
    }
    const { GROQ_API_KEY, OPENAI_API_KEY, ...values } = merged;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(true), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify({ GROQ_API_KEY, OPENAI_API_KEY })), cipher.final()]);
    atomicWriteFile(file(), JSON.stringify({ version: 1, values, sealed: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64') }));
    return environmentStatus();
  });
}

/** Finder and service managers don't inherit an interactive shell. Discover
 * common tool directories without executing shell startup scripts. The
 * packaged Node stays first so env-node launchers have a working interpreter. */
export function serviceEnvironment(node: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const settings = read();
  const home = inherited.HOME ?? os.homedir();
  const paths = [path.dirname(node), ...(settings.paths ?? []), ...((inherited.PATH ?? '').split(path.delimiter)),
    path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    ...['.volta/bin', '.asdf/shims', '.cargo/bin', '.bun/bin', '.opencode/bin'].map(name => path.join(home, name))];
  for (const [directory, suffix] of [['.nvm/versions/node', 'bin'], ['.local/share/fnm/node-versions', 'installation/bin']] as const) {
    const base = path.join(home, directory);
    if (fs.existsSync(base)) for (const version of fs.readdirSync(base).sort().reverse()) paths.push(path.join(base, version, suffix));
  }
  const env: NodeJS.ProcessEnv = { ...inherited, PATH: [...new Set(paths.filter(Boolean))].join(path.delimiter) };
  for (const [name, value] of Object.entries(settings)) {
    if (name === 'paths') continue;
    if (value === null || value === '') delete env[name];
    else if (typeof value === 'string') env[name] = value;
  }
  // These secrets are explicitly allowed here, never general renderer env.
  for (const name of secretNames) if (env[name] === '') delete env[name];
  return env;
}
