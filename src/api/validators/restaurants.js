import { z } from 'zod';

export const slugParamSchema = z.object({
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/)
});

export const tableParamSchema = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid()
});
