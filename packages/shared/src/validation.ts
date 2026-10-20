import { z } from 'zod';

/**
 * Indian mobile numbers: 10 digits starting with 6–9, optionally prefixed by
 * +91, 91 or 0, with spaces or hyphens. Normalised to E.164 (+91XXXXXXXXXX).
 */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, '');
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return match ? `+91${match[1]}` : null;
}

export const indianMobileSchema = z
  .string({ required_error: 'Mobile number is required' })
  .trim()
  .min(1, 'Mobile number is required')
  .transform((value, ctx) => {
    const normalized = normalizeIndianMobile(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid 10-digit Indian mobile number',
      });
      return z.NEVER;
    }
    return normalized;
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const fullNameSchema = z
  .string({ required_error: 'Full name is required' })
  .trim()
  .min(2, 'Full name must be at least 2 characters')
  .max(80, 'Full name must be at most 80 characters')
  .regex(/^[\p{L}\p{M} .'-]+$/u, 'Full name can only contain letters, spaces, . \' and -');

/** Empty string from a form means "not provided". */
const optionalEmail = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

export const registerSchema = z.object({
  fullName: fullNameSchema,
  phone: indianMobileSchema,
  email: optionalEmail,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  phone: indianMobileSchema,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    /** `null` or empty string clears the email. */
    email: z
      .union([z.literal(''), z.null(), emailSchema])
      .optional()
      .transform((value) => (value === '' ? null : value)),
  })
  .strict()
  .refine((value) => value.fullName !== undefined || value.email !== undefined, {
    message: 'Provide at least one field to update',
  });
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const societySearchSchema = z.object({
  q: z.string().trim().max(80, 'Search is too long').optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type SocietySearchInput = z.input<typeof societySearchSchema>;

export const towerSchema = z
  .string({ required_error: 'Tower / block is required' })
  .trim()
  .min(1, 'Tower / block is required')
  .max(20, 'Tower / block is too long');

export const unitNumberSchema = z
  .string({ required_error: 'Flat / unit number is required' })
  .trim()
  .toUpperCase()
  .min(1, 'Flat / unit number is required')
  .max(10, 'Flat / unit number is too long')
  .regex(/^[A-Z0-9][A-Z0-9-/]*$/, 'Use letters, numbers, - or / only');

export const OCCUPANCY_TYPES = ['OWNER', 'TENANT'] as const;
export const occupancySchema = z.enum(OCCUPANCY_TYPES, {
  errorMap: () => ({ message: 'Select owner or tenant' }),
});

export const uuidSchema = z.string().uuid('Invalid identifier');

export const createMembershipRequestSchema = z.object({
  societyId: uuidSchema,
  tower: towerSchema,
  unitNumber: unitNumberSchema,
  occupancy: occupancySchema,
});
export type CreateMembershipRequestInput = z.input<typeof createMembershipRequestSchema>;

export const reviewMembershipRequestSchema = z
  .object({ note: z.string().trim().max(280, 'Note is too long').optional() })
  .strict();
export type ReviewMembershipRequestInput = z.input<typeof reviewMembershipRequestSchema>;

/** Flattens zod issues into `{ field: message }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
