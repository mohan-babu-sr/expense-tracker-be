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

/**
 * Same as `toJsonOptions`, but also removes the given (secret / internal) fields, e.g. `pinHash`.
 * Safety net: even if a controller accidentally sends a whole user document, the hash never leaves the server.
 */
export function toJsonOptionsWithout(...hidden: string[]) {
  return {
    ...toJsonOptions,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      for (const field of hidden) delete ret[field];
      return ret;
    },
  };
}
