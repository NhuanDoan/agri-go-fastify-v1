# AgriGo API

Backend service for AgriGo, an agricultural marketplace. The API is built with Fastify and TypeScript, with PostgreSQL persistence through Knex.

## Contents

- [Capabilities](#capabilities)
- [Technology](#technology)
- [Requirements](#requirements)
- [Local development](#local-development)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Policies](#policies)
- [Project structure](#project-structure)
- [Database workflow](#database-workflow)
- [Tests and quality checks](#tests-and-quality-checks)
- [Docker deployment](#docker-deployment)
- [Operations and security](#operations-and-security)

## Capabilities

- Account registration, login, refresh tokens, and email verification or password reset with one-time codes
- Email verification is required to place orders; unverified customers can still browse and manage a cart
- Product catalog, categories, stock ledger, and inventory history
- Customer carts, order lifecycle, and VNPay payment integration
- Verified-purchase product reviews
- Customer support conversations
- Email outbox processing and scheduled housekeeping jobs
- Health probes, structured request logging, rate limits, and OpenAPI documentation

## Technology

- Node.js 22.9 or newer and pnpm 12.14.0
- TypeScript (ES modules), Fastify 5, TypeBox request/response schemas
- PostgreSQL 16 and Knex migrations
- Vitest for automated tests
- Docker Compose for local PostgreSQL, Mailpit, and containerized API deployment

## Requirements

- Node.js `>=22.9`
- pnpm `12.14.0` (the package manager version is pinned in `package.json`)
- Docker and Docker Compose for the supplied local database and Mailpit services

## Local development

Run commands from this directory (`agrigo-api/`).

1. Install dependencies and create local configuration:

   ```bash
   pnpm install --frozen-lockfile
   cp .env.example .env
   ```

2. Replace the example JWT and OTP secrets in `.env` with independent random values. For example, run `openssl rand -base64 48` three times. Keep `.env` out of source control.

3. Start PostgreSQL and Mailpit:

   ```bash
   docker compose up -d db mailpit
   ```

   PostgreSQL is available on port `5432`; Mailpit's inbox is at <http://localhost:8025> and its SMTP service is on port `1025`.

4. Apply the schema, load development data, and start the API:

   ```bash
   pnpm migrate
   pnpm seed
   pnpm dev
   ```

The API listens at <http://localhost:3000>. Interactive API documentation is served at <http://localhost:3000/docs> when `DOCS_ENABLED=true` (the default). Development seeds create an administrator and, when the catalog is empty, sample products. The default local admin email is `admin@agrigo.local`; set `SEED_ADMIN_PASSWORD` in `.env` to choose its password. The seed's development fallback password is `ChangeMe123!`, so configure a private local value before relying on the seeded account.

## Configuration

`.env.example` documents all supported settings. `src/config/env.ts` validates the environment at startup and reports invalid values. Common settings:

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Runtime mode: `development`, `test`, or `production` | `development` |
| `HOST`, `PORT` | Bind address and port | `0.0.0.0`, `3000` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL connection | Local database values in `.env.example` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_SECRET` | Independent signing/sealing secrets; each must be at least 32 characters | Required |
| `CORS_ORIGINS` | Comma-separated allowed browser origins | `*` (development only) |
| `DOCS_ENABLED` | Enable Swagger UI and OpenAPI endpoints | `true` |
| `MAIL_TRANSPORT` | `smtp` or development `log` transport | `log` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP server configuration | `localhost:1025` |
| `MAIL_LEASE_SECONDS` | Outbox worker lease duration; must exceed a single mail send | `120` |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | VNPay merchant credentials; configure both or neither | Unset |
| `JOBS_ENABLED` | Enable in-process outbox and housekeeping jobs | `true` |

See the full list, validation rules, and timeouts in `.env.example` and `src/config/env.ts`. Production mode rejects insecure CORS, missing or example database passwords, placeholder secrets, and the log mail transport.

## API reference

With `DOCS_ENABLED=true`, Swagger UI is at `/docs` and the generated OpenAPI JSON is at `/docs/json`. The API surface includes `/api/auth`, `/api/users`, `/api/categories`, `/api/products`, `/api/inventory-histories`, `/api/cart`, `/api/orders`, `/api/payments/vnpay`, `/api/chat`, and review routes under `/api`. Health endpoints are `/health` and `/health/ready`.

To export the OpenAPI specification to `openapi.json`:

```bash
pnpm openapi
```

Use the live schema as the source of truth for endpoint paths, request schemas, response schemas, and authentication requirements.

## Policies

- **Email verification.** Registration sends a 6-digit code. An unverified account may log in, browse, use the cart, edit its profile, and chat with support. It may not place orders: `POST /api/orders/checkout` and `POST /api/orders/buy-now` answer `403` with `code: "EMAIL_NOT_VERIFIED"` (show a “verify your email” prompt). Verification is read from the database on every order, so it takes effect immediately. Customers created by an admin are verified. Changing an email un-verifies it.
- **Refunds.** Refunds are tracked per payment (`payments.refund_status`): duplicate payments, payments that arrive after a cancellation, and payments for orders cancelled after payment. See the [runbook](docs/RUNBOOK.md) for the queue and refund workflow.
- **Local development.** A freshly registered test user must verify before ordering. Read the code in Mailpit at <http://localhost:8025> and call `POST /api/auth/verify-email`, or use the seeded admin.

## Project structure

```text
src/
  common/       Shared errors, security helpers, schemas, and utilities
  config/       Environment parsing and validation
  database/     Knex setup, migrations, and seed data
  modules/      Feature modules (routes, controllers, services, repositories)
  plugins/      Fastify infrastructure plugins
  app.ts        Application composition
  server.ts     Process startup and graceful shutdown
tests/          API, integration, and unit tests
scripts/        OpenAPI export, smoke check, and payment helper
docs/RUNBOOK.md Production operations and incident reference
```

Feature modules follow a routes → controller → service → repository flow. Routes define the HTTP contract, services hold business rules, and repositories own database access.

## Database workflow

```bash
pnpm migrate                 # apply pending migrations
pnpm migrate:status          # show applied and pending migrations
pnpm migrate:rollback        # roll back the latest migration batch
pnpm migrate:make add_field  # create a migration template
pnpm seed                    # seed local data
```

Create migrations for schema changes and keep production changes backward compatible during rollout. The `seed` command inserts an administrator and baseline categories; sample products are created only outside production and only when the catalog is empty. Production seeding requires an explicit `SEED_ADMIN_PASSWORD`.

## Tests and quality checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Tests use the separate `agrigo_test` database. The supplied Compose PostgreSQL initialization script creates this database on first initialization. For an existing local PostgreSQL instance, create `agrigo_test` yourself and set the test database connection variables used by `tests/helpers.ts`. Do not point tests at a database containing data you need; test setup applies schema migrations to that database.

## Docker deployment

The Compose stack builds the API image, waits for PostgreSQL, runs migrations as a one-shot service, then starts the API:

```bash
cp .env.example .env
# Set independent secrets and deployment-specific values in .env.
docker compose up --build -d
pnpm smoke http://localhost:3000
```

The Compose configuration overrides the container's database host to `db`, SMTP host to `mailpit`, and CORS origin to `http://localhost:5173`. Adjust these values for your deployment. The API container runs as a non-root user with a read-only filesystem and dropped Linux capabilities. Persistent local PostgreSQL data is stored in the `pgdata` volume.

For production, provide secrets through your deployment secret manager, set `NODE_ENV=production`, configure real CORS origins and SMTP credentials, and disable public API docs unless required. Run migrations once per release before rolling out API instances. Deployment probes and migration guidance are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Operations and security

- `GET /health` is a liveness probe and does not depend on PostgreSQL.
- `GET /health/ready` checks database connectivity and returns unavailable during shutdown.
- Responses include `x-request-id`; use it to correlate support reports with structured logs.
- Set `TRUST_PROXY=true` only when requests arrive through a trusted reverse proxy.
- Register `https://<public-host>/api/payments/vnpay/ipn` with VNPay. An order is marked paid through the VNPay IPN callback.
- Configure `FRONTEND_PAYMENT_RESULT_URL` and the VNPay return URL for the deployed frontend and API.
- Review [docs/RUNBOOK.md](docs/RUNBOOK.md) for shutdown behavior, background jobs, database checks, backups, and incident guidance.

## License

ISC. See the `license` field in `package.json`.
