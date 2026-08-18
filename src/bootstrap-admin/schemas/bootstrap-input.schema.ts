import { z } from 'zod';

export const bootstrapInputSchema = z.object({
  organizationCode: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .transform((value) => value.toUpperCase()),
  organizationName: z.string().trim().min(2).max(200),
  organizationSlug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(2).max(200),
  password: z.string().min(12).max(128),
});

export type BootstrapInput = z.input<typeof bootstrapInputSchema>;
export type ValidatedBootstrapInput = z.output<typeof bootstrapInputSchema>;
