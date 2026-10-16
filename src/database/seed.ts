import type { Knex } from "knex";
import { hashPassword } from "../common/security/password.js";
import { slugify } from "../common/utils/slugify.js";
import type { AppConfig } from "../config/env.js";

export async function runSeed(db: Knex, config: AppConfig): Promise<void> {
  const prod = config.NODE_ENV === "production";
  if (prod && !config.SEED_ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required when seeding in production",
    );
  }

  const email = config.SEED_ADMIN_EMAIL.toLowerCase();
  const admin = await db("users").whereRaw("lower(email) = ?", [email]).first();
  if (!admin) {
    await db("users").insert({
      full_name: "Administrator",
      email,
      email_verified_at: new Date(),
      password_hash: await hashPassword(
        config.SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
        config.BCRYPT_ROUNDS,
      ),
      role: "admin",
      status: "active",
    });
    console.log(`Created admin ${email}`);
  }

  const categoryIds = new Map<string, number>();
  for (const name of [
    "Rau củ quả",
    "Trái cây",
    "Gạo & ngũ cốc",
    "Thịt & hải sản",
  ]) {
    const slug = slugify(name);
    let row = await db("categories").where({ slug }).first();
    if (!row)
      [row] = await db("categories").insert({ name, slug }).returning("*");
    categoryIds.set(name, row.id);
  }

  // sample products only in development, and only into an empty catalog
  if (!prod && !(await db("products").first())) {
    const samples: [string, string, number, number, string][] = [
      ["Cà chua bi", "Rau củ quả", 45000, 100, "kg"],
      ["Xoài cát Hòa Lộc", "Trái cây", 90000, 60, "kg"],
      ["Gạo ST25", "Gạo & ngũ cốc", 32000, 500, "kg"],
      ["Tôm sú tươi", "Thịt & hải sản", 260000, 30, "kg"],
    ];
    for (const [name, category, price, quantity, unit] of samples) {
      const [p] = await db("products")
        .insert({
          category_id: categoryIds.get(category),
          name,
          slug: slugify(name),
          price,
          quantity,
          unit,
        })
        .returning("id");
      await db("inventory_histories").insert({
        product_id: p.id,
        delta: quantity,
        quantity_after: quantity,
        reason: "import",
        notes: "Seed data",
      });
    }
    console.log("Created sample products");
  }
  console.log("Seed complete");
}
