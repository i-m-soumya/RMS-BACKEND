import { z } from 'zod';

export const sessionIdParamSchema = z.object({
  id: z.string().uuid()
});

export const joinSessionParamSchema = z.object({
  tableId: z.string().uuid()
});

export const createSessionSchema = z.object({
  restaurant_id: z.string().uuid(),
  table_id: z.string().uuid()
});
