import { z } from 'zod';

const uuidSchema = z.string().uuid();

const dietaryTypeSchema = z.enum(['veg', 'non_veg', 'vegan', 'contains_egg']);
const itemTypeSchema = z.enum(['regular', 'scheduled', 'combo', 'addon_only']);
const spiceLevelSchema = z.enum(['none', 'mild', 'medium', 'hot', 'extra_hot']);

export const categoryIdParamSchema = z.object({
  id: uuidSchema,
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
  category_ids: z.array(uuidSchema).min(1),
  primary_category_id: uuidSchema.optional(),
  mrp: z.coerce.number().min(0),
  price: z.coerce.number().min(0),
  image_url: z.string().trim().max(500).optional().nullable(),
  item_type: itemTypeSchema,
  dietary_type: dietaryTypeSchema,
  spice_level: spiceLevelSchema.optional().nullable(),
  is_available: z.boolean().default(true),
});

export const createMenuItemSchema = menuItemBaseSchema.superRefine((value, ctx) => {
  if (value.price > value.mrp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price must be less than or equal to mrp',
      path: ['price'],
    });
  }

  if (value.primary_category_id && !value.category_ids.includes(value.primary_category_id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'primary_category_id must be included in category_ids',
      path: ['primary_category_id'],
    });
  }
});

export const itemIdParamSchema = z.object({
  id: uuidSchema,
});

export const updateMenuItemSchema = menuItemBaseSchema.partial().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field is required',
    });
  }

  if (value.category_ids && value.category_ids.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'category_ids must include at least one category',
      path: ['category_ids'],
    });
  }

  if (value.primary_category_id && value.category_ids && !value.category_ids.includes(value.primary_category_id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'primary_category_id must be included in category_ids',
      path: ['primary_category_id'],
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
});

export const uploadMenuItemPhotoSchema = z.object({
  image_data_url: z.string().trim().max(2_000_000),
});

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