import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { isValidIsoDate } from '../services/date-utils';

/** Reusable zod building blocks shared by several validators. */

export const objectIdSchema = z.string().refine((v) => isValidObjectId(v) && /^[0-9a-f]{24}$/i.test(v), {
  message: 'Invalid id',
});

export const isoDateSchema = z.string().refine(isValidIsoDate, { message: 'Date must be a valid YYYY-MM-DD date' });

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

/** Rupee amount: > 0 with at most 2 decimals (R1 AC1). */
export const amountSchema = z
  .number({ error: 'Amount is required' })
  .positive('Amount must be greater than 0')
  .max(1_00_00_00_000, 'Amount is too large')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'Amount can have at most 2 decimals',
  });

/**
 * Optional free text: trimmed, max length; `''` / `null` / missing all mean "no value".
 * Lets the Angular form send an empty input without special handling.
 */
export const optionalTextSchema = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || undefined : (v ?? undefined)),
    z.string().max(max, `${label} must be at most ${max} characters`).optional(),
  );
