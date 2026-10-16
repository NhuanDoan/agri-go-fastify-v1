# Runbook

## Deploying

1. Build the image, 2. run `node dist/database/cli.js latest` ONCE (a one-shot job or init step; Knex also holds a lock,
   so a second runner waits), 3. roll out the API. Never start the API before the migration succeeded.
   Rollback of code is safe while the previous schema still works; migrations should be additive (add column, then use it, then drop later).

## Production settings the app insists on

`NODE_ENV=production` refuses to start unless: `MAIL_TRANSPORT=smtp`, `CORS_ORIGINS` lists real origins (not `*`),
the three secrets and `DB_PASSWORD` are not `.env.example` placeholders, and `DB_PASSWORD` is not empty.
Also set: `TRUST_PROXY=true` behind a reverse proxy (otherwise every client looks like the proxy and shares one rate-limit bucket),
`DOCS_ENABLED=false` unless the docs are meant to be public, `LOG_LEVEL=info`.
Pool sizing: `DB_POOL_MAX` x number of instances must stay below PostgreSQL's `max_connections` (100 by default).

## Probes and shutdown

- Liveness `GET /health` (never touches the DB). Readiness `GET /health/ready` (DB check, 2 s timeout; 503 while draining).
- On SIGTERM: readiness -> 503, wait `SHUTDOWN_DELAY_SECONDS`, finish in-flight requests, close the pool, exit 0.
  After `SHUTDOWN_TIMEOUT_SECONDS` it exits 1. The platform's grace period must be longer than delay + timeout.

## Background jobs

Run inside the API (`JOBS_ENABLED=true`): mail outbox (5 s), expiry of unpaid VNPay orders (60 s), housekeeping (1 h).
Safe with several instances. Mail delivery is AT-LEAST-ONCE: a worker leases a mail (`MAIL_LEASE_SECONDS`) and sends
with no transaction open; if it dies, the lease expires and another worker retries, so after a crash a customer may get
one duplicate. Failed mails keep no payload (it may contain a one-time code): the customer asks for a new code.
A lease past its time means a worker died mid-send. That is recovered automatically, but a growing count is worth a look:
`select id, attempts, locked_until from mail_outbox where status = 'pending' and locked_until < now();`

## Health checks in SQL (health checks should return no rows; the refund queue lists work)

```sql
-- stock must equal the sum of the ledger
select p.id, p.quantity, coalesce(sum(h.delta), 0) as ledger
from products p left join inventory_histories h on h.product_id = p.id
group by p.id having p.quantity <> coalesce(sum(h.delta), 0);

-- THE refund queue: money to pay back, per payment, oldest first (also: GET /api/payments/refunds)
select p.id as payment_id, p.txn_ref, p.provider_txn_no, p.amount, p.paid_at, p.refund_reason, o.order_code, o.order_status
from payments p join orders o on o.id = p.order_id
where p.refund_status = 'pending' order by p.paid_at, p.id;

-- invariant: an order flagged refund_pending must have at least one payment waiting for refund
select o.id, o.order_code from orders o
where o.payment_status = 'refund_pending'
  and not exists (select 1 from payments p where p.order_id = o.id and p.refund_status = 'pending');

-- money received that nobody flagged: more successful, un-flagged payments than the order is worth
select o.order_code, o.total_price, sum(p.amount) as received
from orders o join payments p on p.order_id = o.id and p.status = 'success' and p.refund_status = 'none'
group by o.id having sum(p.amount) > o.total_price;

-- unpaid VNPay orders that the expiry job should already have cancelled
select id, order_code, created_at from orders
where payment_method = 'vnpay' and order_status = 'pending' and payment_status = 'unpaid'
  and created_at < now() - interval '1 hour';
```

Work queues:

```sql
select order_code, total_price, updated_at from orders where payment_status = 'refund_pending' order by updated_at;
select p.id, p.txn_ref, p.provider_txn_no, p.amount, p.paid_at, p.refund_reason, o.order_code
from payments p join orders o on o.id = p.order_id
where p.refund_status = 'pending' order by p.paid_at, p.id;
select status, count(*), min(created_at) from mail_outbox group by status;
select id, type, to_email, attempts, last_error from mail_outbox where status = 'failed' order by id desc limit 20;
```

A refund is paid in the VNPay merchant portal (look it up by `provider_txn_no`), then recorded with
`POST /api/payments/:id/refunded` (one payment) or `POST /api/orders/:id/refunded` (every refund of a cancelled order).
Duplicate payments never change the order: it stays paid and keeps being fulfilled.

## VNPay

The IPN URL `https://<public host>/api/payments/vnpay/ipn` must be registered in the merchant portal and reachable by VNPay.
Orders become paid ONLY through the IPN. If payments succeed at the bank but orders stay unpaid, check the IPN URL and the logs
for "VNPay IPN rejected". Secrets differ between sandbox and production.

## Secrets

Rotating `JWT_ACCESS_SECRET` signs everyone out within 15 minutes; `JWT_REFRESH_SECRET` signs everyone out immediately;
`OTP_SECRET` invalidates pending verification and reset codes.

## Backups

`pg_dump -Fc -h <host> -U <user> <db> > agrigo.dump`, restore with `pg_restore -d <db> --clean agrigo.dump`.
Test a restore regularly; an untested backup is a hope.
