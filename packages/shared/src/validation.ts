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

export const OCCUPANCY_TYPES = ['OWNER', 'TENANT', 'HOUSEHOLD'] as const;
export const occupancySchema = z.enum(OCCUPANCY_TYPES, {
  errorMap: () => ({ message: 'Select owner, tenant or household member' }),
});
export const RESIDENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const UNIT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const UNIT_OCCUPANCY_STATUSES = ['VACANT', 'OCCUPIED'] as const;

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

/* ---------- Sprint 2: password reset, societies, units, members, invitations ---------- */

export const passwordResetRequestSchema = z.object({ phone: indianMobileSchema }).strict();
export type PasswordResetRequestInput = z.input<typeof passwordResetRequestSchema>;

export const RESET_CODE_LENGTH = 6;
export const passwordResetConfirmSchema = z
  .object({
    phone: indianMobileSchema,
    code: z
      .string({ required_error: 'Enter the 6-digit code' })
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code'),
    password: passwordSchema,
  })
  .strict();
export type PasswordResetConfirmInput = z.input<typeof passwordResetConfirmSchema>;

const towersSchema = z
  .array(towerSchema, { required_error: 'Add at least one tower / block' })
  .min(1, 'Add at least one tower / block')
  .max(50, 'At most 50 towers / blocks')
  .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length, 'Tower / block names must be unique');

const societyFields = {
  name: z.string({ required_error: 'Society name is required' }).trim().min(3, 'Society name must be at least 3 characters').max(120, 'Society name is too long'),
  addressLine: z.string({ required_error: 'Address is required' }).trim().min(3, 'Address is required').max(200, 'Address is too long'),
  city: z.string({ required_error: 'City is required' }).trim().min(2, 'City is required').max(80, 'City is too long'),
  state: z.string({ required_error: 'State is required' }).trim().min(2, 'State is required').max(80, 'State is too long'),
  pincode: z.string({ required_error: 'PIN code is required' }).trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  towers: towersSchema,
};

export const createSocietySchema = z.object(societyFields).strict();
export type CreateSocietyInput = z.input<typeof createSocietySchema>;

export const updateSocietySchema = z
  .object({
    name: societyFields.name.optional(),
    addressLine: societyFields.addressLine.optional(),
    city: societyFields.city.optional(),
    state: societyFields.state.optional(),
    pincode: societyFields.pincode.optional(),
    towers: towersSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });
export type UpdateSocietyInput = z.input<typeof updateSocietySchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const buildingNameSchema = z
  .string({ required_error: 'Tower / block name is required' })
  .trim()
  .min(1, 'Tower / block name is required')
  .max(40, 'Tower / block name is too long');

export const floorLevelSchema = z.coerce
  .number({ invalid_type_error: 'Enter the floor number' })
  .int('Enter a whole floor number')
  .min(0, 'Floor cannot be negative')
  .max(200, 'Floor is too high');

export const createBuildingSchema = z.object({ name: buildingNameSchema }).strict();
export type CreateBuildingInput = z.input<typeof createBuildingSchema>;

export const updateBuildingSchema = z
  .object({ name: buildingNameSchema.optional() })
  .strict()
  .refine((v) => v.name !== undefined, { message: 'Provide a name to update' });
export type UpdateBuildingInput = z.input<typeof updateBuildingSchema>;

export const createFloorSchema = z
  .object({
    level: floorLevelSchema,
    name: z.string().trim().max(40, 'Floor name is too long').optional(),
  })
  .strict();
export type CreateFloorInput = z.input<typeof createFloorSchema>;

export const updateFloorSchema = z
  .object({
    level: floorLevelSchema.optional(),
    name: z.union([z.literal(''), z.string().trim().max(40, 'Floor name is too long')]).optional(),
  })
  .strict()
  .refine((v) => v.level !== undefined || v.name !== undefined, { message: 'Provide a floor field to update' });
export type UpdateFloorInput = z.input<typeof updateFloorSchema>;

export const createUnitSchema = z
  .object({
    /** Legacy label; still accepted so Sprint 1/2 clients keep working. */
    tower: towerSchema.optional(),
    buildingId: uuidSchema.optional(),
    floorId: uuidSchema.optional(),
    number: unitNumberSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.tower && !v.buildingId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buildingId'], message: 'Choose a tower / block' });
    }
    if (v.floorId && !v.buildingId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buildingId'], message: 'Choose the tower for this floor' });
    }
  });
export type CreateUnitInput = z.input<typeof createUnitSchema>;

export const updateUnitSchema = z
  .object({
    number: unitNumberSchema.optional(),
    buildingId: uuidSchema.optional(),
    floorId: z.union([uuidSchema, z.null()]).optional(),
  })
  .strict()
  .refine((v) => v.number !== undefined || v.buildingId !== undefined || v.floorId !== undefined, {
    message: 'Provide at least one field to update',
  });
export type UpdateUnitInput = z.input<typeof updateUnitSchema>;

export const unitListSchema = paginationSchema
  .extend({
    tower: towerSchema.optional(),
    buildingId: uuidSchema.optional(),
    floorId: uuidSchema.optional(),
    status: z.enum(UNIT_STATUSES).optional(),
    occupancy: z.enum(UNIT_OCCUPANCY_STATUSES).optional(),
    q: z.string().trim().max(20).optional(),
  })
  .strict();

export const assignUnitSchema = z.object({ membershipId: uuidSchema, occupancy: occupancySchema }).strict();
export type AssignUnitInput = z.input<typeof assignUnitSchema>;

