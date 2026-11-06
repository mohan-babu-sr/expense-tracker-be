import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type Source = 'body' | 'query';

/**
 * validate(schema, source) — design §2 "Validation & errors".
 * On failure: 400 `{ message: 'Validation failed', errors: { field: msg } }`.
 * On success: replaces req[source] with the parsed (trimmed/coerced) value.
 */
export function validate(schema: ZodType, source: Source = 'body'): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path.join('.') || '_';
        errors[field] ??= issue.message; // keep the first message per field
      }
      res.status(400).json({ message: 'Validation failed', errors });
      return;
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      // Express 5 makes req.query a read-only getter, so redefine it instead of assigning.
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    }
    next();
  };
}
