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

export const updateRestaurantSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  address: z.string().trim().min(3).max(240).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  pincode: z.string().trim().min(4).max(12).optional(),
  timezone: z.string().trim().min(3).max(64).optional(),
  contactEmail: z.string().email().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required for update');

export const updateRestaurantBrandingSchema = z.object({
  logoUrl: z.string().url().max(500).nullable().optional(),
  welcomeMessage: z.string().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one branding field is required');

export const updateRestaurantGstSchema = z.object({
  gstEnabled: z.coerce.boolean(),
  gstNumber: z.string().trim().max(50).nullable().optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
}).strict().refine((value) => !value.gstEnabled || Boolean(value.gstNumber), 'GST number is required when GST is enabled');

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
