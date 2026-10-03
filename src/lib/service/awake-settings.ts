import { z } from 'zod';

/** Browser-safe contract. Power management belongs to the local controller. */
export const AwakePreferencesSchema = z.object({ enabled: z.boolean() }).strict();
export type AwakePreferences = z.infer<typeof AwakePreferencesSchema>;
export type AwakePower = 'external' | 'battery' | 'unknown';
export interface AwakeStatus extends AwakePreferences {
  phase: 'off' | 'checking' | 'active' | 'on-battery' | 'unavailable' | 'unsupported' | 'stopped';
  power: AwakePower;
  detail: string;
}

export const AwakeStatusSchema = AwakePreferencesSchema.extend({ phase: z.enum(["off", "checking", "active", "on-battery", "unavailable", "unsupported", "stopped"]), power: z.enum(["external", "battery", "unknown"]), detail: z.string() });
