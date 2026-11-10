import { Schema, Types, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/** A household group — design §8.2 (R13). All data will belong to one group (T25). */
export interface IGroup {
  name: string;
  /** As the creator typed it, e.g. "HOME-2026" — shown to members so they can invite others. */
  code: string;
  /** Lower-cased copy of `code` with a unique index → codes are unique case-insensitively. */
  codeLower: string;
  /** The user who created it (null when the admin created it). */
  createdBy: Types.ObjectId | null;
}

/** Group code rule (R13 AC2): 6–20 letters, digits or "-". Shared with the zod schemas. */
export const GROUP_CODE_PATTERN = /^[A-Za-z0-9-]{6,20}$/;

const groupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    code: { type: String, required: true, trim: true, match: GROUP_CODE_PATTERN },
    codeLower: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: toJsonOptions },
);

// Same pattern as Category.nameLower: 'validate' runs before 'save', so codeLower exists for `required`.
groupSchema.pre('validate', function () {
  if (this.code) this.codeLower = this.code.trim().toLowerCase();
});

export const Group = model<IGroup>('Group', groupSchema);
