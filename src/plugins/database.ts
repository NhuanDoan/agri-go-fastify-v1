import fp from "fastify-plugin";
import { createKnex } from "../database/knex.js";

export default fp(
  async (app) => {
    const db = createKnex(app.config);
    await db.raw("select 1");
    app.decorate("knex", db);
    app.addHook("onClose", async () => {
      await db.destroy();
    });
  },
  { name: "database" },
);
