import bcrypt from 'bcryptjs';

/**
 * Hashing for PINs and the admin password (design §8.1, NFR4).
 * bcryptjs = pure JavaScript bcrypt: no native build step, so it installs cleanly on Render.
 * Cost 10 ≈ 50–100 ms per hash — slow enough to make guessing expensive, fast enough for sign-in.
 */
const COST = 10;

export const hashSecret = (plain: string): Promise<string> => bcrypt.hash(plain, COST);

export const compareSecret = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/**
 * Compared against when the mobile number / username doesn't exist, so "unknown account" takes as long as
 * "wrong PIN" — response time then doesn't reveal which accounts exist.
 */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-pin', COST);
