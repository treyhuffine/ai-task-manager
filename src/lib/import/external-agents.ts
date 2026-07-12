import path from 'node:path';
import { createReadStream } from 'node:fs';
import {
  open as openFile,
  readdir,
  stat,
} from 'node:fs/promises';
import * as readline from 'node:readline';
import {
  codexLineToStreamEvents,
  readClaudeTranscript,
  readCodexTranscript,
  resolveClaudeHome,
  resolveCodexHome,
  type CodexTranscriptLine,
} from '@agentex/agent';
import { and, inArray, isNotNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import {
  chatEvents,
  chatSessions,
  executions,
} from '@/lib/db/schema';
import {
  createWorkspace,
  getOrCreateDefaultExecutor,
  listWorkspaces,
} from '@/lib/db/queries';
import { parseStreamEvent } from '@/lib/executor/adapter';
import { explicitAgentSelection } from '@/lib/agent-options';
import { detectBaseBranch, detectIsGit } from '@/lib/workspaces';
import type { CreateChatEventInput } from '@/db/types';
import type {
  ExternalAgentDiscovery,
  ExternalAgentImportResult,
  ExternalAgentProjectCandidate,
  ExternalAgentSessionCandidate,
  ExternalAgentSource,
} from './types';

const JSONL_PREFIX_BYTES = 128 * 1024;
const MAX_IMPORT_SELECTION = 1_000;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODEX_FILE_ID_RE = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

interface InternalCandidate extends ExternalAgentSessionCandidate {
  filePath: string;
  transcriptSize: number;
}

interface SequencedInput {
  sequence: number;
  input: CreateChatEventInput;
}

function sessionKey(source: ExternalAgentSource, externalSessionId: string): string {
  return `${source}:${externalSessionId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function validDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function cleanLabel(value: string | null, fallback: string): string {
  const cleaned = value
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/^[#>*_`\s-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 120 ? `${cleaned.slice(0, 117).trimEnd()}...` : cleaned;
}

function normalizeAbsoluteCwd(value: string): string | null {
  return path.isAbsolute(value) ? path.normalize(value) : null;
}

async function pathIsDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function readJsonlPrefix(filePath: string): Promise<Record<string, unknown>[]> {
  let handle;
  try {
    handle = await openFile(filePath, 'r');
    const buffer = Buffer.alloc(JSONL_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const raw = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = raw.split(/\r?\n/);
    if (bytesRead === buffer.length) lines.pop();
    const records: Record<string, unknown>[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = asRecord(JSON.parse(line));
        if (parsed) records.push(parsed);
      } catch {
        // A damaged historical line should not hide the rest of the session.
      }
    }
    return records;
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
}

async function listJsonlFiles(root: string, maxDepth: number): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(child, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(child);
      }
    }));
  }
  await visit(root, 0);
  return files;
}

async function listClaudeFiles(claudeHome: string): Promise<string[]> {
  const projectsRoot = path.join(claudeHome, 'projects');
  let projects;
  try {
    projects = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(projects
    .filter((entry) => entry.isDirectory())
    .map(async (project) => {
      const projectDir = path.join(projectsRoot, project.name);
      try {
        return (await readdir(projectDir, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && SESSION_ID_RE.test(path.basename(entry.name, '.jsonl')))
          .map((entry) => path.join(projectDir, entry.name));
      } catch {
        return [];
      }
    }));
  return nested.flat();
}

function textFromContent(content: unknown, acceptedTypes: ReadonlySet<string>): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const entry of content) {
    const block = asRecord(entry);
    if (!block) continue;
    const type = asString(block.type);
    if (type && !acceptedTypes.has(type)) continue;
    const text = asString(block.text) ?? asString(block.content);
    if (text) parts.push(text);
  }
  return parts.join('\n\n').trim() || null;
}

function claudeUserText(record: Record<string, unknown>): string | null {
  if (record.type !== 'user') return null;
  const message = asRecord(record.message);
  if (!message || message.role !== 'user') return null;
  return textFromContent(message.content, new Set(['text', 'input_text']));
}

function codexUserText(line: CodexTranscriptLine): string | null {
  const payload = line.payload;
  if (line.type === 'event_msg' && payload?.type === 'user_message') {
    return asString(payload.message);
  }
  // Legacy unwrapped rollouts have no event_msg mirror.
  if (line.type === 'message' && line.raw.role === 'user') {
    const text = textFromContent(line.raw.content, new Set(['text', 'input_text']));
    if (!text || /<environment_context>|<user_instructions>|<developer_instructions>/.test(text)) {
      return null;
    }
    return text;
  }
  return null;
}

