/**
 * Test harness for managed sources: a temporary home, the fake Composio API as the transport, an
 * in-memory connection store, and a real engine runtime with the managed providers registered,
 * so tests exercise the same `runAction` pipeline (pins, approvals, redaction) the app uses.
 * Test-only. Nothing in the app imports it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIntegrationRuntime, createRedactor, createRegistry, staticAuthConfigs, type ApprovalPolicy, type IntegrationRuntime } from '@integrations/engine';
import { inMemoryStore } from '@integrations/engine/testing';
import { getIntegrationSecretBox } from '../storage';
import { createFakeComposio, seedCatalogTools, type FakeComposio } from './composio/fake-composio';
import { forgetValidatedSessions } from './composio/sessions';
import { registerManagedSources, type ManagedBuildResult } from './managed-provider';
import { setSourceServiceDeps } from './service';
import { setComposioTransport } from './source-runtime';

export const FAKE_KEY = 'ak_fake_project_key';

export interface SourcesHarness {
  fake: FakeComposio;
  store: ReturnType<typeof inMemoryStore>;
  configDir: string;
  invalidations: () => number;
  /** A runtime built from the current files, as the app's runtime build would. */
  buildRuntime(opts?: { approval?: ApprovalPolicy }): Promise<{ runtime: IntegrationRuntime; result: ManagedBuildResult; toolsChanged: () => number }>;
  cleanup(): void;
}

export function createSourcesHarness(opts: { directConfigured?: boolean } = {}): SourcesHarness {
  const previous = process.env.RI_CONFIG_DIR;
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-managed-'));
  process.env.RI_CONFIG_DIR = configDir;
  const fake = createFakeComposio({ apiKey: FAKE_KEY });
  seedCatalogTools(fake);
  setComposioTransport({ fetch: fake.fetch, baseUrl: 'https://fake.composio/api/v3.1' });
  const store = inMemoryStore();
  let invalidations = 0;
  setSourceServiceDeps({
    invalidateRuntime: () => { invalidations += 1; },
    connectionStore: () => store,
    ownerId: () => 'local',
    managedSourceStatuses: async () => [],
    directConfigured: async () => opts.directConfigured ?? false,
  });
  forgetValidatedSessions();
  return {
    fake, store, configDir,
    invalidations: () => invalidations,
    async buildRuntime(build = {}) {
      const registry = createRegistry();
      const redactor = createRedactor();
      let toolsChanged = 0;
      const result = await registerManagedSources({ registry, store, redactor, ownerId: 'local', onToolsChanged: () => { toolsChanged += 1; } });
      const runtime = createIntegrationRuntime({
        registry, store, authRequests: store, secretBox: getIntegrationSecretBox(), redactor, authConfigs: staticAuthConfigs([]),
        ...(build.approval ? { approval: build.approval } : {}),
        authorizationRequired: request => `https://ri.test/connect?provider=${request.providerId}${request.existingConnectionId ? `&connection=${request.existingConnectionId}` : ''}`,
      });
      return { runtime, result, toolsChanged: () => toolsChanged };
    },
    cleanup() {
      setComposioTransport(null);
      setSourceServiceDeps(null);
      forgetValidatedSessions();
      if (previous === undefined) delete process.env.RI_CONFIG_DIR;
      else process.env.RI_CONFIG_DIR = previous;
      fs.rmSync(configDir, { recursive: true, force: true });
    },
  };
}
