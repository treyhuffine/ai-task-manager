import type { Registry } from '../../core/registry';
import { notion } from './provider';
import type { NotionProviderOptions } from './provider';
import { notionToolkit } from './toolkit';

export { notion, NOTION_VERSION } from './provider';
export type { NotionProviderOptions } from './provider';
export { notionToolkit } from './toolkit';

/** Register the Notion provider with its toolkit in one call. */
export function registerNotion(registry: Registry, options: NotionProviderOptions = {}): void {
  registry.addBundle({ provider: notion(options), toolkits: [notionToolkit] });
}
