import { z } from 'zod';

export const orderIdParamSchema = z.object({
  order_id: z.string().uuid()
});

export const createOrderSchema = z.object({
  sessionId: z.string().min(1).max(120).optional(),
  tableId: z.string().min(1).max(120).optional(),
  restaurantId: z.string().min(1).max(120).optional(),
  mobile: z.string().regex(/^\d{10}$/).optional(),
  otpVerificationToken: z.string().uuid().optional(),
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

export const directOrderSchema = z.object({
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().positive(),
    spice_level: z.enum(['mild', 'medium', 'hot', 'extra_hot']).optional(),
    addon_ids: z.array(z.string().uuid()).default([]),
    notes: z.string().max(1000).optional(),
  })).min(1),
});

export const updateStatusSchema = z.object({
  status: z.enum(['confirmed', 'preparing', 'ready']).transform((value) => value.toLowerCase()),
});
