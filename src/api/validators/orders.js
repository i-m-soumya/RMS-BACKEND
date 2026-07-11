import { z } from 'zod';

export const createOrderSchema = z.object({
  sessionId: z.string().min(1).max(120).optional(),
  tableId: z.string().min(1).max(120).optional(),
  restaurantId: z.string().min(1).max(120).optional(),
  cartItems: z.array(
    z.object({
      cartItemId: z.string().optional(),
      quantity: z.number().int().positive(),
      itemTotal: z.number().nonnegative().optional(),
      specialInstructions: z.string().optional(),
      selectedAddons: z.array(z.any()).optional(),
      menuItem: z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        price: z.number().nonnegative().optional(),
        originalPrice: z.number().nonnegative().optional()
      })
    })
  ).min(1)
}).refine((data) => data.sessionId || data.tableId, {
  message: 'sessionId or tableId is required'
});
