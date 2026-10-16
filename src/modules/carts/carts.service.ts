import type { Knex } from "knex";
import {
  NotFoundError,
  UnprocessableError,
} from "../../common/errors/app-error.js";
import type { ProductsRepository } from "../products/products.repository.js";
import type { CartsRepository } from "./carts.repository.js";
import type { CartDto } from "./carts.schema.js";
import { toCartDto } from "./carts.serializer.js";

/** The cart is a convenience, not a reservation: stock is only enforced (and locked) at checkout. */
export class CartsService {
  constructor(
    private readonly knex: Knex,
    private readonly repo: CartsRepository,
    private readonly products: ProductsRepository,
  ) {}

  async get(userId: number): Promise<CartDto> {
    const cart = await this.repo.getOrCreate(this.knex, userId);
    return toCartDto(cart.id, await this.repo.lines(this.knex, cart.id));
  }

  async addItem(
    userId: number,
    productId: number,
    quantity: number,
  ): Promise<CartDto> {
    const product = await this.availableProduct(productId);
    const cart = await this.repo.getOrCreate(this.knex, userId);
    const existing = await this.repo.findItem(this.knex, cart.id, productId);
    const total = (existing?.quantity ?? 0) + quantity; // adding the same product accumulates
    this.assertStock(product.quantity, product.unit, total);
    await this.repo.setItem(this.knex, cart.id, productId, total);
    return this.get(userId);
  }

  async setItem(
    userId: number,
    productId: number,
    quantity: number,
  ): Promise<CartDto> {
    const cart = await this.repo.getOrCreate(this.knex, userId);
    if (!(await this.repo.findItem(this.knex, cart.id, productId)))
      throw new NotFoundError("Item not in cart");
    const product = await this.availableProduct(productId);
    this.assertStock(product.quantity, product.unit, quantity);
    await this.repo.setItem(this.knex, cart.id, productId, quantity);
    return this.get(userId);
  }

  async removeItem(userId: number, productId: number): Promise<CartDto> {
    const cart = await this.repo.getOrCreate(this.knex, userId);
    await this.repo.removeItem(this.knex, cart.id, productId);
    return this.get(userId);
  }

  async clear(userId: number): Promise<CartDto> {
    const cart = await this.repo.getOrCreate(this.knex, userId);
    await this.repo.clear(this.knex, cart.id);
    return this.get(userId);
  }

  private async availableProduct(productId: number) {
    const product = await this.products.findById(productId); // soft-deleted products are invisible here
    if (!product || product.status !== "active")
      throw new NotFoundError("Product not available");
    return product;
  }

  private assertStock(stock: number, unit: string, wanted: number): void {
    if (wanted > stock)
      throw new UnprocessableError(`Only ${stock} ${unit} left in stock`);
  }
}
