import fp from "fastify-plugin";
import { createServices } from "../container.js";

export default fp(
  async (app) => {
    app.decorate(
      "services",
      createServices({
        knex: app.knex,
        config: app.config,
        tokens: app.tokens,
        mail: app.mail,
        log: app.log,
      }),
    );
  },
  { name: "services", dependencies: ["database", "auth", "mail"] },
);
