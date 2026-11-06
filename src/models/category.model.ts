import { Schema, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/** Shape of a category document — design §1 (R5). */
export interface ICategory {
  name: string;
  /** Lower-cased copy of `name` with a unique index → case-insensitive uniqueness ("food" = "Food"). */
  nameLower: string;
  icon: string;
  color: string;
  isDefault: boolean;
  /** Only "Other" — can never be deleted. */
  isSystem: boolean;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 30 },
    nameLower: { type: String, required: true, unique: true },
    icon: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: toJsonOptions },
);

// 'validate' runs before 'save', so `nameLower` is set before the `required` check.
// Every create/update in this app goes through save(), so this hook always runs.
categorySchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.trim().toLowerCase();
});

export const Category = model<ICategory>('Category', categorySchema);
