/**
 * Results published to a team (docs/homes-spec.md §9.4-§9.5, P7.5): what a
 * member deliberately shares about a shared task, a summary, a link such as
 * a pull request, or files. They're the team's own records, kept in the
 * team's Results table and linked to its task, with the member who
 * published them. Nothing else of the person's work comes with them: no
 * conversation, agent, device or local path.
 *
 * Publishing is a command, safe to retry: the same request from the same
 * member is the same result, and the same request with different content is
 * refused rather than applied twice.
 */

import { hasTeamCapability } from './capabilities';
import { desc, eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { getAttachmentsDir } from '@/lib/config/paths';
import { replaceAttachmentReferences } from '@/lib/attachments/derive';
import { getDb, getRawDb } from '@/lib/db';
import { dehydrateAttachments, hydrateRow } from '@/lib/db/hydrate';
import { tasks, workResults, workResultTasks } from '@/lib/db/schema';
import { getMember, TeamError } from '@/lib/db/queries';
import type { Attachment } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { validateWorkResultAttachments, workResultIntentHash, workResultRequestScopedId } from '@/lib/work-results/queries';

export const PUBLISHED_SUMMARY_MAX = 20_000;

export interface PublishedLink {
  label: string;
  url: string;
}

export interface PublishedResult {
  id: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  summary: string;
  links: PublishedLink[];
  attachments: Attachment[];
}

export interface PublishTaskResultInput {
  taskId: string;
  memberId: string;
  requestId: string;
  summary?: string | null;
  links?: PublishedLink[];
  attachments?: Attachment[];
  source?: 'human' | 'ai';
}

function checkLinks(links: PublishedLink[]): PublishedLink[] {
  return links.map((link) => {
    const label = link.label.trim();
    if (!label) throw new TeamError('invalid', 'A link needs a label.');
    let url: URL;
    try {
      url = new URL(link.url.trim());
    } catch {
      throw new TeamError('invalid', 'That link is not a web address.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new TeamError('invalid', 'Links use http or https, without a password in them.');
    }
    return { label, url: url.toString() };
  });
}

function checkAttachments(summary: string, attachments: Attachment[]): Attachment[] {
  try {
    return validateWorkResultAttachments(summary, attachments, 'local');
  } catch (err) {
    if (err instanceof ActionError) throw new TeamError(err.code === 'not_found' ? 'not_found' : 'invalid', err.message);
    throw err;
  }
}

function view(row: typeof workResults.$inferSelect): PublishedResult {
  const result = hydrateRow(row);
  const member = getMember(result.actorUserId);
  return {
    id: result.id,
    createdAt: result.createdAt,
    author: member ? { id: member.id, name: member.name } : null,
    summary: result.body,
    links: (result.links ?? []).flatMap((link) => (link.kind === 'url' ? [{ label: link.label, url: link.url }] : [])),
    attachments: result.attachments ?? [],
  };
}

/** Publish a member's chosen result to a team task. */
export async function publishTaskResult(input: PublishTaskResultInput): Promise<{ result: PublishedResult; replayed: boolean }> {
  const summary = (input.summary ?? '').trim();
  if (summary.length > PUBLISHED_SUMMARY_MAX) throw new TeamError('invalid', 'That summary is too long to publish.');
  const links = checkLinks(input.links ?? []);
  const attachments = checkAttachments(summary, input.attachments ?? []);
  if (!summary && links.length === 0 && attachments.length === 0) throw new TeamError('invalid', 'Choose a summary, a link or a file to publish.');
  const actor = { userId: 'local', source: 'human' as const };
  // One result per member and request, whoever retries it.
  const id = workResultRequestScopedId('team_published_result', actor, `${input.memberId}:${input.requestId}`);
  // Files by what they are, not where the team stored them: a retry that
  // sends the same files again is the same result.
  const names = new Map<string, string>();
  const files: string[] = [];
  for (const file of attachments) {
    const content = createHash('sha256');
    for await (const chunk of createReadStream(path.join(getAttachmentsDir(), file.fileName))) content.update(chunk);
    const digest = content.digest('hex');
    const identity = workResultIntentHash([file.originalName, file.size, file.mimeType, digest]);
    names.set(file.fileName, `${identity}${path.extname(file.fileName)}`);
    files.push(identity);
  }
  const hash = workResultIntentHash({ taskId: input.taskId, summary: replaceAttachmentReferences(summary, names), links, files: files.sort() });

  const run = () => {
    const db = getDb();
    const member = getMember(input.memberId);
    if (!hasTeamCapability(member, 'editContent', input.source === 'ai' ? 'agent' : 'human')) throw new TeamError('not_allowed', 'Only an active authorized team member can publish a result.');
    if (!db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, input.taskId)).get()) throw new TeamError('not_found', 'That task is no longer in the team.');
    const previous = db.select().from(workResults).where(eq(workResults.id, id)).get();
    if (previous) {
      if (previous.requestHash !== hash || previous.actorUserId !== input.memberId) {
        throw new TeamError('conflict', 'This publish request was already used for something else. Publish again to share it.');
      }
      return { result: view(previous), replayed: true };
    }
    const now = new Date().toISOString();
    const row = db.insert(workResults).values({
      id,
      createdAt: now,
      updatedAt: now,
      actorSource: input.source ?? 'human',
      actorUserId: input.memberId,
      requestHash: hash,
      title: null,
      body: summary,
      attachments: dehydrateAttachments(attachments) ?? [],
      links: links.map((link) => ({ kind: 'url' as const, ...link })),
    }).returning().get();
    db.insert(workResultTasks).values({ id: workResultRequestScopedId('team_published_result_task', actor, `${input.memberId}:${input.requestId}`), createdAt: now, updatedAt: now, resultId: id, taskId: input.taskId }).run();
    return { result: view(row), replayed: false };
  };
  return getRawDb().inTransaction ? run() : getDb().transaction(run, { behavior: 'immediate' });
}

/** A team task's published results, newest first. */
export function listTaskPublishedResults(taskId: string): PublishedResult[] {
  const db = getDb();
  const ids = db.select({ resultId: workResultTasks.resultId }).from(workResultTasks).where(eq(workResultTasks.taskId, taskId)).all().map((r) => r.resultId);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(workResults)
    .where(inArray(workResults.id, ids))
    .orderBy(desc(workResults.createdAt), desc(workResults.id))
    .all()
    .map(view);
}
