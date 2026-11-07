import { ReleaseSchema } from '@/lib/service/release-trust';
import type { UpdateCoordinator } from '@/lib/service/update';
import { MaintenanceWindowSchema } from '@/lib/service/update-settings';
import { z } from 'zod/v4';
import { legacySchema } from './inputs';

export const releasePreferencesSchema = z.object({ channel: z.enum(['stable', 'latest']), auto: z.boolean(), metered: z.boolean() });
export const updateStatusSchema = z.object({
  format: z.literal(1), phase: z.enum(['idle', 'available', 'downloading', 'ready', 'waiting', 'draining', 'checkpointing', 'validating', 'committed', 'failed', 'recovery-required']),
  release: legacySchema(ReleaseSchema).optional(), priorId: z.string().optional(), checkpoint: z.string().optional(), approved: z.boolean().optional(), bytes: z.number().optional(),
  reason: z.string().optional(), error: z.string().optional(), changedAt: z.string(), committedAt: z.string().optional(), window: legacySchema(MaintenanceWindowSchema).optional(),
  configured: z.boolean(), busy: z.boolean(), policy: releasePreferencesSchema.nullable(),
  origin: z.object({ source: z.enum(['published', 'checkout']), checkout: z.string().optional() }),
  waitingLong: z.boolean(), automatic: z.boolean().optional(), headsUpAt: z.string().optional(), heldUntil: z.string().optional(),
  waitingSince: z.string().optional(), lastAutomaticAt: z.string().optional(), rejected: z.string().optional(),
  local: z.object({ commit: z.string().optional(), checkout: z.string().optional() }).optional(), force: z.boolean().optional(),
}) satisfies z.ZodType<ReturnType<UpdateCoordinator['status']>>;
