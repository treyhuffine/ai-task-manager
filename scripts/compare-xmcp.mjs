#!/usr/bin/env node
/**
 * Confirm our X connector is a 1:1 match with XMCP's tool surface. Replicates XMCP's exact spec
 * filtering (examples/xmcp/server.py: should_exclude_operation) against the same vendored spec, then
 * diffs the resulting operationId set against our generated TWITTER_OPS. Also audits comma-join
 * (explode:false) parity and reports the env-filter surface. Read-only; prints a verdict.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = JSON.parse(readFileSync(join(ROOT, 'packages/connectors/src/providers/twitter/vendor/x-openapi.json'), 'utf8'));
const GEN = readFileSync(join(ROOT, 'packages/connectors/src/providers/twitter/operations.generated.ts'), 'utf8');
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

// ── XMCP's should_exclude_operation (verbatim port from server.py) ──
function xmcpExcluded(path, op) {
  if (path.includes('/webhooks') || path.includes('/stream')) return true;
  const tags = (op.tags ?? []).filter((t) => typeof t === 'string').map((t) => t.toLowerCase());
  if (tags.includes('stream') || tags.includes('webhooks')) return true;
  if (op['x-twitter-streaming'] === true) return true;
  return false;
}

// XMCP's tool set: operationId of every non-excluded operation (FastMCP names tools by operationId).
const xmcpOps = new Set();
for (const [path, item] of Object.entries(SPEC.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method.toLowerCase()) || typeof op !== 'object') continue;
    if (xmcpExcluded(path, op)) continue;
    if (op.operationId) xmcpOps.add(op.operationId);
  }
}

// Our set: operationIds parsed out of the generated manifest.
const ours = new Set([...GEN.matchAll(/"operationId":"([^"]+)"/g)].map((m) => m[1]));

const missing = [...xmcpOps].filter((id) => !ours.has(id)).sort(); // XMCP has, we don't
const extra = [...ours].filter((id) => !xmcpOps.has(id)).sort(); // we have, XMCP doesn't

// ── comma-join parity: are ALL array query params explode:false? (else our join-all diverges) ──
function resolve(ref) { let n = SPEC; for (const s of ref.slice(2).split('/')) n = n?.[s]; return n; }
function deref(x) { return x && x.$ref ? resolve(x.$ref) : x; }
const arrayQueryParams = [];
for (const [path, item] of Object.entries(SPEC.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method.toLowerCase()) || typeof op !== 'object') continue;
    if (xmcpExcluded(path, op)) continue;
    for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
      const p = deref(raw);
      if (!p || p.in !== 'query') continue;
      const schema = deref(p.schema) ?? {};
      if (schema.type === 'array') arrayQueryParams.push({ name: p.name, explode: p.explode });
    }
  }
}
const arrayQueryExplodeNotFalse = arrayQueryParams.filter((p) => p.explode !== false);

console.log('=== XMCP 1:1 comparison ===');
console.log(`X OpenAPI version:        ${SPEC.info?.version}`);
console.log(`XMCP tool set (ops):      ${xmcpOps.size}`);
console.log(`Our generated ops:        ${ours.size}`);
console.log(`Missing (XMCP not ours):  ${missing.length}${missing.length ? ' → ' + missing.join(', ') : ''}`);
console.log(`Extra (ours not XMCP):    ${extra.length}${extra.length ? ' → ' + extra.join(', ') : ''}`);
console.log(`Array query params:       ${arrayQueryParams.length} (explode!==false: ${arrayQueryExplodeNotFalse.length})`);
if (arrayQueryExplodeNotFalse.length) {
  console.log('  ⚠ explode!==false array query params:', [...new Set(arrayQueryExplodeNotFalse.map((p) => p.name))].join(', '));
}
const opsMatch = missing.length === 0 && extra.length === 0;
console.log(`\nVERDICT: operation set ${opsMatch ? '1:1 MATCH ✅' : 'MISMATCH ❌'}`);
process.exit(opsMatch ? 0 : 1);
