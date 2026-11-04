import type { z } from 'zod';
import { AppError } from './errors';

/** Parses with Zod; 400 VALIDATION_ERROR with `{path, code, message}` per issue. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new AppError(
    400,
    'VALIDATION_ERROR',
    'Invalid request',
    r.error.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.message && /^[A-Z_]+$/.test(i.message) ? i.message : i.code.toUpperCase(),
      message: i.message,
    })),
  );
}
