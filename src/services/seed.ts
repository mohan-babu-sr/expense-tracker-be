import { Category } from '../models/category.model';

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

/** Inserts the defaults only when the collection is empty, so user edits are never overwritten. */
export async function seedCategories(): Promise<void> {
  const count = await Category.estimatedDocumentCount();
  if (count > 0) return;

  // create() (not insertMany) so the pre('validate') hook sets nameLower on each document.
  await Category.create(DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true })));
  console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories`);
}
