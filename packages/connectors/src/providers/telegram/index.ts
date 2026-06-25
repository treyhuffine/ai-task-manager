import type { Registry } from '../../core/registry';
import { telegram } from './provider';
import { telegramToolkit } from './toolkit';

export { telegram, telegramResult } from './provider';
export { telegramToolkit } from './toolkit';

/** Register the Telegram bot provider + toolkit. Connected via `connectDirect` (bot token). */
export function registerTelegram(registry: Registry): void {
  registry.addBundle({ provider: telegram(), toolkits: [telegramToolkit] });
}
