export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export const buildMeta = (
  page: number,
  perPage: number,
  total: number,
): PaginationMeta => ({
  page,
  perPage,
  total,
  totalPages: Math.ceil(total / perPage),
});

export const toOffset = (page: number, perPage: number): number =>
  (page - 1) * perPage;

/** What repositories' list methods return. */
export interface Paged<T> {
  items: T[];
  total: number;
}
