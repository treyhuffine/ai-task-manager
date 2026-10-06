import { describe, expect, it } from 'vitest';
import type { AuthConfig, AuthConfigStore } from '@integrations/engine';
import { rebaseCallback, withLiveCallback } from './live-callback';

describe('rebaseCallback', () => {
  it('moves Ri\'s own callbacks onto the current origin, path and all', () => {
    expect(rebaseCallback('https://flow-trey.beamd.run/api/integrations/callback', 'https://ri-trey.beamd.run'))
      .toBe('https://ri-trey.beamd.run/api/integrations/callback');
    expect(rebaseCallback('http://localhost:4224/api/integrations/callback', 'https://ri-trey.beamd.run'))
      .toBe('https://ri-trey.beamd.run/api/integrations/callback');
    expect(rebaseCallback('https://flow-trey.beamd.run/api/integrations/mcp-oauth/builtin_linear', 'http://localhost:4224'))
      .toBe('http://localhost:4224/api/integrations/mcp-oauth/builtin_linear');
  });

  it('leaves a callback that is not one of Ri\'s paths alone', () => {
    for (const uri of [
      'https://relay.example.com/oauth/callback',
      'http://127.0.0.1:53111/oauth/callback',
      'https://ri-trey.beamd.run/api/integrations/callback/extra',
      'not a url',
    ]) {
      expect(rebaseCallback(uri, 'https://ri-trey.beamd.run')).toBe(uri);
    }
  });
});

describe('withLiveCallback', () => {
  // The saved Google app from 2026-09-11, added while Ri was Flow.
  const saved: AuthConfig = {
    id: 'google-byo',
    providerId: 'google',
    scheme: 'oauth2',
    label: 'gitconnected',
    scope: 'owner',
    ownerId: 'local',
    oauth: { clientId: 'client.apps.googleusercontent.com', redirectUri: 'https://flow-trey.beamd.run/api/integrations/callback' },
    status: 'active',
  } as AuthConfig;

  const memoryStore = (configs: AuthConfig[]): AuthConfigStore & { written: AuthConfig[] } => {
    const written: AuthConfig[] = [];
    return {
      written,
      async create(config) { written.push(config); },
      async get(id) {
        const config = configs.find((c) => c.id === id);
        return config ? { config, sealedSecret: 'sealed' } : null;
      },
      async listForProvider(providerId) { return configs.filter((c) => c.providerId === providerId); },
      async setDefault() {},
      async setStatus() {},
      async delete() {},
    };
  };

  it('reads a saved app with the callback Ri has now, not the one it was saved with', async () => {
    let origin = 'https://ri-trey.beamd.run';
    const store = withLiveCallback(memoryStore([saved]), () => origin);

    const got = await store.get('google-byo');
    expect(got?.config.oauth?.redirectUri).toBe('https://ri-trey.beamd.run/api/integrations/callback');
    expect(got?.sealedSecret).toBe('sealed');
    expect((await store.listForProvider('google'))[0]?.oauth?.redirectUri)
      .toBe('https://ri-trey.beamd.run/api/integrations/callback');

    // A later address change applies to the next read, with no rebuild.
    origin = 'http://localhost:4224';
    expect((await store.get('google-byo'))?.config.oauth?.redirectUri).toBe('http://localhost:4224/api/integrations/callback');
  });

  it('passes writes through as given and leaves the stored config untouched', async () => {
    const inner = memoryStore([saved]);
    const store = withLiveCallback(inner, () => 'https://ri-trey.beamd.run');
    await store.create({ ...saved, id: 'another' });
    expect(inner.written[0]?.oauth?.redirectUri).toBe('https://flow-trey.beamd.run/api/integrations/callback');
    expect(saved.oauth?.redirectUri).toBe('https://flow-trey.beamd.run/api/integrations/callback');
  });

  it('returns null for an unknown app', async () => {
    const store = withLiveCallback(memoryStore([saved]), () => 'https://ri-trey.beamd.run');
    expect(await store.get('missing')).toBeNull();
  });
});
