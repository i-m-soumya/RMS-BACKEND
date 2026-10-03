import { z } from 'zod';

const uuidSchema = z.string().uuid();

const dietaryTypeSchema = z.enum(['veg', 'non_veg', 'vegan', 'contains_egg']);
const itemTypeSchema = z.enum(['regular', 'scheduled', 'combo', 'addon_only']);
const spiceLevelSchema = z.enum(['none', 'mild', 'medium', 'hot', 'extra_hot']);
const addonIdsSchema = z.array(uuidSchema).default([]);
const scheduleSchema = z.object({
  available_from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'available_from must be HH:MM'),
  available_until: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'available_until must be HH:MM'),
  repeat_daily: z.boolean().default(true),
});

export const categoryIdParamSchema = z.object({
  id: uuidSchema,
});

export const addonIdParamSchema = z.object({ id: uuidSchema });
export const pairingItemParamSchema = z.object({ itemId: uuidSchema });
export const pairingIdParamSchema = z.object({ pairingId: uuidSchema });
export const createPairingSchema = z.object({ pairedItemId: uuidSchema, displayOrder: z.coerce.number().int().min(0).max(32767).optional().default(0) });
export const listMenuAddonsQuerySchema = z.object({ search: z.string().trim().max(100).optional() });
export const menuAddonPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  price: z.coerce.number().finite().min(0),
  isAvailable: z.boolean().optional().default(true),
  displayOrder: z.coerce.number().int().min(0).max(32767).optional().default(0),
});
export const menuAddonItemsSchema = z.object({
  menuItemIds: z.array(uuidSchema),
  action: z.enum(['link', 'unlink']),
});

export const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).optional().nullable(),
  image_url: z.string().trim().url().max(500).optional().nullable(),
  display_order: z.coerce.number().int().min(0).max(32767).optional(),
});

export const updateMenuCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  image_url: z.string().trim().url().max(500).optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const reorderMenuCategoriesSchema = z.object({
  order: z.array(uuidSchema).min(1),
});

export const listMenuItemsQuerySchema = z.object({
  search: z.string().trim().max(150).optional(),
  category_id: uuidSchema.optional(),
  dietary_type: dietaryTypeSchema.optional(),
  item_type: itemTypeSchema.optional(),
  is_available: z.enum(['0', '1', 'true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: z.enum(['name', 'price', 'created_at']).default('created_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

const menuItemBaseSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(5000).optional().nullable(),
  category_ids: z.array(uuidSchema).default([]),
  addon_ids: addonIdsSchema,
  mrp: z.coerce.number().min(0),
  price: z.coerce.number().min(0),
  image_url: z.string().trim().max(500).optional().nullable(),
  item_type: itemTypeSchema,
  dietary_type: dietaryTypeSchema,
  spice_level: spiceLevelSchema.optional().nullable(),
  is_available: z.boolean().default(true),
  schedule: scheduleSchema.optional().nullable(),
});

export const createMenuItemSchema = menuItemBaseSchema.superRefine((value, ctx) => {
  if (value.item_type !== 'addon_only' && value.category_ids.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'category_ids must include at least one category unless item_type is addon_only',
      path: ['category_ids'],
    });
  }
  if (value.price > value.mrp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price must be less than or equal to mrp',
      path: ['price'],
    });
  }

});

export const itemIdParamSchema = z.object({
  id: uuidSchema,
});

export const kitchenOrderItemStatusSchema = z.object({
  status: z.enum(['preparing', 'ready']),
});

export const staffActivityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});

export const updateMenuItemSchema = menuItemBaseSchema.partial().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field is required',
    });
  }

  if (value.category_ids && value.category_ids.length === 0 && value.item_type !== 'addon_only') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'category_ids must include at least one category',
      path: ['category_ids'],
    });
  }

  if (value.mrp !== undefined && value.price !== undefined && value.price > value.mrp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price must be less than or equal to mrp',
      path: ['price'],
    });
  }
});

export const setItemAvailabilitySchema = z.object({
  is_available: z.boolean(),
  reason: z.string().trim().min(1),
});

export const setItemRatingsVisibilitySchema = z.object({
  show_ratings: z.boolean(),
});

const scheduleTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM');
export const scheduleItemParamSchema = z.object({ itemId: uuidSchema });
export const scheduleIdParamSchema = z.object({ id: uuidSchema });
export const schedulePayloadSchema = z.object({ availableFrom: scheduleTimeSchema, availableUntil: scheduleTimeSchema, repeatDaily: z.boolean() }).refine((value) => value.availableUntil > value.availableFrom, { message: 'availableUntil must be later than availableFrom on the same day', path: ['availableUntil'] });
export const availabilityLogQuerySchema = z.object({ menuItemId: uuidSchema.optional(), staffId: uuidSchema.optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

export const listStaffQuerySchema = z.object({
  role: z.enum(['waiter', 'chef', 'restaurant_admin', 'brand_admin']).optional(),
  access: z.enum(['active', 'revoked']).optional(),
  search: z.string().trim().max(150).optional(),
});

export const createStaffSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(150),
  phone: z.string().trim().min(7).max(15).optional().nullable(),
  role: z.enum(['waiter', 'chef']),
});

export const staffIdParamSchema = z.object({
  id: uuidSchema,
});

export const updateStaffAccessSchema = z.object({
  access: z.enum(['active', 'revoked']),
});

const contactSchema = z.object({
  id: uuidSchema.optional(),
  contactType: z.enum(['phone', 'email', 'whatsapp', 'website']),
  contactValue: z.string().trim().min(1).max(150),
  isPrimary: z.boolean().default(false),
  label: z.string().trim().max(50).optional().nullable(),
});

export const restaurantProfileSchema = z.object({
  name: z.string().trim().min(1).max(150),
  logoUrl: z.string().trim().max(500).optional().nullable(),
  welcomeMessage: z.string().max(10000).optional().nullable(),
  managerName: z.string().trim().max(150).optional().nullable(),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().trim().min(1).max(10),
  country: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(50),
  currency: z.string().trim().min(1).max(10),
  contacts: z.array(contactSchema).default([]),
});

export const restaurantGstSchema = z.object({
  gstRegistered: z.boolean(),
  gstin: z.string().trim().optional().nullable(),
  legalName: z.string().trim().max(150).optional().nullable(),
  sacCode: z.string().trim().max(10).optional().nullable(),
  registeredAddress: z.string().trim().optional().nullable(),
  gstRate: z.coerce.number().finite().min(0),
  cgstRate: z.coerce.number().finite().min(0),
  sgstRate: z.coerce.number().finite().min(0),
  igstRate: z.coerce.number().finite().min(0).optional().default(0),
  showOnBill: z.boolean().default(true),
});

export const operatingHoursSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  shifts: z.array(z.object({
    id: uuidSchema.optional(),
    shiftLabel: z.string().trim().max(50).optional().nullable(),
    openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isClosed: z.boolean().default(false),
  })),
});

export const changeRequestSchema = z.object({
  requestType: z.enum(['slug_change', 'table_count_increase', 'table_count_decrease', 'qr_regeneration']),
  requestedValue: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});