import { Schema, Types, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/** Shape of a category document — design §1 (R5), §8.2 (each group has its own categories). */
export interface ICategory {
  groupId: Types.ObjectId;
  name: string;
  /** Lower-cased copy of `name`; unique per group → case-insensitive uniqueness ("food" = "Food"). */
  nameLower: string;
  icon: string;
  color: string;
  isDefault: boolean;
  /** Only "Other" — can never be deleted. */
  isSystem: boolean;
}

const categorySchema = new Schema<ICategory>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    nameLower: { type: String, required: true },
    icon: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: toJsonOptions },
);

// Unique per group (design §8.2): two groups can both have "Food".
categorySchema.index({ groupId: 1, nameLower: 1 }, { unique: true });

// 'validate' runs before 'save', so `nameLower` is set before the `required` check.
// Every create/update in this app goes through save(), so this hook always runs.
categorySchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.trim().toLowerCase();
});

export const Category = model<ICategory>('Category', categorySchema);