async function loadCodexTitles(codexHome: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  const stream = createReadStream(indexPath, { encoding: 'utf8' });
  stream.on('error', () => {});
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      try {
        const record = asRecord(JSON.parse(line));
        const id = record && asString(record.id);
        const title = record && asString(record.thread_name);
        if (id && title) titles.set(id, title);
      } catch {
        // Ignore a partial index line. The transcript still has a prompt fallback.
      }
    }
  } catch {
    // Missing index is normal on older Codex installs.
  } finally {
    rl.close();
    stream.destroy();
  }
  return titles;
}

async function claudeCandidate(filePath: string): Promise<InternalCandidate | null> {
  const id = path.basename(filePath, '.jsonl');
  if (!SESSION_ID_RE.test(id)) return null;
  const [records, fileStat] = await Promise.all([readJsonlPrefix(filePath), stat(filePath).catch(() => null)]);
  if (!fileStat) return null;
  if (records.some((record) => record.isSidechain === true)) return null;

  const cwd = records.map((record) => asString(record.cwd)).find(Boolean) ?? null;
  const normalizedCwd = cwd ? normalizeAbsoluteCwd(cwd) : null;
  if (!normalizedCwd) return null;
  const aiTitle = records.map((record) => record.type === 'ai-title' ? asString(record.aiTitle) : null).find(Boolean) ?? null;
  const firstPrompt = records.map(claudeUserText).find(Boolean) ?? null;
  const firstTimestamp = records.map((record) => asString(record.timestamp)).find(Boolean);
  const startedAt = validDate(firstTimestamp, fileStat.birthtime.toISOString());
  const updatedAt = fileStat.mtime.toISOString();
  const branchName = records.map((record) => asString(record.gitBranch)).find(Boolean) ?? null;
  return {
    key: sessionKey('claude', id),
    source: 'claude',
    externalSessionId: id,
    label: cleanLabel(aiTitle ?? firstPrompt, `Claude chat ${id.slice(0, 8)}`),
    cwd: normalizedCwd,
    startedAt,
    updatedAt,
    branchName,
    imported: false,
    filePath,
    transcriptSize: fileStat.size,
  };
}

function codexCwdFromRecords(records: Record<string, unknown>[]): string | null {
  for (const record of records) {
    const payload = asRecord(record.payload);
    const cwd = payload && asString(payload.cwd);
    if (cwd) return cwd;
    if (record.type === 'message' && record.role === 'user') {
      const text = textFromContent(record.content, new Set(['text', 'input_text']));
      const xml = text?.match(/<cwd>([^<]+)<\/cwd>/)?.[1];
      const plain = text?.match(/Current working directory:\s*([^\n\r]+)/)?.[1];
      if (xml || plain) return (xml ?? plain)!.trim();
    }
  }
  return null;
}

async function codexCandidate(
  filePath: string,
  titles: Map<string, string>,
): Promise<InternalCandidate | null> {
  const records = await readJsonlPrefix(filePath);
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat) return null;
  const meta = records.find((record) => record.type === 'session_meta');
  const metaPayload = meta && asRecord(meta.payload);
  const id = asString(metaPayload?.id) ?? filePath.match(CODEX_FILE_ID_RE)?.[1] ?? null;
  if (!id || !SESSION_ID_RE.test(id)) return null;
  const cwd = codexCwdFromRecords(records);
  const normalizedCwd = cwd ? normalizeAbsoluteCwd(cwd) : null;
  if (!normalizedCwd) return null;

  let firstPrompt: string | null = null;
  for (const raw of records) {
    const payload = asRecord(raw.payload);
    const line: CodexTranscriptLine = {
      raw,
      type: asString(raw.type),
      timestamp: asString(raw.timestamp),
      payload,
      eventId: null,
    };
    firstPrompt = codexUserText(line);
    if (firstPrompt) break;
  }
  const git = asRecord(metaPayload?.git);
  const branchName = asString(git?.branch) ?? null;
  const startedAt = validDate(asString(meta?.timestamp) ?? asString(metaPayload?.timestamp), fileStat.birthtime.toISOString());
  return {
    key: sessionKey('codex', id),
    source: 'codex',
    externalSessionId: id,
    label: cleanLabel(titles.get(id) ?? firstPrompt, `Codex chat ${id.slice(0, 8)}`),
    cwd: normalizedCwd,
    startedAt,
    updatedAt: fileStat.mtime.toISOString(),
    branchName,
    imported: false,
    filePath,
    transcriptSize: fileStat.size,
  };
}

