/** Real Deck components and source labels. Only query data/navigation are fixtures. */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { DeadlineTask } from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';
const data = vi.hoisted(() => ({ deadlines: [] as DeadlineTask[], tasks: [] as TaskListDTO[] }));
vi.mock('@/hooks/use-tasks', () => ({ useDeadlines: () => ({ data: data.deadlines }), useTasks: () => ({ data: data.tasks }) }));
vi.mock('@/hooks/use-areas', () => ({ useAreas: () => ({ data: [{ id: 'private', name: 'My private Area' }] }) }));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({ openTask() {} }) }));
vi.mock('@/components/spaces/space-selector', () => ({ useConnectedTeams: () => ({ data: [{ id: 'team-a', name: 'Same team' }, { id: 'team-b', name: 'Same team' }] }) }));
import { TipProvider } from '@/components/ui/tip';
import { DeadlineBand } from './deadline-band';
import { DeckMoreOptions } from './deck-more-options';
import { DeckTaskBrowser } from './deck-task-browser';
import { createTestHome } from '@/test/fixtures/home';
import { createTask } from '@/lib/db/queries';
import { toTaskListDTO } from '@/lib/api/dto/entity-list';
const sourceArea = { id: 'canonical', name: 'Source Area' };
const render = (children: React.ReactNode) => renderToStaticMarkup(<TipProvider>{children}</TipProvider>);

it('shows disambiguated canonical sources in alternatives, bumped tasks and the deterministic deadline floor', () => {
  data.deadlines = [{ id: 'a', title: 'Deadline outcome', sourceTeamId: 'team-a', sourceArea, status: 'todo', areaId: 'private', parentId: null, hardDeadline: '2026-10-20', daysUntil: 0, overdue: false, dueToday: true, blocked: false, blockedOn: null }];
  const deadlines = render(<DeadlineBand/>);
  expect(deadlines).toContain('Same team (team-a) • Source Area'); expect(deadlines).toContain('Deadline outcome');
  const alternatives = render(<DeckMoreOptions alternatives={[{ id: 'a', taskId: 'a', title: 'Alternative', reason: 'Later', sourceTeamId: 'team-a', sourceArea, areaName: 'My private Area' }]} bumped={[{ taskId: 'b', title: 'Bumped', kind: 'bumped', reason: 'Changed', sourceTeamId: 'team-b', sourceArea }]} onPromote={() => {}} collapsed={false} onToggleCollapse={() => {}}/>);
  for (const text of ['Same team (team-a) • Source Area', 'Same team (team-b) • Source Area', 'My private Area', 'Alternative', 'Bumped']) expect(alternatives).toContain(text);
});

it('the actual Deck browser keeps source Area separate from private Area and excludes released references', async () => {
  const home = await createTestHome();
  try {
    const task = createTask({ title: 'Shared Ready outcome', areaId: null });
    data.tasks = [{ ...toTaskListDTO({ ...task, subtaskCount: 0, subtaskPreview: null }), areaId: 'private', sourceTeamId: 'team-a', sourceTaskId: 'remote', source: { area: sourceArea, assignee: null, updatedAt: task.updatedAt, syncedAt: task.updatedAt, assigned: true, addedAt: null, bodyRevision: 0, statusChangedCount: 0 }, sourceState: 'active' }, { ...toTaskListDTO({ ...task, subtaskCount: 0, subtaskPreview: null }), id: 'released', title: 'Released outcome', status: 'archived', sourceState: 'released' }];
    const html = render(<DeckTaskBrowser deckTaskIds={new Set()} onAddToDeck={() => {}} onClose={() => {}}/>);
    for (const text of ['Shared Ready outcome', 'Same team (team-a) • Source Area', 'My private Area']) expect(html).toContain(text);
    expect(html).not.toContain('Released outcome');
  } finally { await home.cleanup(); }
});
