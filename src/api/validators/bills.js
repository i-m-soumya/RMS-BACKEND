import { z } from 'zod';

export const createBillSchema = z.object({
  sessionId: z.string().min(1).max(120),
  restaurantId: z.string().min(1).max(120).optional()
});

export const billSessionParamSchema = z.object({
  sessionId: z.string().min(1).max(120)
});
