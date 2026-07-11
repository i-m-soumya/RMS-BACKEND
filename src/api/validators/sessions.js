import { z } from 'zod';

export const sessionIdParamSchema = z.object({
  id: z.string().min(1).max(120)
});

export const joinSessionParamSchema = z.object({
  tableId: z.string().min(1).max(120)
});

export const createSessionSchema = z.object({
  restaurant_id: z.string().uuid(),
  table_id: z.string().uuid()
});
