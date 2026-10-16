import { afterAll, describe, expect, it } from "vitest";
import { createKnex } from "../src/database/knex.js";
import { testConfig } from "./helpers.js";

const db = createKnex(testConfig());
afterAll(() => db.destroy());

// PostgreSQL error codes: 23505 unique violation, 23514 check violation
const pgCode = (code: string) => expect.objectContaining({ code });

describe("schema constraints", () => {
  it("treats emails case-insensitively", async () => {
    const insert = (trx: typeof db, email: string) =>
      trx("users").insert({ full_name: "T", email, password_hash: "x" });
    await expect(
      db.transaction(async (trx) => {
        await insert(trx, "A@x.com");
        await insert(trx, "a@x.com");
      }),
    ).rejects.toEqual(pgCode("23505"));
  });

  it("refuses negative stock", async () => {
    await expect(
      db.transaction(async (trx) => {
        const [c] = await trx("categories")
          .insert({ name: "c", slug: "c" })
          .returning("id");
        await trx("products").insert({
          category_id: c.id,
          name: "p",
          slug: "p",
          price: 1,
          quantity: -1,
        });
      }),
    ).rejects.toEqual(pgCode("23514"));
  });

  it("refuses a second primary image for one product", async () => {
    await expect(
      db.transaction(async (trx) => {
        const [c] = await trx("categories")
          .insert({ name: "c", slug: "c" })
          .returning("id");
        const [p] = await trx("products")
          .insert({ category_id: c.id, name: "p", slug: "p", price: 1 })
          .returning("id");
        await trx("product_images").insert({
          product_id: p.id,
          image_url: "a",
          is_primary: true,
        });
        await trx("product_images").insert({
          product_id: p.id,
          image_url: "b",
          is_primary: true,
        });
      }),
    ).rejects.toEqual(pgCode("23505"));
  });

  it("bumps updated_at through the trigger", async () => {
    const [c] = await db("categories")
      .insert({ name: "trg", slug: "trg" })
      .returning(["id", "updated_at"]);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const [after] = await db("categories")
        .where({ id: c.id })
        .update({ name: "trg2" })
        .returning("updated_at");
      expect(after.updated_at.getTime()).toBeGreaterThan(
        c.updated_at.getTime(),
      );
    } finally {
      await db("categories").where({ id: c.id }).delete();
    }
  });

  it("refuses a refund flag on a payment that never succeeded", async () => {
    await expect(
      db.transaction(async (trx) => {
        const [u] = await trx("users")
          .insert({
            full_name: "T",
            email: "refund-check@example.com",
            password_hash: "x",
          })
          .returning("id");
        const [o] = await trx("orders")
          .insert({
            order_code: "AGCHECK0001",
            user_id: u.id,
            subtotal: 1000,
            total_price: 1000,
            payment_method: "vnpay",
            receiver_name: "T",
            receiver_phone: "0901234567",
            shipping_address: "somewhere",
          })
          .returning("id");
        await trx("payments").insert({
          order_id: o.id,
          provider: "vnpay",
          txn_ref: "AGCHECK0001R1",
          amount: 1000,
          expires_at: new Date(),
          refund_status: "pending", // but status is still the default 'pending' payment
        });
      }),
    ).rejects.toEqual(pgCode("23514"));
  });
});
