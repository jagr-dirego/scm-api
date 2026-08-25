import { z } from 'zod';

const branchSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
});

export const authenticatedContextSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().min(1),
  }),
  organization: z.object({
    id: z.string().uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
  }),
  membership: z.object({
    id: z.string().uuid(),
    defaultBranch: branchSchema.nullable(),
  }),
  session: z.object({
    id: z.string().uuid(),
    idleExpiresAt: z.string().datetime({ offset: true }),
    absoluteExpiresAt: z.string().datetime({ offset: true }),
  }),
  capabilities: z.array(z.string().min(1)),
});

export type AuthenticatedContext = z.infer<typeof authenticatedContextSchema>;
