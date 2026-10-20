import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Converts a shared zod schema into an OpenAPI-compatible JSON schema (input side). */
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Cast avoids TS2589 (deep generic instantiation) inside zod-to-json-schema's typings.
  const toJson = zodToJsonSchema as (s: unknown, o: object) => unknown;
  const { $schema: _ignored, ...rest } = toJson(schema, {
    target: 'openApi3',
    pipeStrategy: 'input',
    effectStrategy: 'input',
  }) as Record<string, unknown>;
  return rest;
}
