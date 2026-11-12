import { APP_NAME } from '@/constants/app';
import { getAppSource } from '@/lib/db/queries';

/**
 * The builder chat's brief (shared spec §2 "Ri's builder brief keeps only host facts"). How to
 * build an app is the kit's build skill, which travels with the app's folder. This says only where
 * the folder is, how checks keep away from live data, how to build and check, and what the
 * builder must never do. It's guidance, not isolation (shared spec, Trust).
 */
export function renderAppBuilderBrief(sourceId: string): string {
  const source = getAppSource(sourceId);
  if (!source?.folder) return `You are helping build a personal app, but ${APP_NAME} can't find its folder. Tell the person.`;
  const changing = !!source.changeFolder;
  const where = changing
    ? `You are changing ${source.name}. Work in ${source.changeFolder}, a separate working copy of its repository on the branch ${source.changeBranch}. The running app was installed from ${source.folder}. Never edit that folder.`
    : `You are building ${source.name}, a personal app in its own git repository at ${source.folder}. ${source.url ? 'It is already installed and running, so make changes only after the person starts a change from the app page.' : 'It is not installed yet.'}`;
  return [
    where,
    'Read AGENTS.md and the build skill in .agents/skills (also linked in .claude/skills) before you start. They say how to build an app. Follow them.',
    'Build and check with pnpm in this folder: pnpm install, then pnpm run typecheck, pnpm run test and pnpm run build. Tests use their own empty data directory (set APP_DATA_DIR to a temporary folder for every check or preview) and fixture connectors (APP_CONNECTORS=fixtures), never live data or live accounts.',
    `Commit your work${changing ? ` on ${source.changeBranch}` : ''} with clear messages. Commit the lockfile and vendor/.`,
    `When it's ready, tell the person. ${APP_NAME} installs it with the kit's safe-change command when they choose ${changing ? 'Apply change' : 'Install and connect'}: it checks the commit with disposable data, rehearses it on a copy, and only then switches over.`,
    `Never install, start or stop the app's service, never open its data directory, never connect it to ${APP_NAME} or any assistant, never grant it access to anything, never read ${APP_NAME}'s credentials or settings, and never edit ${APP_NAME}'s source. The person does those things in ${APP_NAME}.`,
  ].join('\n\n');
}
