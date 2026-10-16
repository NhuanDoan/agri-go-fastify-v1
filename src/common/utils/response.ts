import type { PaginationMeta } from "./pagination.js";

export const ok = <T>(data: T, message = "Success") => ({
  success: true as const,
  message,
  data,
});

export const paginated = <T>(
  data: T[],
  meta: PaginationMeta,
  message = "Success",
) => ({
  success: true as const,
  message,
  data,
  meta,
});
