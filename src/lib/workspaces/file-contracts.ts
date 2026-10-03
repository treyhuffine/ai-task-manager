import type { fileResponseSchema, treeResponseSchema } from '@/lib/server/remote-contracts';
import type { z } from 'zod/v4';
export type FileResponse = z.infer<typeof fileResponseSchema>;
export type TreeEntry = z.infer<typeof treeResponseSchema>['entries'][number];
export type TreeEntryStatus = NonNullable<TreeEntry['status']>;
