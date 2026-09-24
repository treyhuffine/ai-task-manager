import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalPath,
  checkResolvedPaths,
  checkRootConfig,
  isolatedEnv,
  isScrubbedVar,
  isWithin,
  tunnelLabel,
} from './dev-isolation';

const ROOT = '/Users/me/ri-homes';
const SHARED = ['/Users/me/ri', '/Users/me/ri-dev', '/Users/me/ri-test'];

function resolvedUnder(root: string) {
  return {
    appRoot: root,
    dbPath: `${root}/data.db`,
    configDir: `${root}/.config`,
    workDir: `${root}/.work`,
    attachmentsDir: `${root}/attachments`,
  };
}

describe('isScrubbedVar', () => {
  it('removes app overrides and the inherited caller credential', () => {
    expect(isScrubbedVar('RI_ROOT')).toBe(true);
    expect(isScrubbedVar('RI_DB_PATH')).toBe(true);
    expect(isScrubbedVar('RI_SESSION_CREDENTIAL')).toBe(true);
  });

  it("removes the running Claude Code session's identity and socket", () => {
    for (const name of [
      'CLAUDECODE',
      'CLAUDE_PID',
      'CLAUDE_EFFORT',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_CHILD_SESSION',
    ]) {
      expect(isScrubbedVar(name)).toBe(true);
    }
  });

  it('keeps backend selection and unrelated variables', () => {
    expect(isScrubbedVar('CLAUDE_CODE_USE_BEDROCK')).toBe(false);
    expect(isScrubbedVar('OPENAI_API_KEY')).toBe(false);
    expect(isScrubbedVar('PATH')).toBe(false);
    expect(isScrubbedVar('HOME')).toBe(false);
  });
});

describe('isolatedEnv', () => {
  it('pins all four data paths under the root and drops inherited overrides', () => {
    const { env, removed } = isolatedEnv(
      {
        PATH: '/bin',
        RI_ROOT: '/Users/me/ri',
        RI_DB_PATH: '/Users/me/ri/data.db',
        RI_SESSION_CREDENTIAL: 'chat.sig',
        CLAUDECODE: '1',
      },
      { root: ROOT, port: 42251 },
    );
    expect(env.RI_ROOT).toBe(ROOT);
    expect(env.RI_DB_PATH).toBe(`${ROOT}/data.db`);
    expect(env.RI_CONFIG_DIR).toBe(`${ROOT}/.config`);
    expect(env.RI_WORK_DIR).toBe(`${ROOT}/.work`);
    expect(env.PORT).toBe('42251');
    expect(env.RI_SESSION_CREDENTIAL).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(removed).toEqual(['CLAUDECODE', 'RI_DB_PATH', 'RI_ROOT', 'RI_SESSION_CREDENTIAL']);
  });

  it('sets a tunnel name only when asked', () => {
    expect(isolatedEnv({}, { root: ROOT }).env.RI_TUNNEL_NAME).toBeUndefined();
    expect(isolatedEnv({}, { root: ROOT, tunnelName: 'ri-trey-dev' }).env.RI_TUNNEL_NAME).toBe(
      'ri-trey-dev',
    );
  });

  it('refuses a relative root', () => {
    expect(() => isolatedEnv({}, { root: 'ri-homes' })).toThrow(/absolute/);
  });
});

describe('isWithin', () => {
  it('matches the folder itself and anything below it', () => {
    expect(isWithin('/a/b', '/a/b')).toBe(true);
    expect(isWithin('/a/b/c', '/a/b')).toBe(true);
  });

  it('does not match a sibling that shares a prefix', () => {
    expect(isWithin('/Users/me/ri-homes', '/Users/me/ri')).toBe(false);
    expect(isWithin('/Users/me/ri-dev/data.db', '/Users/me/ri')).toBe(false);
  });
});

describe('checkResolvedPaths', () => {
  it('passes when every path is under the isolated root', () => {
    expect(checkResolvedPaths(resolvedUnder(ROOT), ROOT, SHARED)).toEqual([]);
  });

  it('flags a path that escaped to the production home', () => {
    const resolved = { ...resolvedUnder(ROOT), dbPath: '/Users/me/ri/data.db' };
    const problems = checkResolvedPaths(resolved, ROOT, SHARED);
    expect(problems.join('\n')).toMatch(/dbPath resolves outside the isolated root/);
    expect(problems.join('\n')).toMatch(/dbPath resolves inside the shared root \/Users\/me\/ri:/);
  });

  it('refuses a shared root used as the isolated root', () => {
    const problems = checkResolvedPaths(resolvedUnder('/Users/me/ri-dev'), '/Users/me/ri-dev', SHARED);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('refuses a root that contains a shared root', () => {
    const problems = checkResolvedPaths(resolvedUnder('/Users/me'), '/Users/me', SHARED);
    expect(problems.join('\n')).toMatch(/contains the shared root/);
  });
});

describe('following symlinks', () => {
  it('catches a work dir that links into a protected root', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-iso-link-'));
    try {
      const protectedRoot = path.join(base, 'ri');
      const isolated = path.join(base, 'ri-homes');
      fs.mkdirSync(path.join(protectedRoot, '.work'), { recursive: true });
      fs.mkdirSync(isolated);
      fs.symlinkSync(path.join(protectedRoot, '.work'), path.join(isolated, '.work'));
      const problems = checkResolvedPaths(resolvedUnder(isolated), isolated, [protectedRoot]);
      expect(problems.join('\n')).toMatch(/workDir resolves outside the isolated root/);
      expect(problems.join('\n')).toMatch(/workDir resolves inside the shared root/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('catches an isolated root that is itself a link to a protected root', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-iso-link-'));
    try {
      const protectedRoot = path.join(base, 'ri');
      fs.mkdirSync(protectedRoot);
      const alias = path.join(base, 'ri-homes');
      fs.symlinkSync(protectedRoot, alias);
      expect(checkResolvedPaths(resolvedUnder(alias), alias, [protectedRoot]).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('resolves a path that does not exist yet through its nearest existing parent', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-iso-canon-')));
    try {
      expect(canonicalPath(path.join(base, 'not', 'yet'))).toBe(path.join(base, 'not', 'yet'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('tunnelLabel', () => {
  it('reads the first DNS label', () => {
    expect(tunnelLabel('https://ri-trey.beamd.run')).toBe('ri-trey');
    expect(tunnelLabel(null)).toBeNull();
    expect(tunnelLabel('not a url')).toBeNull();
  });
});

describe('checkRootConfig', () => {
  const production = {
    localToken: 'prod-token',
    tunnelUrl: 'https://ri-trey.beamd.run',
    tunnelName: null,
  };

  it('passes a fresh root', () => {
    expect(checkRootConfig(null, production)).toEqual([]);
    expect(checkRootConfig({ localToken: 'dev-token', globalSkillEnabled: false }, production)).toEqual([]);
  });

  it("refuses production's token", () => {
    expect(checkRootConfig({ localToken: 'prod-token' }, production).join('\n')).toMatch(/local token/);
  });

  it("refuses production's tunnel, from config or the override", () => {
    expect(checkRootConfig({ tunnelUrl: 'https://ri-trey.beamd.run' }, production)).toHaveLength(1);
    expect(checkRootConfig({}, production, 'ri-trey')).toHaveLength(1);
    expect(checkRootConfig({}, production, 'ri-trey-dev')).toEqual([]);
  });

  it('refuses a machine-wide skill install even without a production config', () => {
    expect(checkRootConfig({ globalSkillEnabled: true }, null).join('\n')).toMatch(/machine-wide/);
  });
});
