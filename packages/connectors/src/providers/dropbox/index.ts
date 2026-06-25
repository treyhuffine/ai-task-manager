import type { Registry } from '../../core/registry';
import { dropbox } from './provider';
import type { DropboxProviderOptions } from './provider';
import { dropboxToolkit } from './toolkit';

export { dropbox, DROPBOX_SCOPES } from './provider';
export type { DropboxProviderOptions } from './provider';
export { dropboxToolkit } from './toolkit';

/** Register the Dropbox provider + files toolkit. */
export function registerDropbox(registry: Registry, options: DropboxProviderOptions = {}): void {
  registry.addBundle({ provider: dropbox(options), toolkits: [dropboxToolkit] });
}
