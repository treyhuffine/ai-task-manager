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

/** `offer` hands the controller a release built on this computer from a
 * checkout (docs/always-on-spec.md section 8). `apply-now` switches without
 * waiting for running chats. `rollback` goes back one release (section 7.6). */
export const UpdateActionSchema = z.object({
  action: z.enum(['check', 'download', 'apply', 'when-idle', 'later', 'offer', 'apply-now', 'rollback']),
  window: MaintenanceWindowSchema.optional(),
  release: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  local: z.object({
    commit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
    checkout: z.string().min(1).max(4096).optional(),
  }).strict().optional(),
}).strict()
  .refine(value => value.window === undefined || value.action === 'when-idle', 'A maintenance window applies only to Update when idle')
  .refine(value => (value.action === 'offer') === (value.release !== undefined), 'Only an offer names a release, and every offer names one')
  .refine(value => value.local === undefined || value.action === 'offer', 'Only an offer describes a local release');

export type UpdatePreferences = z.infer<typeof UpdatePreferencesSchema>;
export type MaintenanceWindow = z.infer<typeof MaintenanceWindowSchema>;
export type UpdateAction = z.infer<typeof UpdateActionSchema>;
export interface ReleasePreferences { channel: 'stable' | 'beta'; automaticDownload: boolean; metered: boolean }
