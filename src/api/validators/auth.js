import { z } from 'zod';

export const customerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export const customerRegisterSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(8).max(20),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(128)
});

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16)
});
