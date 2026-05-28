import { NextRequest } from 'next/server';
import { listTasks, createTask } from '@/lib/db/queries';
import type { CreateTaskInput } from '@/db/types';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const rows = listTasks({
      status: params.get('status')
        ? (params.get('status')!.split(',') as ('active' | 'done' | 'archived')[])
        : undefined,
      areaId: params.get('areaId') ?? undefined,
      parentId: params.get('parentId') ?? undefined,
      energy: (params.get('energy') as 'deep' | 'light') ?? undefined,
      q: params.get('q') ?? undefined,
      orderBy: params.get('orderBy') ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });

    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskInput = await request.json();

    if (!body.title || !body.rawInput) {
      return Response.json(
        { error: 'title and rawInput are required' },
        { status: 400 }
      );
    }

    const row = createTask(body);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/tasks]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
