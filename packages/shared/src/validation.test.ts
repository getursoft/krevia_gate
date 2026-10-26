import {
  createMembershipRequestSchema,
  fieldErrors,
  loginSchema,
  normalizeIndianMobile,
  registerSchema,
  updateProfileSchema,
} from './validation';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['91-98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['6000000000', '+916000000000'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each(['5876543210', '987654321', '98765432100', '+1 9876543210', 'abcdefghij', ''])('rejects %s', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });
});

describe('registerSchema', () => {
  const valid = { fullName: 'Asha Rao', phone: '9876543210', password: 'secret123' };

  it('normalises phone and drops empty email', () => {
    const parsed = registerSchema.parse({ ...valid, email: '' });
    expect(parsed.phone).toBe('+919876543210');
    expect(parsed.email).toBeUndefined();
  });

  it('lower-cases email', () => {
    expect(registerSchema.parse({ ...valid, email: 'Asha@Example.COM' }).email).toBe('asha@example.com');
  });

  it('reports field errors', () => {
    const result = registerSchema.safeParse({ fullName: 'A', phone: '123', email: 'nope', password: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(['email', 'fullName', 'password', 'phone']);
    }
  });

  it('requires letters and digits in passwords', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'abcdefgh' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires password', () => {
    expect(loginSchema.safeParse({ phone: '9876543210', password: '' }).success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('rejects empty updates and unknown fields', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ phone: '9876543210' }).success).toBe(false);
  });
  it('treats empty email as clear', () => {
    expect(updateProfileSchema.parse({ email: '' }).email).toBeNull();
  });
});

describe('createMembershipRequestSchema', () => {
  it('upper-cases unit numbers and validates ids', () => {
    const parsed = createMembershipRequestSchema.parse({
      societyId: '3f1c9a8e-1b2c-4d5e-8f90-123456789abc',
      tower: 'T1',
      unitNumber: 'a-1203',
      occupancy: 'OWNER',
    });
    expect(parsed.unitNumber).toBe('A-1203');
    expect(
      createMembershipRequestSchema.safeParse({ ...parsed, societyId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(createMembershipRequestSchema.safeParse({ ...parsed, occupancy: 'GUEST' }).success).toBe(false);
  });
});

import { createInvitationSchema, passwordResetConfirmSchema, updateMemberStatusSchema } from './validation';

describe('sprint 2 validation', () => {
  it('resident invitations need a unit and occupancy; staff invitations must not have one', () => {
    expect(createInvitationSchema.safeParse({ phone: '9876543210', role: 'RESIDENT' }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ phone: '9876543210', role: 'GUARD', unitId: '00000000-0000-4000-8000-000000000000' }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ phone: '9876543210', role: 'ADMIN' }).success).toBe(true);
    expect(createInvitationSchema.safeParse({ phone: '9876543210', role: 'PLATFORM_ADMIN' }).success).toBe(false);
  });

  it('status updates cannot carry a role, and reset codes are 6 digits', () => {
    expect(updateMemberStatusSchema.safeParse({ status: 'ACTIVE', role: 'ADMIN' }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ phone: '9876543210', code: '12345', password: 'Abcdefg1' }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ phone: '9876543210', code: '123456', password: 'Abcdefg1' }).success).toBe(true);
  });
});
