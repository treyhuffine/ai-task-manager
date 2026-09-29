import { z } from 'zod';

/** Shared by the owner HTTP route and private controller. None of these
 * preferences can change the publisher, signing key, release URL or channel. */
export const UpdatePreferencesSchema = z.object({
  automaticDownload: z.boolean().optional(),
  metered: z.boolean().optional(),
}).strict().refine(value => value.automaticDownload !== undefined || value.metered !== undefined, 'Choose an update preference to change');

export const MaintenanceWindowSchema = z.object({
  hour: z.number().int().min(0).max(23),
  durationHours: z.number().int().min(1).max(12),
  timeZone: z.string().trim().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
    catch { return false; }
  }, 'Choose a valid time zone, such as America/Denver'),
}).strict();

export const UpdateActionSchema = z.object({
  action: z.enum(['check', 'download', 'apply', 'when-idle', 'later']),
  window: MaintenanceWindowSchema.optional(),
}).strict().refine(value => value.window === undefined || value.action === 'when-idle', 'A maintenance window applies only to Update when idle');

export type UpdatePreferences = z.infer<typeof UpdatePreferencesSchema>;
export type MaintenanceWindow = z.infer<typeof MaintenanceWindowSchema>;
export type UpdateAction = z.infer<typeof UpdateActionSchema>;
export interface ReleasePreferences { channel: 'stable' | 'beta'; automaticDownload: boolean; metered: boolean }
