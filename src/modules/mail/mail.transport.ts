import type { FastifyBaseLogger } from "fastify";
import nodemailer, { type Transporter } from "nodemailer";
import type { MailMessage, MailTransport } from "./mail.types.js";

export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(
    cfg: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
    },
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth:
        cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
      // a hung SMTP server must not block the worker (and its row locks) forever
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(m: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
  }
}

/** Dev only: prints the mail (OTP codes included!) instead of sending it. env.ts refuses it in production. */
export class LogTransport implements MailTransport {
  constructor(private readonly log: FastifyBaseLogger) {}

  async send(m: MailMessage): Promise<void> {
    this.log.info(
      { to: m.to, subject: m.subject, text: m.text },
      "mail (log transport)",
    );
  }
}