const optionalResidentPhone = z
  .union([z.literal(''), indianMobileSchema])
  .optional()
  .transform((value) => (value ? value : undefined));
const nullableResidentPhone = z
  .union([z.literal(''), z.null(), indianMobileSchema])
  .optional()
  .transform((value) => (value === '' ? null : value));
const optionalResidentEmail = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((value) => (value ? value : undefined));
const nullableResidentEmail = z
  .union([z.literal(''), z.null(), emailSchema])
  .optional()
  .transform((value) => (value === '' ? null : value));

export const vehicleSchema = z
  .object({
    number: z.string().trim().min(1, 'Vehicle number is required').max(20, 'Vehicle number is too long'),
    type: z.string().trim().max(20, 'Vehicle type is too long').optional(),
  })
  .strict();
export const vehiclesSchema = z.array(vehicleSchema).max(10, 'At most 10 vehicles per resident');
export type VehicleInput = z.input<typeof vehicleSchema>;

const residentFields = {
  fullName: fullNameSchema,
  phone: optionalResidentPhone,
  email: optionalResidentEmail,
  emergencyContactName: z.string().trim().max(80, 'Emergency contact name is too long').optional(),
  emergencyContactPhone: optionalResidentPhone,
  vehicles: vehiclesSchema.optional(),
};

export const createResidentSchema = z
  .object({
    ...residentFields,
    unitId: uuidSchema,
    relationship: occupancySchema,
    isPrimary: z.boolean().optional(),
  })
  .strict();
export type CreateResidentInput = z.input<typeof createResidentSchema>;

export const updateResidentSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: nullableResidentPhone,
    email: nullableResidentEmail,
    status: z.enum(RESIDENT_STATUSES).optional(),
    emergencyContactName: z.union([z.literal(''), z.null(), z.string().trim().max(80, 'Emergency contact name is too long')]).optional(),
    emergencyContactPhone: nullableResidentPhone,
    vehicles: vehiclesSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });
export type UpdateResidentInput = z.input<typeof updateResidentSchema>;

export const residentListSchema = paginationSchema
  .extend({
    buildingId: uuidSchema.optional(),
    unitId: uuidSchema.optional(),
    relationship: occupancySchema.optional(),
    status: z.enum(RESIDENT_STATUSES).optional(),
    q: z.string().trim().max(80, 'Search is too long').optional(),
  })
  .strict();

export const addResidentUnitSchema = z
  .object({
    unitId: uuidSchema,
    relationship: occupancySchema,
    isPrimary: z.boolean().optional(),
  })
  .strict();
export type AddResidentUnitInput = z.input<typeof addResidentUnitSchema>;

export const updateResidentUnitSchema = z
  .object({
    relationship: occupancySchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.relationship !== undefined || v.isPrimary !== undefined, { message: 'Provide a field to update' });
export type UpdateResidentUnitInput = z.input<typeof updateResidentUnitSchema>;

export const residentImportQuerySchema = z
  .object({ fileName: z.string().trim().max(120, 'File name is too long').optional() })
  .strict();

export const residentImportListSchema = paginationSchema.strict();

const memberRoleSchema = z.enum(['RESIDENT', 'ADMIN', 'GUARD'], {
  errorMap: () => ({ message: 'Select resident, guard or society admin' }),
});

export const memberListSchema = paginationSchema
  .extend({
    role: memberRoleSchema.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']).optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

/** Admins can suspend, reactivate or revoke. Roles are never changed through this endpoint. */
export const updateMemberStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED'], { errorMap: () => ({ message: 'Choose active, suspended or revoked' }) }),
    reason: z.string().trim().max(280, 'Reason is too long').optional(),
  })
  .strict();
export type UpdateMemberStatusInput = z.input<typeof updateMemberStatusSchema>;

export const createInvitationSchema = z
  .object({
    phone: indianMobileSchema,
    role: memberRoleSchema,
    unitId: uuidSchema.optional(),
    occupancy: occupancySchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === 'RESIDENT' && (!v.unitId || !v.occupancy)) {
      if (!v.unitId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitId'], message: 'Choose the resident\'s flat' });
      if (!v.occupancy) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['occupancy'], message: 'Select owner or tenant' });
    }
    if (v.role !== 'RESIDENT' && (v.unitId || v.occupancy)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitId'], message: 'Only resident invitations include a flat' });
    }
  });
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

export const platformAdminInvitationSchema = z.object({ phone: indianMobileSchema }).strict();
export type PlatformAdminInvitationInput = z.input<typeof platformAdminInvitationSchema>;

/** Invitation tokens are 43-character base64url strings (256 bits). */
export const invitationTokenSchema = z
  .object({ token: z.string({ required_error: 'Invitation token is required' }).trim().regex(/^[A-Za-z0-9_-]{43}$/, 'This invitation link is not valid') })
  .strict();
export type InvitationTokenInput = z.input<typeof invitationTokenSchema>;

export const invitationListSchema = paginationSchema
  .extend({ status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']).optional() })
  .strict();

export const setActiveSocietySchema = z.object({ societyId: uuidSchema }).strict();
export type SetActiveSocietyInput = z.input<typeof setActiveSocietySchema>;

export const auditListSchema = paginationSchema
  .extend({
    action: z.string().trim().regex(/^[a-z_.]{1,64}$/, 'Invalid action').optional(),
    outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  })
  .strict();

/** Flattens zod issues into `{ field: message }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
