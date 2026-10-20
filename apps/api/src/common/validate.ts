import { fieldErrors, uuidSchema } from '@krevia/shared';
import type { z } from 'zod';
import { Errors } from './errors';

/** Parses untrusted input with a shared zod schema, throwing a 400 with field errors. */
export function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw Errors.validation(fieldErrors(result.error));
  return result.data;
}

export function validateId(id: string, field = 'id'): string {
  const result = uuidSchema.safeParse(id);
  if (!result.success) throw Errors.validation({ [field]: 'Invalid identifier' }, 'Invalid identifier.');
  return result.data;
}
