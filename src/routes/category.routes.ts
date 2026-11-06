import { Router } from 'express';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../controllers/category.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { categoryBodySchema } from '../validators/category.schema';

export const categoryRouter = Router();

categoryRouter.get('/', asyncHandler(listCategories));
categoryRouter.post('/', validate(categoryBodySchema), asyncHandler(createCategory));
categoryRouter.put('/:id', validate(categoryBodySchema), asyncHandler(updateCategory));
categoryRouter.delete('/:id', asyncHandler(deleteCategory));
