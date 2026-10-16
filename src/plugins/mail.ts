import fp from "fastify-plugin";
import { MailOutboxRepository } from "../modules/mail/mail.outbox.repository.js";
import { MailService } from "../modules/mail/mail.service.js";
import { LogTransport, SmtpTransport } from "../modules/mail/mail.transport.js";
import type { MailTransport } from "../modules/mail/mail.types.js";

export interface MailPluginOptions {
  /** Tests inject a capturing transport; production derives one from config. */
  transport?: MailTransport;
}

export default fp<MailPluginOptions>(
  async (app, opts) => {
    const { config } = app;
    const transport =
      opts.transport ??
      (config.MAIL_TRANSPORT === "smtp"
        ? new SmtpTransport(
            {
              host: config.SMTP_HOST,
              port: config.SMTP_PORT,
              secure: config.SMTP_SECURE,
              user: config.SMTP_USER || undefined, // an empty value in .env means "no auth"
              pass: config.SMTP_PASS || undefined,
            },
            config.MAIL_FROM,
          )
        : new LogTransport(app.log));

    app.decorate(
      "mail",
      new MailService(
        app.knex,
        new MailOutboxRepository(),
        transport,
        config.APP_NAME,
        app.log,
        config.MAIL_LEASE_SECONDS,
      ),
    );
  },
  { name: "mail", dependencies: ["database"] },
);
