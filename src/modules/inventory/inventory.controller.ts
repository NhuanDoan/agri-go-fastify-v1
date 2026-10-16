import type { FastifyRequest } from "fastify";
import { buildMeta } from "../../common/utils/pagination.js";
import { paginated } from "../../common/utils/response.js";
import type {
  InventoryHistoryDto,
  ListInventoryQuery,
} from "./inventory.schema.js";
import type { InventoryService } from "./inventory.service.js";
import type { InventoryHistoryRow } from "./inventory.types.js";

const toDto = (r: InventoryHistoryRow): InventoryHistoryDto => ({
  id: r.id,
  productId: r.product_id,
  delta: r.delta,
  quantityAfter: r.quantity_after,
  reason: r.reason,
  orderId: r.order_id,
  createdBy: r.created_by,
  notes: r.notes,
  createdAt: r.created_at.toISOString(),
});

export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  list = async (
    request: FastifyRequest<{ Querystring: ListInventoryQuery }>,
  ) => {
    const { items, total } = await this.service.list(request.query);
    return paginated(
      items.map(toDto),
      buildMeta(request.query.page, request.query.perPage, total),
    );
  };
}