async function mapLimited<T, U>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

async function discoverCandidatesInternal(): Promise<{
  candidates: InternalCandidate[];
  available: Record<ExternalAgentSource, boolean>;
}> {
  const claudeHome = resolveClaudeHome();
  const codexHome = resolveCodexHome();
  const [claudeAvailable, codexAvailable, claudeFiles, activeCodexFiles, archivedCodexFiles, titles] = await Promise.all([
    pathIsDirectory(claudeHome),
    pathIsDirectory(codexHome),
    listClaudeFiles(claudeHome),
    listJsonlFiles(path.join(codexHome, 'sessions'), 5),
    listJsonlFiles(path.join(codexHome, 'archived_sessions'), 2),
    loadCodexTitles(codexHome),
  ]);
  const [claudeRows, codexRows] = await Promise.all([
    mapLimited(claudeFiles, 24, claudeCandidate),
    mapLimited([...activeCodexFiles, ...archivedCodexFiles], 24, (filePath) => codexCandidate(filePath, titles)),
  ]);

  // A session can briefly exist in active and archived locations during a move.
  // Keep the newest physical copy and expose one candidate.
  const deduped = new Map<string, InternalCandidate>();
  for (const candidate of [...claudeRows, ...codexRows]) {
    if (!candidate) continue;
    const prior = deduped.get(candidate.key);
    if (!prior || candidate.updatedAt > prior.updatedAt) deduped.set(candidate.key, candidate);
  }
  return {
    candidates: [...deduped.values()],
    available: { claude: claudeAvailable, codex: codexAvailable },
  };
}

export async function discoverExternalAgentSessions(): Promise<ExternalAgentDiscovery> {
  const { candidates, available } = await discoverCandidatesInternal();
  const externalIds = [...new Set(candidates.map((candidate) => candidate.externalSessionId))];
  const importedIds = new Set<string>();
  if (externalIds.length > 0) {
    const db = getDb();
    // Chunk to stay below SQLite's variable limit on large histories.
    for (let i = 0; i < externalIds.length; i += 400) {
      const rows = db
        .select({ externalSessionId: chatSessions.externalSessionId })
        .from(chatSessions)
        .where(and(isNotNull(chatSessions.externalSessionId), inArray(chatSessions.externalSessionId, externalIds.slice(i, i + 400))))
        .all();
      for (const row of rows) if (row.externalSessionId) importedIds.add(row.externalSessionId);
    }
  }
  for (const candidate of candidates) {
    candidate.imported = importedIds.has(candidate.externalSessionId);
  }

  candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const grouped = new Map<string, InternalCandidate[]>();
  for (const candidate of candidates) {
    const rows = grouped.get(candidate.cwd) ?? [];
    rows.push(candidate);
    grouped.set(candidate.cwd, rows);
  }
  const projects: ExternalAgentProjectCandidate[] = await mapLimited(
    [...grouped.entries()],
    24,
    async ([cwd, sessions]) => ({
      id: cwd,
      name: path.basename(cwd) || cwd,
      cwd,
      pathExists: await pathIsDirectory(cwd),
      sessions: sessions.map((session) => ({
        key: session.key,
        source: session.source,
        externalSessionId: session.externalSessionId,
        label: session.label,
        cwd: session.cwd,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        branchName: session.branchName,
        imported: session.imported,
      })),
    }),
  );
  projects.sort((a, b) => (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''));

  const sourceSummary = (source: ExternalAgentSource) => {
    const matching = candidates.filter((candidate) => candidate.source === source);
    return {
      available: available[source],
      found: matching.length,
      imported: matching.filter((candidate) => candidate.imported).length,
    };
  };
  return {
    projects,
    sources: {
      claude: sourceSummary('claude'),
      codex: sourceSummary('codex'),
    },
    scannedAt: new Date().toISOString(),
  };
}

