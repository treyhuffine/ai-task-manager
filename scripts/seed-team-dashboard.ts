/** Synthetic comparison Home. Run only through `pnpm iso <new-root> --init -- ...`. */
import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot, getConfigDir, getDbPath, getWorkDir, getProductionAppRoot, getDevAppRoot, getTestAppRoot } from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import { writeTeamIntent } from '@/lib/home/team-intent';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { ensureLocalToken } from '@/lib/auth/bootstrap';
import { flushMirror } from '@/lib/export/mirror';
import * as q from '@/lib/db/queries';

async function main() {
  if (!process.env.RI_ROOT) throw new Error('Choose a disposable root with pnpm iso first.');
  for (const candidate of [getAppRoot(), getDbPath(), getConfigDir(), getWorkDir()]) {
    if ([getProductionAppRoot(), getDevAppRoot(), getTestAppRoot()].some(root => isWithin(candidate, root))) throw new Error('This seed requires a separate disposable Home.');
  }
  if (fs.existsSync(getDbPath())) throw new Error('This Home already has a database. Choose an empty root.');
  writeTeamIntent({ creationId: 'team-dashboard-comparison', name: 'Field Notes' });
  ensureHomeIdentity();
  ensureLocalToken();
  const owner = q.createTeamOwner({ creationId: 'team-dashboard-comparison', name: 'Maya Okafor', device: { kind: 'computer', name: 'Review browser' } });
  const invitation = q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: owner.member.id });
  const member = q.redeemTeamInvite({ secret: invitation.secret, name: 'Luis Arroyo', device: { kind: 'computer', name: 'Member browser' } });
  q.updateUserState({ onboardedAt: new Date().toISOString(), name: 'Field Notes', defaultHarness: 'codex', defaultModel: 'gpt-6.1-sol' });
  const launch = q.createArea({ name: 'Launch', emoji: '🚀' });
  const research = q.createArea({ name: 'Research', emoji: '🔎' });
  const tasks = [
    q.createTask({ title: 'Review the onboarding prototype', body: '# Onboarding review\n\nWalk through the first-run flow with Luis.\n\n- Check the welcome copy\n- Keep capture one click away\n- Record the decision in our shared notes', status: 'todo', areaId: launch.id, assigneeMemberId: owner.member.id, hardDeadline: new Date(Date.now() + 86400000 * 3).toISOString() }),
    q.createTask({ title: 'Test the bird observation export', body: '# Export checks\n\nMake sure CSV rows keep date, location and species.\n\nAttach the test results here when complete.', status: 'in_progress', areaId: launch.id, assigneeMemberId: member.member.id }),
    q.createTask({ title: 'Explore offline field notebooks', body: 'Compare a simple local cache with full offline editing. Bring the tradeoffs back to the team.', status: 'consider', areaId: research.id }),
    q.createTask({ title: 'Publish the accessibility checklist', body: 'Keyboard and screen reader review completed. The checklist is ready for the next release.', status: 'done', areaId: launch.id, assigneeMemberId: owner.member.id }),
    q.createTask({ title: 'Write the launch announcement', body: 'Draft a short announcement with a link to the new release.', status: 'todo', areaId: launch.id }),
  ];
  q.createTask({ title: 'Check keyboard navigation', areaId: launch.id, status: 'todo', assigneeMemberId: member.member.id });
  const notes = [
    q.createNote({ title: 'Launch working notes', body: '# Release plan\n\nWe are keeping the first release focused on quick capture and a useful daily view.\n\n## Next review\n\nTest the prototype together, then choose the two biggest improvements.', areaId: launch.id }),
    q.createNote({ title: 'Decision: preserve original observations', kind: 'decision', body: '# Keep the source record\n\nExports keep original date and location values. Display preferences do not change the stored observation.\n\nWe chose this so research results remain reproducible.', areaId: research.id }),
  ];
  q.updateNote(notes[0].id, { body: notes[0].body + `\n\nRelated work: [[task:${tasks[0].id}]]` }, { source: 'system' });
  const makeAgent = (name: string, folder: string, purpose: string) => {
    const cwd = path.join(getWorkDir(), 'preview-agents', folder); fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, 'README.md'), `# ${name}\n\nSynthetic workspace for the Team UI comparison.\n`);
    const workspace = q.createWorkspace({ name, cwd, isGit: false, purpose, instructions: 'This is a synthetic review Home. Use only this Home’s shared records and this folder.', defaultDeviceId: q.getHome()!.hostDeviceId, createdByMemberId: owner.member.id });
    q.setAgentFolder(workspace.id, q.getHome()!.hostDeviceId, cwd);
    return workspace;
  };
  const assistant = makeAgent('Field Notes assistant', 'assistant', 'Coordinate shared tasks, notes, decisions and the team’s agents.');
  const builder = makeAgent('Product', 'product', 'Build and review the Field Notes application.');
  const analyst = makeAgent('Research', 'research', 'Read sources and turn findings into useful shared notes.');
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: assistant.id, harness: 'codex', model: 'gpt-6.1-sol', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: owner.member.id });
  q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', authorMemberId: owner.member.id, content: 'What should we focus on for the release?' });
  q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'The onboarding review is the next decision. Luis is checking exports. We can keep the announcement ready while you review the prototype together.' });
  q.setMemberCurrentMainChat(owner.member.id, assistant.id, chat.id);
  q.saveTeamAiSettings({ enabled: true, harness: 'codex', model: 'gpt-6.1-sol', mainChatSessionId: chat.id }, owner.member.id);
  for (const [workspace, title] of [[builder, 'Onboarding prototype'], [analyst, 'Offline notebook research']] as const) {
    const execution = q.createExecution({ workspaceId: workspace.id, worktreePath: null, createdByMemberId: owner.member.id });
    const session = q.createChatSession({ type: 'execution', workspaceId: workspace.id, executionId: execution.id, harness: 'codex', model: 'gpt-6.1-sol', label: title, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: owner.member.id });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', authorMemberId: owner.member.id, content: `Review ${title.toLowerCase()} and write down the next step.` });
    q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: `The ${title.toLowerCase()} is ready for review. This transcript is synthetic so you can compare navigation and editing without starting AI work.` });
  }
  await flushMirror();
  const port = process.env.PORT ?? '42331';
  const preview = { root: getAppRoot(), ownerUrl: `http://localhost:${port}/#token=${owner.token.plaintext}`, memberUrl: `http://localhost:${port}/#token=${member.token.plaintext}`, assistantId: assistant.id, taskId: tasks[0].id, noteId: notes[0].id };
  fs.writeFileSync(path.join(getAppRoot(), 'preview.json'), JSON.stringify(preview, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(preview, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
