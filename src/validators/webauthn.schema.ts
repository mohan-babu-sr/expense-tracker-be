import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { enteredSecret } from './auth.schema';

/**
 * Passkey request bodies — design §15.3. The device's answer (`response`) is checked in depth by
 * @simplewebauthn/server; here only its outer shape, so junk is a clean 400 before reaching the library.
 */
const credentialResponse = z.looseObject({
  id: z.string().min(1).max(1023),
  rawId: z.string().min(1).max(1023),
  type: z.literal('public-key'),
  response: z.looseObject({ clientDataJSON: z.string().min(1) }),
});

/** POST /webauthn/register/options — the PIN first (R26 AC3). */
export const registerOptionsSchema = z.strictObject({ pin: enteredSecret });
export type RegisterOptionsBody = z.infer<typeof registerOptionsSchema>;

/** POST /webauthn/register/verify */
export const registerVerifySchema = z.strictObject({
  response: credentialResponse,
  deviceName: z.string().trim().min(1, 'Device name is required').max(40),
});
export type RegisterVerifyBody = { response: RegistrationResponseJSON; deviceName: string };

/** POST /webauthn/login/verify and POST /me/verify-passkey */
export const authenticationVerifySchema = z.strictObject({ response: credentialResponse });
export type AuthenticationVerifyBody = { response: AuthenticationResponseJSON };

/** Option endpoints take no input. */
export const emptySchema = z.strictObject({}).default({}); // Express 5: no body → undefined
