import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {z} from 'zod/v4';
import { processState } from "@/lib/process-state";
import { getConfigDir } from "@/lib/config/paths";
import {
  financeOwner,
  grantFinance,
  financeGrantList,
  revokeFinancePrincipal,
  getFinanceSettings,
  type FinancePrincipal,
} from "@/lib/db/finance-queries";
type Lease = {
  principal: FinancePrincipal;
  expiresAt: number;
  ticket: string | null;
  actorId: string;
  authority: string | null;
};
const state = processState<{
  enabled: boolean;
  fixture: boolean;
  instanceId: string;
  broker: { url: string; token: string } | null;
  leases: Map<string, Lease>;
  tickets: AsyncLocalStorage<string | null>;
}>("finance.local-app", () => ({
  enabled: false,
  fixture: false,
  instanceId: "",
  broker: null,
  leases: new Map(),
  tickets: new AsyncLocalStorage(),
}));
export function initializeManaged(
  instanceId: string,
  broker: { url: string; credential: string } | null,
  fixture = false,
) {
  state.enabled = true;
  state.fixture = fixture;
  state.instanceId = instanceId;
  state.broker = broker ? { url: broker.url, token: broker.credential } : null;
  state.leases.clear();
}
export function managedMode() {
  return state.enabled;
}
export function managedBroker() {
  return state.broker;
}
export function managedInstanceId() {
  return state.instanceId;
}
export function invocationTicket() {
  return state.tickets.getStore() ?? null;
}
export function withInvocationTicket<T>(
  ticket: string | null,
  operation: () => T,
) {
  return state.tickets.run(ticket, operation);
}
const scopesFile = () => path.join(getConfigDir(), "managed-scopes.json");
const scopeRegistry=z.object({formatVersion:z.literal(1),scopes:z.array(z.object({id:z.string().uuid(),actorId:z.string().regex(/^(chat|workspace|job|background):[a-zA-Z0-9-]{1,128}$/),createdAt:z.iso.datetime()}).strict()).max(1000)}).strict();
function scopes(): z.infer<typeof scopeRegistry>['scopes'] {
  try {
    if(fs.statSync(scopesFile()).size>512000) throw new Error('Oversized scope metadata');
    const result=scopeRegistry.parse(JSON.parse(fs.readFileSync(scopesFile(), "utf8"))).scopes;
    if(new Set(result.map(item=>item.id)).size!==result.length)throw new Error('Duplicate scopes');
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Managed finance scopes need repair");
  }
}
function writeScopes(all:z.infer<typeof scopeRegistry>['scopes']) {
  const temporary=scopesFile()+'.tmp-'+randomUUID();fs.writeFileSync(temporary,JSON.stringify({formatVersion:1,scopes:all}),{mode:0o600});fs.renameSync(temporary,scopesFile());
}
export function listManagedScopes(p:FinancePrincipal) {
  if(!p.owner)throw new Error('Owner setup required');
  return {scopes:scopes().map(scope=>{const grants=financeGrantList(p).filter(grant=>grant.principal==='client:'+scope.id&&!grant.revoked);return {scopeRef:scope.id,actorId:scope.actorId,accountIds:grants.map(grant=>grant.accountId),operations:[...new Set(grants.flatMap(grant=>grant.operations))]};})};
}
export function revokeManagedScope(p:FinancePrincipal,input:{scopeRef:string}) {
  if(!p.owner)throw new Error('Owner setup required');
  const all=scopes();if(!all.some(scope=>scope.id===input.scopeRef))throw new Error('Finance account scope not found');
  revokeFinancePrincipal(p,'client:'+input.scopeRef);
  for(const [token,lease] of state.leases)if(lease.principal.id==='client:'+input.scopeRef)state.leases.delete(token);
  writeScopes(all.filter(scope=>scope.id!==input.scopeRef));return {revoked:true};
}
export function createManagedScope(
  p: FinancePrincipal,
  input: {
    actorId: string;
    accountIds: string[];
    operations: ("read" | "write" | "sync" | "evidence")[];
  },
) {
  if (!p.owner)
    throw new Error("Only the owner can share finance account access");
  if (
    !/^(chat|workspace|job|background):[a-zA-Z0-9-]{1,128}$/.test(input.actorId)
  )
    throw new Error("Choose a host chat, agent or background principal");
  const all = scopes();
  if (all.length >= 1000)
    throw new Error("Too many finance scopes. Revoke unused scopes first");
  const id = randomUUID();
  grantFinance(p, "client:" + id, input.accountIds, input.operations);
  all.push({ id, actorId: input.actorId, createdAt: new Date().toISOString() });
  writeScopes(all);
  return {
    scopeRef: id,
    actorId: input.actorId,
    accountIds: input.accountIds,
    operations: input.operations,
  };
}
export function authorizeManagedPrincipal(input: {
  actorId: string;
  role: "owner-ui" | "agent" | "background";
  scopeRef: string | null;
  scopeActorId?: string;
  ticket: string | null;
  expiresAt: number;
}) {
  if (
    !state.enabled ||
    !["owner-ui", "agent", "background"].includes(input.role) ||
    !Number.isFinite(input.expiresAt) ||
    input.expiresAt <= Date.now()
  )
    throw new Error("Invalid managed principal");
  for (const [token, lease] of state.leases)
    if (lease.expiresAt <= Date.now()) state.leases.delete(token);
  if (state.leases.size >= 200)
    throw new Error("Too many active managed principals");
  let principal: FinancePrincipal;
  if (input.role === "owner-ui") principal = { id: input.actorId, owner: true };
  else if (state.fixture && input.actorId.startsWith('fixture:')) principal = {id:input.actorId,owner:true};
  else if (input.actorId === "metadata" && !input.scopeRef)
    principal = { id: "metadata", owner: false };
  else {
    const scope = scopes().find(
      (item) => item.id === input.scopeRef && item.actorId === (input.scopeActorId ?? input.actorId),
    );
    if (!scope)
      throw new Error("No finance account scope is bound to this actor");
    principal = { id: "client:" + scope.id, owner: false };
  }
  const credential = "finance_lease_" + randomBytes(32).toString("base64url");
  state.leases.set(credential, {
    principal,
    actorId: input.actorId,
    ticket: input.ticket,
    authority:principal.owner?null:principalAuthority(principal),
    expiresAt: Math.min(input.expiresAt, Date.now() + 600_000),
  });
  return { credential };
}
function principalAuthority(principal:FinancePrincipal) {
  return JSON.stringify({generation:getFinanceSettings()?.generation,reviewed:getFinanceSettings()?.restoreReviewed,enabled:getFinanceSettings()?.enabled,grants:financeGrantList(financeOwner).filter(grant=>grant.principal===principal.id).map(grant=>({accountId:grant.accountId,operations:[...grant.operations].sort(),revoked:grant.revoked})).sort((a,b)=>a.accountId.localeCompare(b.accountId))});
}
export function authenticateManaged(token: string, ticket?: string | null) {
  const lease = state.leases.get(token);
  if (!lease || lease.expiresAt <= Date.now()) {
    state.leases.delete(token);
    return null;
  }
  if (ticket !== undefined && lease.ticket !== ticket) return null;
  if(lease.authority!==null && lease.authority!==principalAuthority(lease.principal))return null;
  if (
    !lease.principal.owner &&
    lease.principal.id !== "metadata" &&
    !financeGrantList(financeOwner).some(
      (grant) => grant.principal === lease.principal.id && !grant.revoked,
    )
  )
    return null;
  return lease.principal;
}
export function revokeManagedPrincipal(input: {
  credential?: string;
  actorId?: string;
}) {
  if (input.credential) state.leases.delete(input.credential);
  if (input.actorId)
    for (const [token, lease] of state.leases)
      if (lease.actorId === input.actorId) state.leases.delete(token);
  return { revoked: true };
}
export function shutdownManaged() {
  state.leases.clear();
  state.broker = null;
}
