import { listSessionReferences } from '@/lib/db/queries';

/** One bounded page per kind, shared by New chat and existing chat composers. */
export function referencePicker(input: Omit<Parameters<typeof listSessionReferences>[0], 'cursor'>) {
  const page = (kind: 'task' | 'note') => listSessionReferences({ ...input, kind });
  const total = (p: ReturnType<typeof page>) => p.counts.inChat + p.counts.workspace + p.counts.all;
  const tasks = input.kind === 'note' ? null : page('task');
  const notes = input.kind === 'task' ? null : page('note');
  return {
    tasks: (tasks?.rows ?? []).map(t => ({ id: t.id, title: t.title, status: t.status ?? 'todo' })),
    notes: (notes?.rows ?? []).map(n => ({ id: n.id, title: n.title })),
    totals: { tasks: tasks ? total(tasks) : 0, notes: notes ? total(notes) : 0 },
  };
}
