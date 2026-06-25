import type { Registry } from '../../core/registry';
import { gitlab } from './provider';
import { gitlabToolkit } from './toolkit';

export { gitlab } from './provider';
export { gitlabToolkit } from './toolkit';

/** Register the GitLab provider + toolkit. Connected via `connectDirect` (PAT bearer). */
export function registerGitlab(registry: Registry): void {
  registry.addBundle({ provider: gitlab(), toolkits: [gitlabToolkit] });
}
