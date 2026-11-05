/** Test harness: the real action definitions over a temporary data directory, with fake invocations. All data is fictional. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError, ContractValidator, type InvocationAccess } from "@ri/app-kit/contract";
import { generateContract, type AppInvocation } from "@ri/app-kit/sdk";
import { definition, initialize, instance, shutdown } from "../src/actions.js";

const validator = new ContractValidator();
const contract = generateContract(definition);
const created: string[] = [];

export type Capability = (name: string, input: Record<string, unknown>) => unknown | Promise<unknown>;
export interface Caller { principal: AppInvocation["principal"]; audience: AppInvocation["audience"]; access: InvocationAccess | null }
export const owner = (): Caller => ({ principal: { kind: "owner-ui", id: "owner" }, audience: "user", access: { protocol: "ri-access-v1", actorId: "owner-ui:owner", scopeRef: null, accounts: [] } });
export const chat = (id: string, scopeRef: string | null): Caller => ({ principal: { kind: "chat", id }, audience: "agent", access: { protocol: "ri-access-v1", actorId: `chat:${id}`, scopeRef, accounts: [] } });
export const job = (id = "schedule-1"): Caller => ({ principal: { kind: "job", id }, audience: "schedule", access: { protocol: "ri-access-v1", actorId: `job:${id}`, scopeRef: null, accounts: [] } });
export const fixture = (): Caller => ({ principal: { kind: "fixture", id: "preview", fixtureAudience: "user" }, audience: "user", access: { protocol: "ri-access-v1", actorId: "fixture:preview", scopeRef: null, accounts: [] } });

export interface Harness {
  setNow(iso: string): void;
  capability: Capability;
  call<T = any>(action: string, input: unknown, caller?: Caller, options?: { id?: string; capability?: Capability }): Promise<T>;
}
export async function harness(options: { now?: string; capability?: Capability } = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bookmarks-test-"));
  created.push(dir);
  let now = new Date(options.now ?? "2026-10-15T12:00:00.000Z");
  await initialize({ dataDir: dir, cacheDir: dir, packageDigest: "a".repeat(64), contractDigest: "", contract, bindings: [], instanceId: randomUUID() }, { now: () => now });
  const h: Harness = {
    setNow(iso) { now = new Date(iso); },
    capability: options.capability ?? (() => { throw new AppError("unsupported", "No capability in this test"); }),
    async call(name, input, caller = owner(), callOptions = {}) {
      const action = definition.actions.find((item) => item.name === name);
      if (!action) throw new Error(`Unknown action ${name}`);
      const descriptor = contract.actions.find((item) => item.name === name)!;
      if (!action.audience.includes(caller.audience)) throw new AppError("forbidden", "This action is unavailable to this caller");
      validator.check(descriptor.inputSchema, input, `Invalid input for ${name}`);
      const invocation: AppInvocation = {
        id: callOptions.id ?? randomUUID(), principal: caller.principal, audience: caller.audience, grantRevision: 0, deadline: Date.now() + descriptor.timeoutMs,
        packageDigest: "a".repeat(64), signal: new AbortController().signal, access: caller.access,
        capability: async (capabilityName, capabilityInput) => (callOptions.capability ?? h.capability)(capabilityName, capabilityInput as Record<string, unknown>),
      };
      const result = await action.handler(action.input.parse(input), invocation);
      validator.check(descriptor.outputSchema, result, `Invalid output for ${name}: ${JSON.stringify(result).slice(0, 400)}`);
      return result as never;
    },
  };
  return h;
}
export function cleanup() {
  shutdown();
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
export { instance };
