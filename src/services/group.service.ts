import type { HydratedDocument, Types } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Category } from '../models/category.model';
import { Group, type IGroup } from '../models/group.model';
import { seedCategoriesForGroup } from './seed';

export type GroupDoc = HydratedDocument<IGroup>;

const codeTaken = () =>
  new HttpError(409, 'This group code is already used', { 'group.code': 'This code is already used' });

/**
 * Creates a group with its default categories — the ONE place groups are created (register now, admin
 * panel in T26), design §8.3, R13 AC10.
 */
export async function createGroup(input: {
  name: string;
  code: string;
  createdBy: Types.ObjectId | null;
}): Promise<GroupDoc> {
  if (await Group.exists({ codeLower: input.code.trim().toLowerCase() })) throw codeTaken();

  let group: GroupDoc;
  try {
    group = await Group.create(input);
  } catch (err) {
    // Two people picking the same code at the same moment: the unique index catches the second one.
    if ((err as { code?: unknown }).code === 11000) throw codeTaken();
    throw err;
  }

  try {
    await seedCategoriesForGroup(group._id);
  } catch (err) {
    await removeGroup(group._id); // never leave a group without its categories ("Other" is required)
    throw err;
  }
  return group;
}

/** Undo for a failed registration / group creation: the group and its categories. */
export async function removeGroup(groupId: Types.ObjectId): Promise<void> {
  await Category.deleteMany({ groupId });
  await Group.deleteOne({ _id: groupId });
}

export async function findGroupByCode(code: string): Promise<GroupDoc | null> {
  return Group.findOne({ codeLower: code.trim().toLowerCase() });
}
