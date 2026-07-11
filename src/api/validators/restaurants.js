import { z } from 'zod';

export const slugParamSchema = z.object({
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/)
});

export const tableParamSchema = z.object({
  id: z.string().min(2).max(120),
  tableId: z.string().min(1).max(120)
});
