import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  organizationCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.toUpperCase())
    .optional(),
});

export type LoginInput = z.input<typeof loginSchema>;
export type ValidatedLoginInput = z.output<typeof loginSchema>;
