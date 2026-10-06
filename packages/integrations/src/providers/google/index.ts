import type { Registry } from '../../core/registry';
import { google, GOOGLE_SCOPES } from './provider';
import type { GoogleProviderOptions } from './provider';
import { googleCalendar } from './calendar';
import { gmail } from './gmail';
import { googleDrive } from './drive';
import { googleDocs } from './docs';
import { googleSheets } from './sheets';

export { google, GOOGLE_SCOPES } from './provider';
export type { GoogleProviderOptions } from './provider';
export { googleCalendar } from './calendar';
export { gmail, encodeEmail } from './gmail';
export { googleDrive } from './drive';
export { googleDocs } from './docs';
export { googleSheets } from './sheets';

/** Register the Google provider with its Calendar, Gmail, Drive, Docs + Sheets toolkits. */
export function registerGoogle(registry: Registry, options: GoogleProviderOptions = {}): void {
  registry.addBundle({
    provider: google(options),
    toolkits: [googleCalendar, gmail, googleDrive, googleDocs, googleSheets],
  });
}
