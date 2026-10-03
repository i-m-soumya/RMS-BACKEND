import { z } from 'zod';

export const sessionIdParamSchema = z.object({
  id: z.string().min(1).max(120)
});

export const joinSessionParamSchema = z.object({
  tableId: z.string().min(1).max(120)
});

export const sessionTableParamSchema = z.object({
  table_id: z.string().uuid()
});

export const waiterSessionParamSchema = z.object({
  session_id: z.string().uuid()
});

export const createSessionSchema = z.object({
  table_id: z.string().uuid()
});
