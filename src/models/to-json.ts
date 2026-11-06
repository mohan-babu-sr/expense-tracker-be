/**
 * Shared toJSON options for every model (design §0 "IDs"):
 * expose `_id` as `id`, hide `_id` and `__v`.
 */
export const toJsonOptions = {
  virtuals: true, // includes the built-in `id` virtual (string form of _id)
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret._id;
    return ret;
  },
};
