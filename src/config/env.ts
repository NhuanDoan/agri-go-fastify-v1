import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DB_HOST: z.string().default("127.0.0.1"),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().default("postgres"),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().min(1),
    DB_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),

    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    CORS_ORIGINS: z.string().default("*"),
    DOCS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    SEED_ADMIN_EMAIL: z.string().email().default("admin@agrigo.local"),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

    APP_NAME: z.string().default("AgriGo"),

    OTP_SECRET: z.string().min(32),
    OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),

    MAIL_TRANSPORT: z.enum(["smtp", "log"]).default("log"),
    MAIL_FROM: z.string().default("AgriGo <no-reply@agrigo.local>"),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    JOBS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    SHIPPING_FEE: z.coerce.number().int().min(0).default(0),

    VNPAY_TMN_CODE: z.string().optional(),
    VNPAY_HASH_SECRET: z.string().optional(),
    VNPAY_URL: z
      .string()
      .url()
      .default("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"),
    VNPAY_RETURN_URL: z
      .string()
      .url()
      .default("http://localhost:3000/api/payments/vnpay/return"),
    VNPAY_EXPIRE_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    FRONTEND_PAYMENT_RESULT_URL: z
      .string()
      .url()
      .default("http://localhost:5173/payment/result"),

    DB_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(65000),
    SHUTDOWN_DELAY_SECONDS: z.coerce.number().int().min(0).max(60).default(0),
    SHUTDOWN_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(120)
      .default(20),

    MAIL_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  })
  .refine((v) => v.JWT_ACCESS_SECRET !== v.JWT_REFRESH_SECRET, {
    path: ["JWT_REFRESH_SECRET"],
    message: "must differ from JWT_ACCESS_SECRET",
  })
  .refine((v) => !(v.NODE_ENV === "production" && v.MAIL_TRANSPORT === "log"), {
    path: ["MAIL_TRANSPORT"],
    message: 'must be "smtp" in production: the log transport prints OTP codes',
  })
  .refine((v) => Boolean(v.VNPAY_TMN_CODE) === Boolean(v.VNPAY_HASH_SECRET), {
    path: ["VNPAY_HASH_SECRET"],
    message: "VNPAY_TMN_CODE and VNPAY_HASH_SECRET must be set together",
  })
  .refine((v) => v.NODE_ENV !== "production" || v.CORS_ORIGINS !== "*", {
    path: ["CORS_ORIGINS"],
    message: 'must list your real origins in production (not "*")',
  })
  .refine(
    (v) =>
      v.NODE_ENV !== "production" ||
      ![v.JWT_ACCESS_SECRET, v.JWT_REFRESH_SECRET, v.OTP_SECRET].some((s) =>
        /change.?me/i.test(s),
      ),
    {
      path: ["JWT_ACCESS_SECRET"],
      message:
        "JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and OTP_SECRET must not be the .env.example placeholders in production",
    },
  )
  .refine(
    (v) =>
      v.NODE_ENV !== "production" ||
      (v.DB_PASSWORD !== "" &&
        !/change.?me/i.test(v.DB_PASSWORD) &&
        v.DB_PASSWORD !== "secret"),
    {
    path: ["DB_PASSWORD"],
      message: "must not be empty or an example placeholder in production",
    },
  );

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
