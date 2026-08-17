# EMI Shield — Mobile EMI Device Management & Installment Platform

A full-stack platform for Pakistani mobile retailers who sell phones on installments: register financed devices, run repayment schedules, track collections, and apply policy-driven device restrictions when payments fall overdue.

---

## ⚠️ Current status — read this first

This codebase is **not yet a production system**, and the README should not pretend otherwise.

| Area | State |
|---|---|
| Authentication, RBAC, tenant isolation | ✅ Implemented and tested |
| Installment / payment / late-fee engine | ✅ Implemented |
| Data store | ⚠️ **Migration in progress.** The PostgreSQL schema, migrations and data import are complete and verified; the application code still reads and writes the JSON store. See [PostgreSQL migration](#-postgresql-migration) below. |
| Device locking | ⚠️ **Mock only.** `MockDeviceManagementService` changes a status field in the database. **No real phone is locked.** |
| SMS / WhatsApp delivery | ❌ Not connected. Messages are queued in the database and marked `QUEUED`, never `SENT` |
| Payment gateways (JazzCash / Easypaisa / Raast) | ❌ Not integrated. All payments are recorded manually at the counter |
| Automated tests | ⚠️ **Backend only.** 120 Vitest/Supertest tests cover the installment engine, payment allocation and the auth/RBAC/tenant-isolation surface. The React client has none. See [Testing](#-testing) |

The two things standing between this and a real product are **a PostgreSQL migration** and **an actual Android DPC application**.

---

## 🚀 Features

### Security & access control
- **JWT authentication** on every endpoint. There are no unauthenticated data routes.
- **bcrypt password hashing** with a strength policy, account lockout after 5 failed attempts, and automatic migration of any legacy plain-text password on first sign-in.
- **Four roles** enforced on both the server and the UI:
  - `SUPER_ADMIN` — platform-wide; the only role that can view another dealership
  - `DEALER_ADMIN` — shop owner; enforcement, payment verification, staff, audit, settings
  - `DEALER_STAFF` — counter work; registration, payment recording, enrollment
  - `CUSTOMER` — self-service view of their own devices and schedule only
- **Tenant isolation** — `dealerId` is always taken from the verified JWT, never from a query parameter. Cross-tenant probes are logged.
- **PII masking by role** — IMEI, CNIC, address and phone are redacted for roles that don't need them, and the raw values are *removed* from the response rather than merely accompanied by a masked copy.
- helmet, CORS allow-list, rate limiting (strict on sign-in), request size limits, and an error handler that never leaks internals.

### Installment engine
- Schedules whose rows **sum exactly** to the financed amount — the remainder lands on the final installment.
- Month arithmetic that doesn't drift for the 29th–31st.
- **Late fees**: fixed or percentage, one-time or daily, with a per-installment cap. Recomputed as absolute totals, so re-running the job never double-charges.
- **Late fee waivers** with a recorded reason.
- **Plan restructuring** — reschedule the remaining balance when a customer genuinely can't pay.
- **Payoff quotes** for early settlement.

### Payments
- Allocation across a plan: targeted installment first, then oldest-first; late fees before principal.
- **Overpayments carry forward** as advance credit instead of disappearing.
- **Payment reversal** for bounced cheques and mis-keyed amounts, with a contra-entry in the ledger.
- Sequential receipt numbers and a printable receipt endpoint.
- Duplicate-reference guard for double-submits at the counter.

### Records & reporting
- **Editable records** — customers and devices can be corrected after registration. IMEI changes require their own confirmation and a written reason, and land in the audit trail as a distinct event.
- **Printable receipts** — every verified payment produces a receipt showing the principal/late-fee split and the plan's remaining balance. Print CSS is sized for 80mm thermal rolls.
- **CSV export** on devices, customers, payments, installment plans, transactions and audit logs. Exports fetch the **whole filtered result set**, not just the page on screen, and carry a UTF-8 BOM so Excel renders Urdu names correctly.
- **Pagination** on every list, with a page-size selector; changing a filter returns to page 1.

### Device management
- Pluggable `IDeviceManagementService` with a working mock and stub adapters for Android Enterprise DPC and Samsung Knox Guard (which throw rather than silently pretending to work).
- Full state machine: `PENDING → ENROLLED → ACTIVE → OVERDUE → LOCK_PENDING → LOCKED → UNLOCK_PENDING → ACTIVE`.
- **Offline command queue** — a lock issued to an offline phone becomes `LOCK_PENDING` and is applied when the device next checks in. The dashboard never claims a lock took effect when it hasn't.
- Single-use, device-bound, cryptographically random enrollment tokens.

### Automation
- Nightly overdue evaluation (00:30 PKT) and hourly enrollment-token cleanup via `node-cron`, plus a catch-up run at boot. Previously the overdue engine only ran when somebody clicked a button.

---

## 🛠️ Stack

- **Frontend** — React 18, TypeScript, Tailwind, Vite, React Router 7
- **Backend** — Node.js, Express, TypeScript, Zod, JWT, bcryptjs, helmet, node-cron
- **Data** — PostgreSQL 16+ via Prisma 7 (schema and migrations in `server/prisma/`); PGlite for zero-install local development. The legacy JSON store is still what the running app reads — see the migration section below.

---

## 📦 Getting started

### 1. Install

```bash
npm install && npm --prefix server install && npm --prefix client install
```

### 2. Configure

```bash
cp server/.env.example server/.env
```

Then generate a real JWT secret and paste it into `server/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The server **refuses to start in production** without a strong `JWT_SECRET` and an explicit `CORS_ORIGINS` list.

> If a value contains `#`, wrap it in quotes — dotenv treats an unquoted `#` as the start of a comment.

### 3. Seed

```bash
npm run seed
```

### 4. Run

```bash
npm run dev
```

Dashboard at **http://localhost:5173**, API at **http://localhost:5000/api**.

### Demo accounts

All seeded accounts share the password from `SEED_DEFAULT_PASSWORD` in `server/.env` (default `Emishield#2026`).

| Email | Role |
|---|---|
| `admin@emishield.pk` | Super Admin |
| `tariq@almadinamobiles.pk` | Dealer Admin |
| `usman@almadinamobiles.pk` | Dealer Staff |
| `ali.customer@gmail.com` | Customer |

---

## 📋 API overview

All routes require `Authorization: Bearer <token>` except `/api/health`, `/api/auth/login` and `/api/auth/register-dealer`.
List endpoints return `{ data, pagination }`.

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/auth/login` | POST | public | Sign in |
| `/api/auth/me` | GET | any | Restore session |
| `/api/auth/change-password` | POST | any | Change own password |
| `/api/auth/impersonate` | POST | super admin | Session as another user, without altering their record |
| `/api/dashboard/stats` | GET | any | Portfolio metrics |
| `/api/dashboard/attention` | GET | staff | Who to chase today |
| `/api/devices` | GET | any | Device directory (scoped, masked, paginated) |
| `/api/devices/:id/lock` | POST | dealer admin | Apply or queue a restriction |
| `/api/devices/:id/unlock` | POST | dealer admin | Restore access |
| `/api/customers` | GET/POST | staff | Directory / registration wizard |
| `/api/customers/:id` | GET/PATCH/DELETE | staff | Detail, edit, deactivate |
| `/api/installments/plans/:id/reschedule` | POST | dealer admin | Restructure the remaining balance |
| `/api/installments/:id/waive-late-fee` | POST | dealer admin | Forgive a penalty, with reason |
| `/api/payments` | GET/POST | staff | Ledger / record a payment |
| `/api/payments/:id/reverse` | POST | dealer admin | Reverse a payment |
| `/api/payments/:id/receipt` | GET | any | Printable receipt |
| `/api/enrollment/generate` | POST | staff | Single-use provisioning QR |
| `/api/users` | GET/POST/PATCH/DELETE | dealer admin | Staff management |
| `/api/audit-logs` | GET | dealer admin | Immutable action trail |

---

## 🧪 Testing

```bash
npm --prefix server test        # one run
npm --prefix server run test:watch
```

The suite runs against a throwaway store in the OS temp directory (`DATA_DIR` is
set by `server/tests/setup.ts`), so it never touches `server/data/store.json`.
No database server needs to be running.

| File | Covers |
|---|---|
| `tests/unit/installment-math.test.ts` | Schedule totals, end-of-month date arithmetic, late-fee accrual, caps, waivers |
| `tests/unit/payment-service.test.ts` | Allocation order, late fee before principal, advance credit, reversal, receipt numbering, auto-unlock |
| `tests/api/auth.test.ts` | Login, lockout, token forgery, expiry, privilege escalation via a forged role claim |
| `tests/api/tenant-isolation.test.ts` | Cross-dealer reads and writes, customer self-service scoping |
| `tests/api/rbac-and-masking.test.ts` | Role guards, PII redaction per role, pagination |
| `tests/api/lifecycle.test.ts` | Registration → six payments → completion, over HTTP |

These exist to make the PostgreSQL cutover below safe: the repository layer can
be swapped in underneath and the same 120 assertions must still hold.

---

## 🐘 PostgreSQL migration

The database half of the migration is **done and verified**. The application half is not — services and routes still use the JSON store, so the running app is unchanged and unbroken.

### What exists and works

| Piece | File | State |
|---|---|---|
| Prisma schema — 15 tables, 19 enums, 60 indexes, 30 foreign keys | `prisma/schema.prisma` | ✅ |
| Versioned SQL migration | `prisma/migrations/20260817000000_init/` | ✅ applied |
| Prisma client + pooling + transaction helper | `src/db/prisma.ts` | ✅ |
| Data import from the JSON store | `scripts/import-store-json.ts` | ✅ run, counts verified |
| Local PostgreSQL with nothing to install | `scripts/pg-server.ts` | ✅ |
| Repository layer over Prisma | `src/db/repositories/` | ✅ |
| Demo dataset loaded straight into PostgreSQL | `src/db/seedPostgres.ts` | ✅ |

Design decisions baked into the schema:

- **Money is `Int`** (whole rupees). The app already rounds to whole rupees; integers remove any chance of floating-point drift on balances.
- **Real date types.** Due dates and grace dates are `DATE`; everything else is `TIMESTAMPTZ`. The repository layer converts back to the ISO strings the app already uses, so domain logic does not have to be rewritten around `Date` objects.
- **Constraints the JSON store could not enforce:** unique IMEI, unique `(dealer, CNIC)`, unique `(dealer, payment reference)` — that last one stops a double-submit at the counter at the database level, not just in application code.
- **No cascade deletes on financial or audit rows.** Removing a customer must never silently take their payment history with it.

### Running it

```bash
npm run db:dev      # starts a real PostgreSQL on :5433 — leave it running
npm run db:deploy   # applies migrations
npm run db:seed     # loads the demo dataset
npm run db:import   # or: migrate server/data/store.json into it (idempotent)
npm run db:studio   # browse the data
```

`npm run db:dev` runs **PostgreSQL 17** from the `embedded-postgres` package, which ships the genuine server binaries. No installer, no admin rights, no Docker, no Windows service. The cluster lives in `~/.emishield/pgdata` — deliberately outside the OneDrive-synced project folder, because cloud sync rewriting files underneath a running server corrupts it. Production points `DATABASE_URL` at a managed PostgreSQL server; no application code changes.

> **Why not PGlite.** PGlite — PostgreSQL compiled to WebAssembly — was the original choice here and was dropped. Against its socket server, the query following *any* Prisma interactive transaction, **including one that committed cleanly**, came back desynchronised by one protocol message and failed. Non-transactional errors were unaffected, and the behaviour was independent of pool size and `maxConnections` on the current 0.5.5 / 0.2.8. Putting payment allocation inside a real transaction is the point of this migration, so the development database has to support them.

Both clusters are created with `--encoding=UTF8 --locale=C`. Without it `initdb` inherits the Windows host locale and builds a **WIN1252** database, which cannot store an Urdu customer name at all; `tests/db/connection.test.ts` asserts the encoding so this cannot regress unnoticed.

### What is left

1. ~~**Repository layer** replacing `src/db/db.ts`~~ — done. `src/db/repositories/` runs filtering, sorting, pagination, counts and sums in SQL; 56 tests cover it against a real PostgreSQL.
2. **Services** (`AuthService`, `PaymentService`, `OverdueEngine`, `DeviceManagementService`, `EnrollmentService`) moved onto it, with payment allocation and customer creation inside real transactions.
3. **Routes** converted to the async repositories.
4. Re-run the full verification suite and delete `src/db/db.ts`.

Until step 4 lands, the app runs on the JSON store and PostgreSQL holds a verified copy of the same data.

---

## 🗺️ Roadmap

1. **PostgreSQL + Prisma migration** — schema and data done; application layer still to cut over (see above).
2. **Android DPC application** — until this exists, "locking" is a database field.
3. **SMS gateway** (Twilio / Jazz / Telenor) so reminders actually reach customers.
4. **Payment gateway** integration for JazzCash, Easypaisa and Raast.
5. **Client tests and CI** — the backend suite exists; the React app has none and nothing runs on push.
6. **Contract PDF with digital signature** — device restriction needs recorded customer consent.
7. Urdu localisation and RTL, PWA offline mode.
