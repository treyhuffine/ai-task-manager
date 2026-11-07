import { expect, it } from 'vitest';
import { harnessToolCommand, parseHarnessToolRequest } from './harness-tools';

const node = '/store/release/node/bin/node';

it('installs into the person\'s own folder with the npm that ships with the release', () => {
  const { command, args, env } = harnessToolCommand({ harness: 'codex', action: 'install' }, node, '/Users/me');
  expect(command).toBe(node);
  expect(args).toEqual(['/store/release/node/lib/node_modules/npm/bin/npm-cli.js', 'install', '--global', '--prefix', '/Users/me/.local', '@openai/codex']);
  expect(env.PATH.startsWith('/Users/me/.local/bin:/store/release/node/bin:')).toBe(true);
});

it('signs in with the tool\'s own browser flow', () => {
  expect(harnessToolCommand({ harness: 'claude', action: 'login' }, node, '/Users/me')).toMatchObject({ command: 'claude', args: ['auth', 'login'] });
  expect(harnessToolCommand({ harness: 'codex', action: 'login' }, node, '/Users/me')).toMatchObject({ command: 'codex', args: ['login'] });
});

it.each([null, {}, { harness: 'claude' }, { harness: 'cursor', action: 'install' }, { harness: 'claude', action: 'uninstall' }, { harness: 'claude', action: 'install; rm -rf /' }])('refuses %j, since a page may only pick from the fixed list', value => {
  expect(() => parseHarnessToolRequest(value)).toThrow('Choose Claude Code or Codex');
});
