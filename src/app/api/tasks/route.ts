import { NextRequest } from 'next/server';
import { listTasks, createTask } from '@/lib/db/queries';
import type { CreateTaskInput, TaskStatusFilter } from '@/db/types';
import { withCompression } from '@/lib/api/compression';
import { toTaskListDTOs } from '@/lib/api/dto/entity-list';
import { TASK_STATUSES } from '@/lib/tasks/lifecycle';

// Read filters accept every canonical status plus the legacy `active` alias.
const ACCEPTED_STATUS_FILTERS = new Set<string>([...TASK_STATUSES, 'active']);
// Generic creation may only start a task as Consider or Todo. Other states are
// reached through the lifecycle transition / complete endpoints.
const CREATE_STATUSES = new Set<string>(['consider', 'todo']);

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const rawStatus = params.get('status');
    const statusFilter = rawStatus
      ? (rawStatus.split(',').filter((s) => ACCEPTED_STATUS_FILTERS.has(s)) as TaskStatusFilter[])
      : undefined;

    const rows = listTasks({
      status: statusFilter && statusFilter.length > 0 ? statusFilter : undefined,
      areaId: params.get('areaId') ?? undefined,
      parentId: params.get('parentId') ?? undefined,
      energy: (params.get('energy') as 'deep' | 'light') ?? undefined,
      q: params.get('q') ?? undefined,
      orderBy: params.get('orderBy') ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });

    // Bodies are 64% of this payload; the list shows a clamped tooltip.
    // Full body stays on GET /api/tasks/:id. See dto/entity-list.ts.
    return Response.json(toTaskListDTOs(rows));
  } catch (err) {
    console.error('[GET /api/tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskInput = await request.json();

    if (!body.title || !body.rawInput) {
      return Response.json({ error: 'title and rawInput are required' }, { status: 400 });
    }

    // Reject a non-canonical or lifecycle-restricted create status at runtime,
    // rather than trusting the TypeScript cast.
    if (body.status != null && !CREATE_STATUSES.has(body.status)) {
      return Response.json(
        {
          error: `Cannot create a task directly as "${body.status}". Create it as consider or todo, then use the lifecycle transition / complete endpoints.`,
          code: 'invalid_transition',
        },
        { status: 422 },
      );
    }

    const row = createTask(body);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/tasks]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
