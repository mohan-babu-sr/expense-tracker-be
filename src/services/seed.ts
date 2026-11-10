import type { Types } from 'mongoose';
import { Admin } from '../models/admin.model';
import { Category } from '../models/category.model';
import { hashSecret } from './secret';

/**
 * Creates the admin account on first start (R13 AC5): username "admin", password from ADMIN_INITIAL_PASSWORD
 * (default "admin"), flagged mustChangePassword so nothing else works until it's changed.
 */
export async function seedAdmin(initialPassword: string): Promise<void> {
  if ((await Admin.estimatedDocumentCount()) > 0) return;
  await Admin.create({
    username: 'admin',
    passwordHash: await hashSecret(initialPassword),
    mustChangePassword: true,
  });
  console.warn('⚠️  Created admin account "admin" with the initial password — sign in and change it now (R13 AC5)');
}

/** Default categories — design §1 "Seeding" (R5 AC1). Colors: Material 300 shades. */
const DEFAULT_CATEGORIES = [
  { name: 'Food', icon: 'restaurant', color: '#E57373' },
  { name: 'Transport', icon: 'directions_car', color: '#64B5F6' },
  { name: 'Shopping', icon: 'shopping_bag', color: '#BA68C8' },
  { name: 'Bills & Utilities', icon: 'receipt_long', color: '#FFB74D' },
  { name: 'Entertainment', icon: 'movie', color: '#F06292' },
  { name: 'Health', icon: 'medical_services', color: '#4DB6AC' },
  { name: 'Education', icon: 'school', color: '#7986CB' },
  { name: 'Rent', icon: 'home', color: '#A1887F' },
  { name: 'Groceries', icon: 'local_grocery_store', color: '#81C784' },
  { name: 'Other', icon: 'category', color: '#90A4AE', isSystem: true },
];

/**
 * Gives a NEW group its own copy of the default categories (R13 AC10). Called only by createGroup(),
 * so existing groups' edits are never overwritten. (Replaces v1's one-time global seed.)
 */
export async function seedCategoriesForGroup(groupId: Types.ObjectId): Promise<void> {
  // create() (not insertMany) so the pre('validate') hook sets nameLower on each document.
  await Category.create(DEFAULT_CATEGORIES.map((c) => ({ ...c, groupId, isDefault: true })));
}
