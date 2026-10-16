import type { Knex } from "knex";
import type { Paged } from "../../common/utils/pagination.js";
import type { InventoryRepository } from "./inventory.repository.js";
import type {
  InventoryFilter,
  InventoryHistoryRow,
} from "./inventory.types.js";

export class InventoryService {
  constructor(
    private readonly knex: Knex,
    private readonly repo: InventoryRepository,
  ) {}

  list(filter: InventoryFilter): Promise<Paged<InventoryHistoryRow>> {
    return this.repo.list(this.knex, filter);
  }
}
