import { openai } from '@ai-sdk/openai';
import { streamText, tool, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { hydrateRow } from '@/lib/db/hydrate';
import { tasks, notes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { upsertEmbedding, buildEmbeddingText } from '@/lib/embeddings/embed';
import { syncEntity } from '@/lib/export/mirror';
import { inlineTextAttachments } from '@/lib/ai/inline-text-attachments';
import { extractPdfsForOpenAI } from '@/lib/ai/extract-pdf-for-openai';

export const maxDuration = 60;

type DocumentType = 'task' | 'note';

interface DocumentContext {
  type: DocumentType;
  document: Record<string, unknown>;
}

function buildSystemPrompt(ctx: DocumentContext): string {
  const { type, document } = ctx;

  const docSummary = type === 'task'
    ? formatTaskContext(document)
    : formatNoteContext(document);

  return `You are an AI assistant embedded inside a ${type} editor in a productivity app called Flow. The user is currently viewing a specific ${type} and can ask you questions about it or request changes.

## Current ${type}
${docSummary}

## Your role
- Answer questions about the ${type}'s content, context, and details
- Help the user brainstorm, refine, expand, or restructure the ${type}
- Suggest improvements, next steps, or related ideas
- When the user asks you to make changes, USE YOUR TOOLS to apply them directly — don't just describe what you'd change
- Be concise and direct — this is a side panel, not a full-page chat

## Tools
You have tools to update the ${type} directly. Use them when the user asks you to change, rewrite, update, or set any field. Always confirm what you changed after using a tool.

## Guidelines
- Reference specific parts of the ${type} when relevant
- Keep responses short unless the user asks for depth
- Use markdown formatting (bullets, bold, code) for readability
- If the ${type} is empty or minimal, proactively suggest what to add
- When writing body content, use markdown formatting`;
}

function formatTaskContext(doc: Record<string, unknown>): string {
  const lines: string[] = [];
  if (doc.title) lines.push(`**Title:** ${doc.title}`);
  if (doc.status) lines.push(`**Status:** ${doc.status}`);
  if (doc.energy) lines.push(`**Energy:** ${doc.energy}`);
  if (doc.effort) lines.push(`**Effort:** ${doc.effort}`);
  if (doc.hardDeadline) lines.push(`**Deadline:** ${doc.hardDeadline}`);
  if (doc.resurfaceAfter) lines.push(`**Resurface after:** ${doc.resurfaceAfter}`);
  if (doc.recurrence) lines.push(`**Recurrence:** ${doc.recurrence}`);
  if (doc.blockedOn) lines.push(`**Blocked on:** ${doc.blockedOn}`);
  if (doc.description) lines.push(`**Description:** ${doc.description}`);
  if (doc.body) lines.push(`\n**Body:**\n${doc.body}`);
  if (doc.outcome) lines.push(`**Desired outcome:** ${doc.outcome}`);
  if (doc.userContext) lines.push(`**User context:** ${doc.userContext}`);
  return lines.join('\n') || '_Empty task_';
}

function formatNoteContext(doc: Record<string, unknown>): string {
  const lines: string[] = [];
  if (doc.title) lines.push(`**Title:** ${doc.title}`);
  if (doc.status) lines.push(`**Status:** ${doc.status}`);
  if (doc.url) lines.push(`**URL:** ${doc.url}`);
  if (doc.body) lines.push(`\n**Body:**\n${doc.body}`);
  return lines.join('\n') || '_Empty note_';
}

// ─── Tools ───────────────────────────────────────────────────

function buildTaskTools(documentId: string) {
  return {
    updateTaskTitle: tool({
      description: 'Update the title of the current task',
      inputSchema: z.object({
        title: z.string().describe('The new title for the task'),
      }),
      execute: async ({ title }) => {
        const db = getDb();
        const row = db
          .update(tasks)
          .set({ title, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, documentId))
          .returning()
          .get();
        if (!row) return { success: false, error: 'Task not found' };
        const hydrated = hydrateRow(row);
        void upsertEmbedding('task', hydrated.id, buildEmbeddingText('task', hydrated));
        void syncEntity('task', row.id);
        return { success: true, title: row.title };
      },
    }),

    updateTaskBody: tool({
      description: 'Update the body/notes content of the current task. Use markdown formatting.',
      inputSchema: z.object({
        body: z.string().describe('The new body content (markdown)'),
      }),
      execute: async ({ body }) => {
        const db = getDb();
        const row = db
          .update(tasks)
          .set({ body, updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, documentId))
          .returning()
          .get();
        if (!row) return { success: false, error: 'Task not found' };
        const hydrated = hydrateRow(row);
        void upsertEmbedding('task', hydrated.id, buildEmbeddingText('task', hydrated));
        void syncEntity('task', row.id);
        return { success: true, bodyLength: row.body?.length ?? 0 };
      },
    }),

    updateTaskProperties: tool({
      description: 'Update one or more properties of the current task (status, energy, effort, deadline, resurface date, description, outcome, etc.)',
      inputSchema: z.object({
        status: z.enum(['active', 'done', 'archived']).optional().describe('Task status'),
        energy: z.enum(['deep', 'light']).nullish().describe('Energy level required'),
        effort: z.enum(['trivial', 'small', 'medium', 'large', 'epic']).nullish().describe('Effort estimate'),
        hardDeadline: z.string().nullish().describe('Deadline as ISO date string, or null to clear'),
        resurfaceAfter: z.string().nullish().describe('Snooze/resurface date as ISO string, or null to clear'),
        recurrence: z.string().nullish().describe('Recurrence pattern like "daily", "weekly", etc.'),
        blockedOn: z.string().nullish().describe('What the task is blocked on, or null to unblock'),
        description: z.string().nullish().describe('Short description of the task'),
        outcome: z.string().nullish().describe('Desired outcome for the task'),
      }),
      execute: async (props) => {
        const db = getDb();
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const [key, value] of Object.entries(props)) {
          if (value !== undefined) {
            updates[key] = value;
          }
        }
        if (props.status === 'done') {
          updates.completedAt = new Date().toISOString();
        } else if (props.status === 'active') {
          updates.completedAt = null;
        }
        if (props.blockedOn === null) {
          updates.blockedSince = null;
        } else if (props.blockedOn) {
          updates.blockedSince = new Date().toISOString();
        }

        const row = db
          .update(tasks)
          .set(updates)
          .where(eq(tasks.id, documentId))
          .returning()
          .get();
        if (!row) return { success: false, error: 'Task not found' };
        const hydrated = hydrateRow(row);
        void upsertEmbedding('task', hydrated.id, buildEmbeddingText('task', hydrated));
        const updatedFields = Object.keys(props).filter(k => (props as Record<string, unknown>)[k] !== undefined);
        return { success: true, updated: updatedFields };
      },
    }),
  };
}

function buildNoteTools(documentId: string) {
  return {
    updateNoteTitle: tool({
      description: 'Update the title of the current note',
      inputSchema: z.object({
        title: z.string().describe('The new title for the note'),
      }),
      execute: async ({ title }) => {
        const db = getDb();
        const row = db
          .update(notes)
          .set({ title, updatedAt: new Date().toISOString() })
          .where(eq(notes.id, documentId))
          .returning()
          .get();
        if (!row) return { success: false, error: 'Note not found' };
        const hydrated = hydrateRow(row);
        void upsertEmbedding('note', hydrated.id, buildEmbeddingText('note', hydrated));
        void syncEntity('note', hydrated.id);
        return { success: true, title: row.title };
      },
    }),

    updateNoteBody: tool({
      description: 'Update the body content of the current note. Use markdown formatting.',
      inputSchema: z.object({
        body: z.string().describe('The new body content (markdown)'),
      }),
      execute: async ({ body }) => {
        const db = getDb();
        const row = db
          .update(notes)
          .set({ body, updatedAt: new Date().toISOString() })
          .where(eq(notes.id, documentId))
          .returning()
          .get();
        if (!row) return { success: false, error: 'Note not found' };
        const hydrated = hydrateRow(row);
        void upsertEmbedding('note', hydrated.id, buildEmbeddingText('note', hydrated));
        void syncEntity('note', hydrated.id);
        return { success: true, bodyLength: row.body?.length ?? 0 };
      },
    }),

    updateNoteProperties: tool({
      description: 'Update properties of the current note (status)',
      inputSchema: z.object({
        status: z.enum(['active', 'archived']).optional().describe('Note status'),
      }),
      execute: async (props) => {
        const db = getDb();
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const [key, value] of Object.entries(props)) {
          if (value !== undefined) updates[key] = value;
        }
        const row = db
          .update(notes)
          .set(updates)
          .where(eq(notes.id, documentId))
          .returning()
          .get();
        if (!row) return { success: false, error: 'Note not found' };
        void syncEntity('note', row.id);
        const updatedFields = Object.keys(props).filter(k => (props as Record<string, unknown>)[k] !== undefined);
        return { success: true, updated: updatedFields };
      },
    }),
  };
}

// ─── Route ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const body = await req.json();
  const {
    messages,
    documentType,
    document,
  }: {
    messages: UIMessage[];
    documentType: DocumentType;
    document: Record<string, unknown>;
  } = body;

  const documentId = document?.id as string | undefined;
  if (!documentId) {
    return Response.json({ error: 'Document ID required' }, { status: 400 });
  }

  const system = buildSystemPrompt({ type: documentType, document });
  const tools = documentType === 'task'
    ? buildTaskTools(documentId)
    : buildNoteTools(documentId);

  const result = streamText({
    model: openai('gpt-5.4-mini'),
    system,
    messages: await convertToModelMessages(
      await inlineTextAttachments(await extractPdfsForOpenAI(messages)),
    ),
    tools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