async function readRawJsonl(
  filePath: string,
  visit: (record: Record<string, unknown>, line: string, offset: number) => void,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let offset = 0;
  try {
    for await (const line of rl) {
      const lineOffset = offset;
      offset += Buffer.byteLength(line, 'utf8') + 1;
      if (!line.trim()) continue;
      try {
        const record = asRecord(JSON.parse(line));
        if (record) visit(record, line, lineOffset);
      } catch {
        // Continue around a damaged line so a mostly healthy chat still imports.
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

async function parseClaudeTranscript(candidate: InternalCandidate): Promise<CreateChatEventInput[]> {
  const sequenced: SequencedInput[] = [];
  await readRawJsonl(candidate.filePath, (record, _line, offset) => {
    const content = claudeUserText(record);
    if (!content) return;
    sequenced.push({
      sequence: offset * 100,
      input: {
        sessionId: '',
        role: 'user',
        source: 'user',
        content,
        raw: record,
        externalEventId: asString(record.uuid) ?? `claude:${candidate.externalSessionId}:${offset}`,
        createdAt: validDate(record.timestamp, candidate.startedAt),
      },
    });
  });

  const partIndexes = new Map<string, number>();
  for await (const yielded of readClaudeTranscript({ filePath: candidate.filePath })) {
    const rawTimestamp = asString((yielded.event.raw as Record<string, unknown>).timestamp);
    const event = {
      ...yielded.event,
      timestamp: validDate(rawTimestamp, candidate.startedAt),
    };
    const input = parseStreamEvent('', event);
    if (!input) continue;
    const externalId = input.externalEventId ?? `claude:${candidate.externalSessionId}:${yielded.offset}`;
    const partIndex = partIndexes.get(externalId) ?? 0;
    partIndexes.set(externalId, partIndex + 1);
    sequenced.push({
      sequence: yielded.offset * 100 + partIndex,
      input: {
        ...input,
        externalEventId: externalId,
        sourcePartIndex: partIndex,
      },
    });
  }
  return sequenced.sort((a, b) => a.sequence - b.sequence).map((row) => row.input);
}

function codexUserInput(
  candidate: InternalCandidate,
  line: CodexTranscriptLine,
  offset: number,
): CreateChatEventInput | null {
  const content = codexUserText(line);
  if (!content) return null;
  return {
    sessionId: '',
    role: 'user',
    source: 'user',
    content,
    raw: line.raw,
    externalEventId: line.eventId ?? `codex:${candidate.externalSessionId}:${offset}`,
    createdAt: validDate(line.timestamp, candidate.startedAt),
  };
}

async function parseCodexTranscript(candidate: InternalCandidate): Promise<CreateChatEventInput[]> {
  const inputs: CreateChatEventInput[] = [];
  for await (const yielded of readCodexTranscript({ filePath: candidate.filePath })) {
    const user = codexUserInput(candidate, yielded.event, yielded.offset);
    if (user) {
      inputs.push(user);
      continue;
    }
    for (const event of codexLineToStreamEvents(yielded.event, { sessionId: candidate.externalSessionId })) {
      const input = parseStreamEvent('', {
        ...event,
        eventId: yielded.event.eventId,
        timestamp: validDate(yielded.event.timestamp, candidate.startedAt),
      });
      if (input) inputs.push(input);
    }
  }
  return inputs;
}

async function ensureImportWorkspace(candidate: InternalCandidate): Promise<{ id: string; created: boolean }> {
  const resolvedCwd = path.normalize(candidate.cwd);
  const existing = listWorkspaces().find((workspace) => path.normalize(workspace.cwd) === resolvedCwd);
  if (existing) return { id: existing.id, created: false };

  const isGit = await detectIsGit(resolvedCwd);
  const baseBranch = isGit ? await detectBaseBranch(resolvedCwd) : null;
  const created = createWorkspace({
    name: path.basename(resolvedCwd) || resolvedCwd,
    cwd: resolvedCwd,
    emoji: candidate.source === 'claude' ? '🟠' : '🟢',
    attachments: [],
    isGit,
    baseBranch,
    remoteName: isGit ? 'origin' : null,
    worktreeRoot: null,
    areaId: null,
    status: 'active',
  });
  return { id: created.id, created: true };
}

function insertImportedSession(
  candidate: InternalCandidate,
  workspaceId: string,
  eventInputs: CreateChatEventInput[],
): number {
  const db = getDb();
  const harness = candidate.source === 'claude' ? 'claude_code' : 'codex';
  const providerId = candidate.source === 'claude' ? 'claude' : 'codex';
  const agent = getOrCreateDefaultExecutor(harness);
  const selection = explicitAgentSelection(providerId, {});
  const executionId = uuidv7();
  const chatSessionId = uuidv7();
  const archivedAt = candidate.updatedAt;
  const lastExternalEventId = candidate.source === 'claude'
    ? [...eventInputs].reverse().find((event) => event.externalEventId)?.externalEventId ?? null
    : null;

  return db.transaction((tx) => {
    tx.insert(executions).values({
      id: executionId,
      workspaceId,
      label: candidate.label,
      branchName: candidate.branchName,
      status: 'archived',
      archivedAt,
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).run();
    tx.insert(chatSessions).values({
      id: chatSessionId,
      agentId: agent.id,
      type: 'execution',
      surfaceKind: 'imported_agent',
      surfaceRef: candidate.source,
      status: 'archived',
      label: candidate.label,
      workspaceId,
      executionId,
      lastOutcomeEventAt: candidate.updatedAt,
      lastViewedAt: candidate.updatedAt,
      externalSessionId: candidate.externalSessionId,
      externalTranscriptPath: candidate.filePath,
      externalSyncOffset: candidate.transcriptSize,
      externalSyncLastEventId: lastExternalEventId,
      permissionMode: 'bypass',
      model: selection.model,
      effort: selection.effort,
      startedAt: candidate.startedAt,
      archivedAt,
      createdAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
    }).run();

    let inserted = 0;
    for (let index = 0; index < eventInputs.length; index += 100) {
      const chunk = eventInputs.slice(index, index + 100).map((input) => {
        return {
          ...input,
          id: input.id ?? uuidv7(),
          sessionId: chatSessionId,
          attachments: undefined,
          createdAt: input.createdAt ?? candidate.startedAt,
          updatedAt: input.updatedAt ?? input.createdAt ?? candidate.startedAt,
        };
      });
      if (chunk.length === 0) continue;
      inserted += tx.insert(chatEvents).values(chunk).onConflictDoNothing().run().changes;
    }
    return inserted;
  });
}

export async function importExternalAgentSessions(sessionKeys: string[]): Promise<ExternalAgentImportResult> {
  const uniqueKeys = [...new Set(sessionKeys)];
  if (uniqueKeys.length === 0) {
    return { importedSessions: 0, importedEvents: 0, createdWorkspaces: 0, skippedSessions: 0, failures: [] };
  }
  if (uniqueKeys.length > MAX_IMPORT_SELECTION) {
    throw new Error(`Select at most ${MAX_IMPORT_SELECTION} chats per import.`);
  }
  for (const key of uniqueKeys) {
    const [source, id, extra] = key.split(':');
    if (extra || (source !== 'claude' && source !== 'codex') || !SESSION_ID_RE.test(id ?? '')) {
      throw new Error(`Invalid session key: ${key}`);
    }
  }

  const { candidates } = await discoverCandidatesInternal();
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const db = getDb();
  const selectedIds = uniqueKeys.map((key) => key.split(':')[1]);
  const alreadyImported = new Set(
    db.select({ externalSessionId: chatSessions.externalSessionId })
      .from(chatSessions)
      .where(and(isNotNull(chatSessions.externalSessionId), inArray(chatSessions.externalSessionId, selectedIds)))
      .all()
      .flatMap((row) => row.externalSessionId ? [row.externalSessionId] : []),
  );

  const result: ExternalAgentImportResult = {
    importedSessions: 0,
    importedEvents: 0,
    createdWorkspaces: 0,
    skippedSessions: 0,
    failures: [],
  };
  const workspaceByCwd = new Map<string, string>();
  for (const key of uniqueKeys) {
    const candidate = byKey.get(key);
    if (!candidate) {
      result.failures.push({ key, error: 'The local transcript was not found.' });
      continue;
    }
    if (alreadyImported.has(candidate.externalSessionId)) {
      result.skippedSessions++;
      continue;
    }
    try {
      let workspaceId = workspaceByCwd.get(candidate.cwd);
      if (!workspaceId) {
        const workspace = await ensureImportWorkspace(candidate);
        workspaceId = workspace.id;
        workspaceByCwd.set(candidate.cwd, workspaceId);
        if (workspace.created) result.createdWorkspaces++;
      }
      const events = candidate.source === 'claude'
        ? await parseClaudeTranscript(candidate)
        : await parseCodexTranscript(candidate);
      result.importedEvents += insertImportedSession(candidate, workspaceId, events);
      result.importedSessions++;
      alreadyImported.add(candidate.externalSessionId);
    } catch (error) {
      result.failures.push({
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
