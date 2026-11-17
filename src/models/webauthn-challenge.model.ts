import { HydratedDocument, Schema, Types, model } from 'mongoose';

export const CHALLENGE_PURPOSES = ['register', 'login', 'verify'] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

/** How long the user has between "options" and "verify" (the fingerprint prompt). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * One random challenge per passkey prompt — design §15.2.
 * Kept in MongoDB, not server memory: Render restarts / sleeps would lose memory between the two calls.
 * Single use (deleted when verified) → a captured response can't be replayed. The TTL index makes MongoDB
 * delete abandoned ones by itself (its cleanup runs about once a minute, so expiry is also checked in code).
 */
export interface IWebauthnChallenge {
  challenge: string;
  purpose: ChallengePurpose;
  /** The signed-in user for register/verify; null for sign-in (we don't know who yet). */
  userId: Types.ObjectId | null;
  expiresAt: Date;
}

export type WebauthnChallengeDoc = HydratedDocument<IWebauthnChallenge>;

const challengeSchema = new Schema<IWebauthnChallenge>({
  challenge: { type: String, required: true },
  purpose: { type: String, enum: CHALLENGE_PURPOSES, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  expiresAt: { type: Date, required: true },
});

challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: delete at expiresAt

export const WebauthnChallenge = model<IWebauthnChallenge>('WebauthnChallenge', challengeSchema);
