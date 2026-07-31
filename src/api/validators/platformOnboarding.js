import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const restaurantListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const restaurantIdParamSchema = z.object({
  restaurantId: z.string().trim().min(2).max(120),
});

export const tableIdParamSchema = z.object({
  tableId: z.string().trim().min(2).max(120),
});

export const createRestaurantBasicSchema = z.object({
  name: z.string().trim().min(2).max(150),
  slug: z.string().trim().min(2).max(100).regex(slugRegex, 'Slug must be lowercase letters, numbers, and hyphens only'),
  address: z.string().trim().min(3).max(240),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  pincode: z.string().trim().min(4).max(12),
  timezone: z.string().trim().min(3).max(64),
  contactEmail: z.string().email().optional(),
});

export const updateRestaurantBasicSchema = createRestaurantBasicSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required for update',
);

export const floorsAndTablesSchema = z.object({
  floors: z.array(
    z.object({
      name: z.string().trim().min(1).max(100),
      tables: z.array(
        z.object({
          tableNumber: z.string().trim().min(1).max(100),
          capacity: z.coerce.number().int().min(1).max(20),
        }),
      ).min(1),
    }),
  ).min(1),
});

export const createAdminCredentialsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  tempPassword: z.string().min(8).max(64).optional(),
});
