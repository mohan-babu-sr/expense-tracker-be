import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { toJsonOptionsWithout } from './to-json';

/** Most passkeys one account may register (R26 AC3). */
export const MAX_PASSKEYS_PER_USER = 10;

/**
 * A registered fingerprint / Face ID device — design §15.2 (R26).
 * Only the PUBLIC key is stored: the private key never leaves the phone/laptop, and no biometric data ever
 * reaches the server. A leaked copy of this collection can't be used to sign in.
 * No groupId: a passkey belongs to a person, not to the group's data.
 */
export interface IPasskey {
  userId: Types.ObjectId;
  /** base64url credential id the browser reports on every use. */
  credentialId: string;
  /** COSE public key from registration — checks the device's signatures. */
  publicKey: Buffer;
  /** Signature counter (many passkeys always report 0; the library handles that). */
  counter: number;
  transports: string[];
  /** e.g. "Chrome on Android" — from the client, only for the Settings list. */
  deviceName: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export type PasskeyDoc = HydratedDocument<IPasskey>;

const passkeySchema = new Schema<IPasskey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    credentialId: { type: String, required: true, unique: true },
    publicKey: { type: Buffer, required: true },
    counter: { type: Number, required: true, default: 0 },
    transports: { type: [String], default: [] },
    deviceName: { type: String, required: true, trim: true, maxlength: 40 },
    lastUsedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // The client only needs { id, deviceName, createdAt, lastUsedAt } (design §15.3).
    toJSON: toJsonOptionsWithout('userId', 'credentialId', 'publicKey', 'counter', 'transports', 'updatedAt'),
  },
);

export const Passkey = model<IPasskey>('Passkey', passkeySchema);
