import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { env } from '../config/env';
import { HttpError } from '../middleware/error-handler';
import type { PasskeyDoc } from '../models/passkey.model';
import type { UserDoc } from '../models/user.model';
import {
  CHALLENGE_TTL_MS,
  WebauthnChallenge,
  type ChallengePurpose,
} from '../models/webauthn-challenge.model';
import { cookieOptions } from './session';

/**
 * Passkeys (WebAuthn) — design §15. A thin wrapper over @simplewebauthn/server so controllers don't repeat the
 * RP settings, and so every ceremony is `userVerification: 'required'` (fingerprint / face / screen lock, not
 * just "has the phone" — design §15.1).
 *
 * Flow for every ceremony: options (store a random challenge, its id in the httpOnly cookie `wa`) → the device
 * signs it → verify (take the challenge = delete it, check the signature, origin and RP ID).
 */

const CHALLENGE_COOKIE = 'wa';
/** How long the browser shows its prompt before giving up. */
const PROMPT_TIMEOUT_MS = 2 * 60 * 1000;

export const challengeExpired = () =>
  new HttpError(400, 'That took too long. Please try again.', undefined, { code: 'CHALLENGE_EXPIRED' });

async function storeChallenge(
  res: Response,
  challenge: string,
  purpose: ChallengePurpose,
  userId: Types.ObjectId | null,
): Promise<void> {
  const doc = await WebauthnChallenge.create({
    challenge,
    purpose,
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  res.cookie(CHALLENGE_COOKIE, doc.id as string, { ...cookieOptions, maxAge: CHALLENGE_TTL_MS });
}

/**
 * Removes and returns the challenge this browser was given (single use → no replay). It must be for the same
 * purpose and the same user, so a sign-in challenge can't be reused to unlock salaries, etc.
 */
export async function takeChallenge(
  req: Request,
  res: Response,
  purpose: ChallengePurpose,
  userId: Types.ObjectId | null,
): Promise<string> {
  const id: unknown = req.cookies?.[CHALLENGE_COOKIE];
  res.clearCookie(CHALLENGE_COOKIE, cookieOptions);
  if (typeof id !== 'string' || !isValidObjectId(id)) throw challengeExpired();
  const doc = await WebauthnChallenge.findOneAndDelete({ _id: id, purpose, userId });
  // The TTL index only runs about once a minute, so expiry is checked here as well.
  if (!doc || doc.expiresAt.getTime() < Date.now()) throw challengeExpired();
  return doc.challenge;
}

/** The WebAuthn "user handle" = the user's ObjectId bytes (no personal data on the device's key). */
const userHandleOf = (userId: Types.ObjectId) => new Uint8Array(Buffer.from(userId.toHexString(), 'hex'));

/** Does the handle the device returned belong to this user id? */
export function userHandleMatches(userHandle: string | undefined, userId: Types.ObjectId): boolean {
  if (!userHandle) return true; // optional for non-discoverable use; the credential lookup already ties it to a user
  return Buffer.from(userHandle, 'base64url').toString('hex') === userId.toHexString();
}

const toAllowed = (passkeys: PasskeyDoc[]) =>
  passkeys.map((p) => ({ id: p.credentialId, transports: p.transports }));

/** Options for "Set up on this device" (R26 AC3). Existing devices are excluded so one isn't added twice. */
export async function registrationOptions(
  res: Response,
  user: UserDoc,
  existing: PasskeyDoc[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userID: userHandleOf(user._id),
    userName: user.mobile,
    userDisplayName: user.name,
    timeout: PROMPT_TIMEOUT_MS,
    attestationType: 'none', // we don't need to know the device make — and it keeps it private
    excludeCredentials: toAllowed(existing),
    // Discoverable credential → sign-in needs no mobile number (R26 AC5, design §15.1).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await storeChallenge(res, options.challenge, 'register', user._id);
  return options;
}

export interface NewCredential {
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports: string[];
}

/** Checks the device's answer to registrationOptions(). Throws 400 if it isn't valid. */
export async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<NewCredential> {
  const failed = () => new HttpError(400, "Couldn't set up fingerprint / Face ID. Please try again.");
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGINS,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: true,
    });
  } catch {
    throw failed();
  }
  if (!result.verified) throw failed();
  const { credential } = result.registrationInfo;
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
  };
}

/**
 * Options for sign-in (no `allow` list → the device offers any passkey it has for this site) or for the salary
 * unlock (`allow` = only the signed-in user's passkeys, R27 AC2).
 */
export async function authenticationOptions(
  res: Response,
  purpose: 'login' | 'verify',
  userId: Types.ObjectId | null,
  allow?: PasskeyDoc[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    timeout: PROMPT_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials: allow ? toAllowed(allow) : [],
  });
  await storeChallenge(res, options.challenge, purpose, userId);
  return options;
}

/**
 * Checks a signature from `passkey`'s device. On success saves the new counter and "last used".
 * Returns false (never throws) for a bad / unverified answer, so callers choose their own message.
 */
export async function verifyAuthentication(
  passkey: PasskeyDoc,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<boolean> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGINS,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    if (!result.verified) return false;
    passkey.counter = result.authenticationInfo.newCounter;
    passkey.lastUsedAt = new Date();
    await passkey.save();
    return true;
  } catch {
    return false;
  }
}
