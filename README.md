# Almas SDM — Mobile EMI Device Management & Installment Platform

[![CI](https://github.com/imaanakhlaq44-debug/instalmentsoftwer/actions/workflows/ci.yml/badge.svg)](https://github.com/imaanakhlaq44-debug/instalmentsoftwer/actions/workflows/ci.yml)

A full-stack platform for Pakistani mobile retailers who sell phones on installments: register financed devices, run repayment schedules, track collections, and apply policy-driven device restrictions when payments fall overdue.

---

## ⚠️ Current status — read this first

The server is **hosted and running**, the handset app is at **v1.5.1** — and the product is still **not proven on a fleet of real phones**. The README should not pretend otherwise.

| Area | State |
|---|---|
| Authentication, RBAC, tenant isolation | ✅ Implemented and tested |
| Installment / payment / late-fee engine | ✅ Implemented |
| Data store | ✅ **PostgreSQL.** Schema, migrations, repository layer, services and routes are all on it. The JSON store is gone. |
| Device locking — server | ✅ The DPC API (enroll, check-in, command, acknowledge) is built and tested. See [Device Policy Controller API](#-device-policy-controller-api) |
| Device locking — handset | ⚠️ **The Android DPC is written, signed and published** (`android/dpc/`), now at **v1.5.1** (`versionCode` 8; tags `dpc-v1.0.0` … `dpc-v1.5.1`, each a signed release APK on GitHub). On top of enrolment, heartbeat, device-owner kiosk lock, honest acknowledgement and boot restore it now has staged restrictions, Factory Reset Protection that is read back and reported, release on payoff, hardware integrity checks and key attestation — see [What the handset app gained since v1.0.0](#what-the-handset-app-gained-since-v100). It builds and its unit tests run in CI. **Nothing in this repository records a pass across a fleet of real phones**, and that is still what stands between this and a product: the Android versions and OEM skins a Pakistani shop actually sells. The release key exists and cannot be rotated, so every later build has to be signed with it. Runbook: [android/RELEASE.md](android/RELEASE.md) |
| Customer consent | ✅ **A device cannot be locked without a signed agreement.** Every financed sale drafts a bilingual contract; the customer signs it on screen; the lock refuses on anything unsigned, voided, or whose figures no longer match the plan. See [Consent](#-consent-the-contract-a-lock-rests-on) |
| SMS delivery | ⚠️ **A paired phone sends today; an aggregator channel is built but has no account.** A shop can pair a phone of its own and it sends the queue from its SIM ([`android/sms-relay/`](android/README.md)). Nothing is marked `SENT` until that handset reports the SIM accepted it. This is right for a small shop and for testing. For volume, an aggregator channel is built ([SMS through an aggregator](#sms-through-an-aggregator)) and switches on once an operator account with a registered sender mask is put in `server/.env`; it has only been tested against a mocked gateway |
| WhatsApp delivery | ⚠️ **Click-to-WhatsApp works; the Business API is a seam.** A WhatsApp button beside each customer opens the shop's own WhatsApp (`wa.me`) with a reminder, overdue notice, receipt or lock warning written by the server from the plan's figures, in Urdu, Roman Urdu or English. The audit trail records who *opened* it — never "sent", because that cannot be known. Automatic sending through the WhatsApp Business Cloud API is built and tested against a mocked Meta, and is **off** until `WHATSAPP_CLOUD_*` credentials are set (see `server/.env.example`) |
| Payments | ⚠️ **A customer can report a transfer; a gateway is built but switched off.** Counter payments work fully; a customer who has sent money by JazzCash/Easypaisa/Raast can submit the transaction ID from home, and the shop confirms it against their own account. Nothing is applied until a person confirms. See [Customer-reported payments](#-customer-reported-payments) |
| Payment gateways (JazzCash / Easypaisa / Raast) | ⚠️ **JazzCash hosted checkout is built and off.** It switches on only with a merchant account in `server/.env`; the signing recipe has not been run against the JazzCash sandbox. Easypaisa and Raast are not built. See [Where a gateway attaches](#where-a-gateway-attaches) |
| Commercial model | ✅ **A lock per handset, not a subscription.** Locks are bought in packs, spent on one IMEI at enrolment, and never returned. See [Licensing](#-licensing-one-lock-one-handset) |
| Deployment | ✅ **Hosted.** The owner runs the server on a VPS. `deploy/` holds what that takes — a three-container compose file (PostgreSQL, the API, and Caddy terminating TLS), a backup script and a runbook for a bare Ubuntu VPS ([deploy/DEPLOY.md](deploy/DEPLOY.md)). CI builds both images on every push. The address and the state of that machine are deliberately not recorded here; whether its backups have ever been restored is something only the person running it can answer |
| Automated tests | ✅ **1,054 tests** — 671 backend against a real PostgreSQL instance, 333 on the React client, 50 on the two Android apps (48 DPC, 2 SMS relay). All run on every push via GitHub Actions. See [Testing](#-testing) |

What is left before this is a real product is **proving the signed DPC on real handsets**. The server is hosted, so a handset has somewhere to reach; what nobody has written down yet is how the app behaves across the phones a shop actually sells. The protocol is complete on both sides and the app refuses to claim a lock it did not apply, so a phone that cannot be held says so on the dashboard rather than silently pretending.

Also true, and easy to miss:

- **Location for recovery does not work on phones running DPC 1.3.0–1.5.1.** Those builds answer a location request only while enrolling, never on the periodic check-in, so a request for a phone in the field stays "waiting for the phone". The source is fixed for **1.5.2** (not yet tagged or released), and phones only get it once that release is published and they update. See [Location for recovery](#location-for-recovery).
- **The newer handset features are unit-tested, not field-tested.** Key attestation, the integrity signals and FRP read-back all depend on what each OEM's firmware actually does.
- **SMS aggregator, automatic WhatsApp and the JazzCash gateway are code without accounts.** Each is tested against a mocked provider and stays off until real credentials are configured. Click-to-WhatsApp needs no account and works now.

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
- helmet, CORS allow-list, rate limiting (strict on sign-in, and 5 shop sign-ups per address per hour), request size limits, and an error handler that never leaks internals.
- **A super admin opens a shop read-only.** Writes are refused in the browser until "edit mode" is turned on and confirmed. This guards against slips; the server's permissions are unchanged.

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
- **The offline rule** — a handset kept off the network restricts itself once it has been out of contact past the dealer's limit *and* an installment is genuinely past its grace period. Off by default, and refused for any customer whose signed agreement does not disclose it. See [The offline rule](#-the-offline-rule-a-phone-that-cannot-be-reached).
- Single-use, device-bound, cryptographically random enrollment tokens.
- **Staged restrictions** — outgoing calls and SMS first, then chosen apps, then the full lock at the third missed installment (or the final one). Only for customers whose signed terms (v1.2+) describe the stages.
- **Re-enrol after a wipe** — `POST /api/devices/:id/re-enroll` puts a factory-reset phone back to `PENDING` for a fresh QR, on the lock it already holds.
- **Release on payoff** — the last payment marks the phone `INACTIVE` inside the payment transaction; the app then undoes every restriction and gives up device owner, so the customer can uninstall it. A shop owner can also release by hand.
- **Tamper alerts** — the handset reports its IMEI(s), serial, device-owner state and integrity signals on every check-in; the server compares them with the sale record and raises flags on the dashboard. See [Hardware integrity](#hardware-integrity-and-tamper-alerts).
- **Sales without a lock** — a phone that cannot run the app (iPhone, no Google Play, Android 7 and older) can still be sold on installments: plan, contract and ledger as usual, no QR, no lock spent, and every lock path refuses it.
- **Returning customers** — a second phone for a CNIC already on file is added to that customer's record. Still refused: the same CNIC under a different name, and a phone number already used by a different CNIC.

### Dashboard
- **A shop registers itself** at `/register`, linked from the login page. No locks are issued until the platform confirms payment.
- **English, Roman Urdu and Urdu** for the whole dashboard, remembered per user. Urdu is in Urdu script, laid out right to left. Text with no entry stays English; the signed agreement keeps its own wording.
- **A platform menu for the super admin** — Home, Lock orders, Shops, Locks sold — separate from a shop's own menu.
- **A Google ID guide**, in English and Urdu, for finding the numeric account ID that Factory Reset Protection needs.

### Automation
- Nightly overdue evaluation (00:30 PKT) and hourly enrollment-token cleanup via `node-cron`, plus a catch-up run at boot. Previously the overdue engine only ran when somebody clicked a button.

---

## 🛠️ Stack

- **Frontend** — React 18, TypeScript, Tailwind, Vite, React Router 7
- **Backend** — Node.js, Express, TypeScript, Zod, JWT, bcryptjs, helmet, node-cron
- **Data** — PostgreSQL 17 via Prisma 7, behind a repository layer in `server/src/db/repositories/`. `embedded-postgres` runs the real server binaries locally with nothing to install.
- **Marketing site** — plain HTML and Tailwind in [`site/`](site/), built by a forty-line script. It reads the dashboard's own `tailwind.config.js`, so the page that sells the product and the product itself cannot drift apart. English and Urdu, with the Urdu setting `dir="rtl"` on the document.
- **Handsets** — Kotlin, Android 8+ ([`android/`](android/README.md)). Two apps: `dpc` on the customer's phone (device owner via QR provisioning, WorkManager heartbeat) and `sms-relay` on the shop's counter phone. No Compose and no HTTP library in either: a handful of endpoints and a couple of screens do not justify them.

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

### 3. Start the database

```bash
npm --prefix server run db:dev
```

Leave it running. Then, in another terminal, apply the schema:

```bash
npm --prefix server run db:deploy
```

### 4. Run

```bash
npm run dev
```

An empty database is seeded with the demo dataset on first boot. To reload it at any time:

```bash
npm --prefix server run db:seed
```

Dashboard at **http://localhost:5173**, API at **http://localhost:5000/api**.

### Demo accounts

All seeded accounts share the password from `SEED_DEFAULT_PASSWORD` in `server/.env`. The example file ships `ChangeMe#2026`, which is also what the server falls back to when the variable is unset.

| Email | Role |
|---|---|
| `admin@almassdm.pk` | Super Admin |
| `tariq@almadinamobiles.pk` | Dealer Admin |
| `usman@almadinamobiles.pk` | Dealer Staff |
| `ali.customer@gmail.com` | Customer |

---

## 📋 API overview

All routes require `Authorization: Bearer <token>` except `/api/health`, `/api/auth/login`, `/api/auth/register-dealer` and `/api/dpc/enroll`.
This table is an overview, not the full list — `server/src/routes/` is.
List endpoints return `{ data, pagination }`. The `/api/dpc/*` routes use a
different scheme entirely — see [Device Policy Controller API](#-device-policy-controller-api).

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/api/auth/login` | POST | public | Sign in |
| `/api/auth/register-dealer` | POST | public | Shop sign-up (the dashboard's `/register` page); rate-limited, issues no locks |
| `/api/auth/me` | GET | any | Restore session |
| `/api/auth/change-password` | POST | any | Change own password |
| `/api/auth/impersonate` | POST | super admin | Session as another user, without altering their record |
| `/api/dashboard/stats` | GET | any | Portfolio metrics |
| `/api/dashboard/attention` | GET | staff | Who to chase today |
| `/api/devices` | GET | any | Device directory (scoped, masked, paginated) |
| `/api/devices/:id/lock` | POST | dealer admin | Apply or queue a restriction |
| `/api/devices/:id/unlock` | POST | dealer admin | Restore access |
| `/api/devices/:id/re-enroll` | POST | dealer admin | Reset a wiped phone's record for a fresh QR, with a reason |
| `/api/devices/:id/release` | POST | dealer admin | Give the phone back for good, with a reason |
| `/api/devices/:id/location-request` | POST | dealer admin | Ask a locked or overdue phone for one location fix, with a reason |
| `/api/devices/:id/location` | GET | dealer admin | Read the stored fix; every read is logged |
| `/api/devices/:id/clear-tamper` | POST | dealer admin | Clear a tamper alert after checking the phone |
| `/api/platform/overview` | GET | super admin | Earnings, orders awaiting payment, every shop, the fleet by status |
| `/api/customers` | GET/POST | staff | Directory / registration wizard |
| `/api/customers/:id` | GET/PATCH/DELETE | staff | Detail, edit, deactivate |
| `/api/installments/plans/:id/reschedule` | POST | dealer admin | Restructure the remaining balance |
| `/api/installments/:id/waive-late-fee` | POST | dealer admin | Forgive a penalty, with reason |
| `/api/payments` | GET/POST | staff | Ledger / record a payment |
| `/api/payments/:id/reverse` | POST | dealer admin | Reverse a payment |
| `/api/payments/:id/receipt` | GET | any | Printable receipt |
| `/api/enrollment/generate` | POST | staff | Single-use provisioning QR |
| `/api/users` | GET/POST/PATCH/DELETE | dealer admin | Staff management |
| `/api/licenses` | GET | dealer admin | Locks bought, spent and left |
| `/api/licenses/packs` | POST | super admin | Record a pack purchase and mint its locks |
| `/api/audit-logs` | GET | dealer admin | Immutable action trail |
| `/api/dpc/enroll` | POST | public | Redeem an enrollment QR, receive device credentials |
| `/api/dpc/check-in` | POST | device | Heartbeat; returns any waiting command, and carries any self-lock the handset applied while out of contact |
| `/api/dpc/commands/ack` | POST | device | Confirm a command was applied |
| `/api/dpc/policy` | GET | device | Current lock state and lock-screen figures |

---

## 🔑 Licensing — one lock, one handset

A licence is not a subscription tier. It is **one lock for one phone**, and it is
spent for good.

| Pack | Price | Per handset |
|---|---|---|
| 1–29 locks | Rs 1,000 each | Rs 1,000 |
| 30 locks | Rs 24,000 | Rs 800 |
| 50 locks | Rs 35,000 | Rs 700 |
| 100 locks | Rs 60,000 | Rs 600 |

Any number from 1 to 500 can be bought at once; the price per lock is set by
how many are bought together (`PRICE_TIERS` in
[`LicenseService.ts`](server/src/services/LicenseService.ts)): 1–29 at Rs 1,000,
30–49 at Rs 800, 50–99 at Rs 700, 100 and over at Rs 600.

**A lock is claimed at enrolment, not at the counter.** The moment a handset
completes provisioning, one lock is stamped with that phone's IMEI and moves to
`CONSUMED`. A sale that falls through before the customer ever scans the QR
therefore costs the dealer nothing, while a phone that is genuinely under
management always has a lock behind it.

**It never comes back.** A device that is paid off, deactivated or replaced does
not return its lock to the pool. That is the commercial model rather than an
oversight: the shop bought the right to hold one particular phone, once.

**Re-enrolment is free.** `device_licenses.device_id` carries a unique index, so
a factory reset, a reinstalled DPC or a re-scanned QR reattaches the lock the
handset already holds instead of quietly spending a second one. A phone wiped
from recovery is put back in the QR queue with **Re-enroll** on its device page.

**Running out stops the counter, not the customer.** Registering a financed sale
is refused when no locks remain — better at the counter than after the phone has
left the shop. If a dealer does run out mid-enrolment, the QR stays valid: buy a
pack and the same code completes.

Locks are minted only by `POST /api/licenses/packs`, which is super-admin only.
No gateway sits in front of it, so issuing a pack *is* the platform confirming
money arrived; a dealer who could do it could mint themselves free stock. A
shop orders on its **Buy locks** page — the pack, how it paid, the transaction
ID and an optional screenshot — and the super admin approves or rejects it on
**Lock orders**. Approval issues the pack in the same transaction, once per
order, so a second or concurrent approval issues nothing.

---

## 📱 Device Policy Controller API

The Android app on the customer's phone talks to `/api/dpc/*`. This is not the
dashboard API behind a different prefix — it differs in three ways that matter.

### It authenticates as a device, not a person

A handset has no user session and must never carry a staff token. Enrollment
issues it a credential of its own:

```
Authorization: Device <deviceId>.<token>
```

The token is 32 random bytes, transmitted exactly once — in the response to
`POST /api/dpc/enroll` — and only its SHA-256 hash is stored. A leak of the
`devices` table therefore does not let anyone impersonate a customer's phone.

The hash is **SHA-256, not bcrypt**, and that is deliberate. bcrypt is slow on
purpose because human-chosen passwords have little entropy and must be expensive
to guess; these tokens come from the system CSPRNG, so brute force is not the
threat, and every phone in the fleet authenticates on every check-in. A
deliberately slow hash there would be a self-inflicted denial of service.

Re-enrolling rotates the credential, which is what makes a factory reset or a
handset swap safe: whatever the previous installation held stops working the
moment a new enrollment completes. A device moved to `REMOVED` or `INACTIVE`
stops authenticating altogether.

### A lock is only real once the phone says so

This is the point of the whole protocol:

```
dealer locks an offline phone   →  LOCK_PENDING, command queued
phone checks in                 →  server hands over the command, state unchanged
phone applies it, acknowledges  →  LOCKED
```

`/check-in` **reports** the waiting command; it does not apply it. Only
`/commands/ack` with `applied: true` moves the device to `LOCKED`. If the phone
answers `applied: false` — device-admin permission revoked, say — the command
stays queued for the next check-in and the reason is written to the device's
timeline for support to read.

Without this split, the dashboard would show a lock that had never reached the
handset, and a dealer would tell a customer their phone was restricted when it
was not.

### It answers to the device, never about the dealership

Responses carry only what the phone needs to render its lock screen: whether it
is locked, the message, whether emergency calls are permitted, the accepted
payment methods, the real amount overdue, the next due date, and the shop's name
and number. No IMEI, no CNIC, no other customer, no other device. A test asserts
that a check-in response contains none of it.

The amounts are the real ones from the installment plan. A fabricated figure on
a screen that is holding someone's phone hostage would be indefensible.

### The handset side

The app that speaks this protocol lives in [`android/dpc/`](android/dpc/README.md).
It is where `applied: true` comes from, and it will not send it for a lock that
did not take hold — an installation that is not device owner refuses every lock
with a reason the dashboard shows, rather than reporting a restriction the
customer's phone never received.

### Trying it without a phone

The dashboard no longer has a Simulator page. It drew a fake handset but acted
on real records, and on a live server that is a way to lock a customer's phone
by mistake, so the page, its menu entry and its buttons were removed.

`/api/simulator` still exists on the server, mounted **only outside
production**, because the test suite uses it to stand in for a handset. The
other way to try the protocol without a phone is an emulator running the debug
build — see [`android/dpc/README.md`](android/dpc/README.md).

### What the handset app gained since v1.0.0

Every row is a git tag and a signed release APK. "Tested" here means unit and
API tests; none of it has a recorded field pass.

| Version | What changed |
|---|---|
| 1.0.0 | Enrolment, heartbeat, kiosk lock, honest acknowledgement, boot restore, the offline rule |
| 1.1.0 | Staged restrictions: calls/SMS, then apps, then the lock. Factory Reset Protection with the dealer's Google account IDs |
| 1.2.0 | Release on payoff: the app gives up device owner and offers **Remove this app** |
| 1.3.0 | Location for recovery — the handset half, see the caveat below |
| 1.4.0 | Hardware integrity report (IMEIs, serial, root, bootloader, test-keys), USB debugging and unknown-source installs closed from enrolment, tamper alerts |
| 1.5.0 | Key attestation by the phone's secure chip, serial pinning; the hardware snapshot now travels on every check-in (1.4.0 sent it only at enrolment) |
| 1.5.1 | FRP is read back from the OS and reported (`ACTIVE`, `LEGACY`, `REFUSED`, `NOT_CONFIGURED`); bilingual Google ID guide on the dashboard |

### Hardware integrity and tamper alerts

A financed phone whose IMEI has been rewritten, or whose bootloader has been
unlocked, is a phone about to stop being managed. From 1.4.0 the handset reports
what it can see, and [`DeviceIntegrityService`](server/src/services/DeviceIntegrityService.ts)
compares it with the sale record.

| Flag | Raised when |
|---|---|
| `IMEI_MISMATCH` | No IMEI the handset reports matches the registered one |
| `SERIAL_MISMATCH` | The serial differs from the one pinned after enrolment |
| `DEVICE_OWNER_LOST` | The app says it no longer holds device owner |
| `ROOTED`, `BOOTLOADER_UNLOCKED`, `CUSTOM_ROM_TEST_KEYS` | The OS-level signals say so |
| `ATTESTED_IMEI_MISMATCH` | The secure chip's factory IMEI is not the registered IMEI |
| `ATTESTATION_INVALID`, `ATTESTATION_REVOKED` | The attestation chain is forged, malformed, or uses a certificate Google has revoked |

**Key attestation (1.5.0)** is the part that does not depend on trusting the
app. The phone's secure chip signs a certificate carrying the factory IMEI(s),
serial and bootloader state, over a challenge the server chose — derived from
the single-use enrolment code the first time, random and issued about once a
day afterwards. The server verifies the chain against Google's roots and
revocation list (`server/src/services/attestation/`).

What it cannot do, said plainly: the root, bootloader and test-keys signals are
read by the app from the OS, and a rooted phone can lie about them. Attestation
falls back step by step — no IMEI, then no IDs at all — on handsets whose maker
did not provision them, which is common on budget phones, and it then proves
less. None of this has been measured on real handsets. An owner clears an alert
by hand after checking the phone, which re-pins the serial.

### Location for recovery

The rule, enforced on the server ([`LocationService`](server/src/services/LocationService.ts)):
a phone is asked for its location only when **all** of these hold —

- the shop turned on **Location for Phone Recovery** in Settings;
- the customer signed terms v1.3 or newer while it was on, so clause 4 says so in English and Urdu;
- the phone is locked, lock-pending or has an installment overdue — a customer who is up to date is never located;
- a shop owner asked, with a written reason. The request stays open 24 hours.

It is one fix per request, never continuous. The handset shows the customer a
notification each time. Coordinates are left out of every ordinary device
response and come only from an owner-only endpoint whose every read is logged;
a fix the server did not ask for is dropped; releasing the phone deletes it.

**Released builds do not answer it.** In DPC 1.3.0–1.5.1, `DpcSync.enroll()`
answered a location request and `DpcSync.syncOnce()` — the fifteen-minute
heartbeat — did not. A request is only ever made for a phone already enrolled,
so on those builds the dashboard's "Find this phone" waits for an answer the
phone never sends. From **1.5.2** the heartbeat answers it too, after any lock
command, so a slow fix never delays a restriction. 1.5.2 is in the source but
not yet tagged, so no phone has it. The server half is tested
(`tests/api/location.test.ts`); the round trip from a real phone is not.

---

## 📴 The offline rule: a phone that cannot be reached

Everything above assumes the handset eventually connects. A customer who keeps
one off the network breaks that assumption entirely: the lock command sits in
`LOCK_PENDING` forever, which is honest and useless. Turning off mobile data
must not be a way to opt out of management.

So the phone carries the rule itself.

```
day 0   phone checks in normally
day 1   customer removes the SIM and disables Wi-Fi
day 5   an installment falls due; nothing can tell the phone
day 8   the handset's own watchdog: 8 days silent, and by the schedule it
        already holds, that installment is past its grace period → it locks
        itself and says so on screen
day 12  the phone connects → check-in reports the self-lock → the shop sees it
        → the server's answer now governs: still overdue, it stays held; paid,
        it releases immediately
```

### Two conditions, never one

Silence alone is not evidence of anything. The handset restricts itself only
when **both** hold:

1. it has not reached the server for the dealer's configured number of days, and
2. by the last schedule it was given, an installment is genuinely past its
   grace period — either the server had already marked money overdue, or the
   next due date plus the grace days is now in the past.

A customer who is paid up and spends a month somewhere without signal keeps a
working phone. Only the one whose installment came due during that silence
does not.

### Where each half lives

| | |
|---|---|
| **The server decides permission** | `offlineLockDaysFor` in [`OfflineLockPolicy.ts`](server/src/services/OfflineLockPolicy.ts) answers one number, sent to the phone on every check-in. The handset never reasons about consent, policy or contract versions — it is told the answer, or it is told zero. |
| **The phone decides the moment** | [`OfflineLockRule`](android/dpc/src/main/java/pk/almassdm/dpc/work/OfflineLockRule.kt) is pure and takes its clock as a parameter, so the whole rule is unit-tested without a device. [`OfflineWatchdogWorker`](android/dpc/src/main/java/pk/almassdm/dpc/work/OfflineWatchdogWorker.kt) runs it every six hours with **no network constraint** — the heartbeat is constrained to `CONNECTED`, so it never runs in the one situation this rule is about. |
| **The shop hears afterwards** | The next check-in carries `offlineLockActive`, which lands on the device's timeline and as its own notice on the device page. It is **not** a status change: `LOCKED` still means a lock this server issued and the phone confirmed. |

### Permission is refused unless everything agrees

`offlineLockDaysFor` returns 0 — never — unless all of these hold:

- the dealer set a limit (0 is the default; the minimum otherwise is 3 days,
  because a weekend in a village with no signal is not evidence of non-payment),
- automatic locking is on, so a shop that locks by hand does not get a rule that
  fires with nobody deciding,
- the device has valid consent, the same check `lockDevice` makes, and
- **the signed terms actually describe the rule.** A contract signed under terms
  v1.0 says a handset may be restricted for non-payment; it does not say the
  phone has to keep reporting in. Clause 4 of **v1.1** does, in both languages,
  with the real day count — and only contracts carrying it grant this.

The limit is also never shortened below the figure printed on the contract in
the customer's hand. A dealer may relax the rule for everybody at any time;
tightening it afterwards applies to new agreements, not to somebody who signed
for fourteen days.

### What it cannot do

It reads the system clock, and a device owner can move that. Rolling the clock
back stalls the count — it does not reverse it, and the lock still lands the
moment the phone reaches the server. So the rule delays enforcement for a
determined customer rather than escaping it, and a handset showing "last
contact: three weeks ago" is visible on the dashboard the entire time.

### Trying it

Outside production, the self-lock action of `/api/simulator/update-state`
stands in for the handset, and the tests use it. It refuses on any device the real rule would
never have touched, so it cannot be used to test something the product does not
do. There is no button for it in the dashboard any more.

---

## ✍️ Consent: the contract a lock rests on

This system can restrict a handset somebody is paying for. Doing that on the
strength of a conversation at a counter is not defensible, so it now rests on a
document.

**Every financed sale drafts a contract inside the registration transaction.**
There is never a financed device in the system with nothing for the customer to
sign. The customer signs on screen — a finger on a counter tablet is fine — and
until they have, `lockDevice` refuses.

### The clause that matters

The terms live in [`server/src/services/contractTerms.ts`](server/src/services/contractTerms.ts),
in English and Urdu side by side, because presenting only English in a Pakistani
shop would make "the customer agreed" a technicality. Clause 4 states the
restriction plainly, and states its limits just as plainly:

> …the software may restrict the handset so that it cannot be used for ordinary
> purposes until the overdue amount is paid. While restricted, the handset will
> continue to allow emergency calls… The software does not read the customer's
> messages, calls, photographs or contacts, does not track the handset's
> location, and cannot erase any data on it.

Those sentences are load-bearing: the document and the software have to describe
the same product. The app requests no `READ_SMS`, reads no contacts or photos,
and implements no wipe command. That quotation is terms v1.0; what the app does
has grown since, and each addition went into the terms before the server would
act on it:

| The app also… | Disclosed from | Refused for older agreements by |
|---|---|---|
| restricts itself after days offline | v1.1 | `OfflineLockPolicy.ts` |
| restricts calls/SMS, then apps, in stages | v1.2 | `StagedRestrictions.ts` |
| reports one location to recover a locked or overdue phone | v1.3 | `LocationService.ts` |
| reports IMEI/serial and root/bootloader state, and can be locked for tampering with nothing overdue | v1.4 | `DisclosurePolicy.ts` |
| is tied to the shop's Google account after a wipe (FRP) | v1.4 | `DisclosurePolicy.ts` |

So the app *does* now hold the location permission — granted by the device
owner for a single fix and revoked straight after — and v1.4 qualifies the
"does not track the handset's location" sentence accordingly. The same audit is
written up for a lawyer in [docs/legal-review-brief.md](docs/legal-review-brief.md),
including the gaps that remain.

### Why the terms are versioned

`CURRENT_TERMS_VERSION` is in source and **an existing version is never edited**.
A contract renders from the version it was signed under, which is the only way an
old signature keeps meaning what it meant. Changing the terms means adding a
version.

### Why the signed figures are compared, not just hashed

The document freezes a snapshot — the customer, the handset, the price, the full
schedule — and `documentHash` is SHA-256 over that snapshot together with the
terms version.

That hash proves one thing: the stored record has not been altered since it was
signed. It cannot prove that the plan being *enforced* is still the plan that
was signed, because it is computed over the snapshot as stored — rewrite the
plan through the ordinary reschedule endpoint and the contract's own figures sit
there unchanged, hashing perfectly.

So there is a second check. `ContractService.planDrift` compares the frozen
figures against the plan in force — the price, the down payment, the financed
amount, the monthly figure, the count, the first due date, the grace period and
every row of the schedule — and names whatever has moved.

Together they close the abuse the feature exists for: signing a customer up at
one figure, quietly restructuring the plan upward, then locking the phone for
non-payment of the new one. The dashboard says so in red, naming what changed,
and the lock refuses until a fresh agreement is signed.

**Repayment is not drift.** Payments, late fees, waivers and status changes move
constantly and none of them is a term anybody agreed to, so none of them counts.
A check that fired on ordinary repayment would refuse every lock on every plan
that had ever been paid into, and a shop would learn to ignore it.

### What the lock checks

`ContractService.consentForDevice` is the single question, asked from inside
`DeviceManagementService.lockDevice` so the nightly auto-lock policy passes
through it too. It refuses on:

- no contract at all
- a contract still in `DRAFT`
- a contract that was voided
- a contract whose stored record no longer matches its own signature
- a contract whose signed figures no longer describe the plan in force

### The printed copy

The dashboard prints the agreement to A4 through the browser, and
`GET /api/contracts/:id/pdf` returns the same document rendered on the server —
same access rules as reading it. Both go through a browser engine, because every
Node PDF library available here lacks proper Arabic text shaping, and half-shaped
Urdu on a document somebody is signing is worse than no Urdu at all. The server
side is headless Chromium driven by `puppeteer-core`
([`ContractPdfService.ts`](server/src/services/ContractPdfService.ts)), with Noto
Nastaliq Urdu embedded in the page; the image change that needs is described in
[deploy/DEPLOY.md](deploy/DEPLOY.md#the-contract-pdf-needs-chromium-in-the-server-image).

---

## 💸 Customer-reported payments

The shop shuts at nine. The customer transfers their installment at ten, from
JazzCash. Until now that payment could not enter the system until somebody
opened the counter in the morning — and the handset stayed locked all night on
money that had already been sent.

A customer can now report the transfer themselves: amount, method, the
transaction ID, and optionally a screenshot. It lands in the shop's queue, and
whoever is on duty confirms it from wherever they are.

### What it does not do

**It does not credit anybody's account.** A transaction ID typed into a form is
a claim, not a reconciliation. The payment is stored `PENDING` with
`source = CUSTOMER`, no receipt number, and the plan's balance is untouched.
Only verification — a person looking at their own JazzCash or bank statement and
deciding — applies the money, settles the installment, issues the receipt and
triggers the unlock.

Both screens say so plainly. The customer's reads *"your phone unlocks once they
confirm it — this form does not unlock it by itself"*, and the shop's says
*"check each transaction ID against your own account before confirming"*.

### The guards

- **The customer id comes from the session, never the body.** A customer login
  naming a different customer is ignored, and a plan belonging to somebody else
  is refused outright.
- **Cash is not submittable.** Cash changes hands at a counter; there is nothing
  to report from home and nothing anyone could check.
- **A transaction reference is mandatory**, and the existing unique index on
  (dealer, reference) stops the same transfer being reported twice.
- **Five open claims per customer.** More than that is not a queue, it is noise,
  and the message points them at the shop instead.
- **Screenshots are shrunk in the browser** before upload — scaled down and
  re-compressed until they fit — because the API's body limit is 256 KB and a
  phone screenshot is several megabytes. Discovering that from a server error,
  while standing somewhere with a locked phone, would be the wrong way round.

### Where a gateway attaches

`PaymentSource` already distinguishes `COUNTER`, `CUSTOMER` and `GATEWAY`. When
a processor is integrated, its webhook creates a payment with `source = GATEWAY`
and `autoVerify: true` — the processor *is* the verification — and reuses
`PaymentService.recordPayment` exactly as the other two paths do. Allocation,
late-fee handling, receipt numbering and auto-unlock do not change.

That is now built, for JazzCash hosted checkout, and is **off unless a
merchant account is configured** (see the gateway block in `server/.env.example`).
`services/gateway/` holds a small provider interface, the JazzCash
implementation, and `GatewayService`, which owns the rules every gateway shares:
a callback applies money only if its signature verifies, it names a checkout
this server created, and the merchant and amount match that checkout. The
checkout is marked `PAID` in the same transaction that records the payment, so a
replayed callback applies nothing. A signed "paid" that cannot be applied safely
(wrong amount, cancelled plan) is parked as `REVIEW` with an audit entry rather
than guessed at. The customer-reported flow above stays as the fallback.

The signing recipe has **not yet been run against the JazzCash sandbox** — do
that before switching `JAZZCASH_ENV` to `production`.

---

## 📨 SMS through a paired phone

There is no aggregator behind this system, and rather than let reminders sit in
the database looking as though they had been sent, a shop can pair a phone of
its own. The relay app on that handset asks for queued messages, sends them from
its SIM, and reports what happened to each one.

**Nothing is marked `SENT` until the phone says the SIM accepted it** — the same
rule the device lock follows, for the same reason. A customer whose phone gets
locked should have been warned, and the dashboard must not claim a warning that
never left the counter.

### How it hangs together

```
dashboard queues a reminder        →  QUEUED
counter phone polls /poll          →  claimed under a 3-minute lease
phone sends it from its SIM        →  waits for the platform's real result
phone reports /results             →  SENT, or back on the queue with a reason
```

The phone **pulls**; nothing is pushed to it. A handset on mobile data has no
address anyone can reach, so this is not a shortcut — it is the only arrangement
that works on a counter phone with a normal SIM.

The lease is what stops two polls being handed the same message. Claiming is a
compare-and-set, so a repeated or concurrent poll gets nothing rather than a
second copy of an overdue-payment text; and a phone that loses signal mid-batch
simply lets the lease expire instead of stranding the reminder.

### Pairing one

Notifications page → **Pair a phone**. The pairing code is transmitted once and
only its SHA-256 hash is kept, exactly as the DPC's device token is. Enter it in
the relay app, grant SMS permission, press start.

The dashboard's "delivery is working" banner reflects whether that handset has
actually checked in — not whether one exists in the database. A relay left
switched off in a drawer shows as *not checked in*.

### What this is not

A consumer SIM is not a delivery channel for a shop at volume. Bulk commercial
SMS in Pakistan needs an operator account and a PTA-approved sender mask, and a
reminder arriving from an unrecognised mobile number is a reminder customers
learn to ignore. This is the right tool for testing, and for a small shop
messaging its own customers; it is a stopgap, and the roadmap says so.

See [`android/README.md`](android/README.md) for the app itself.

### SMS through an aggregator

For volume and a sender mask customers recognise, the server can also send
through an SMS gateway account. It is off until `SMS_PROVIDER` is set in
`server/.env` — every value, including the gateway's own parameter names, is
documented in [`server/.env.example`](server/.env.example). Two providers ship:
a generic HTTP one that fits the usual Pakistani corporate/branded gateway (one
URL, credentials and mask as parameters), and Twilio.

Each shop then chooses, under **Settings → How SMS are sent**:

| Setting | What happens |
|---|---|
| Paired phone | As above. The default; nothing changes for a shop that does not choose otherwise. |
| SMS gateway | The server sends the queue through the gateway. A paired phone is handed nothing. |
| SMS gateway, then paired phone | The gateway is tried first; a message it gives up on is handed to the phone. |

The same honesty rule applies: **a message is `SENT` only when the gateway
answers that it accepted it.** A refusal, a timeout or an unreachable gateway
leaves it unsent with the reason recorded; it is retried after 1 min, 5 min,
30 min and 2 h (`SMS_MAX_ATTEMPTS`, default 4), then marked `FAILED` — or handed
to the phone. Many gateways answer HTTP 200 to a refusal, so a reply that reads
like an error is treated as one; set `SMS_HTTP_SUCCESS_PATTERN` from the
gateway's documentation to make that exact.

The worker and paired phones share one lock, the message's lease. Whoever holds
it owns the message, so the two can never both send the same reminder, and a
late report from a phone cannot put a sent message back on the queue.

Urdu script switches an SMS from 160 characters to 70 (67 per part when split).
The notifications page shows each message's real SMS count, and the gateway is
told when a message is Unicode (`SMS_HTTP_UNICODE_PARAMS`).

No real gateway account has been used yet: the providers are tested against a
mocked HTTP layer. The first live message should be sent to your own number.

---

## 🧪 Testing

```bash
npm --prefix server test                        # backend, against a real PostgreSQL
npm --prefix client test                        # React, in jsdom
cd android && ./gradlew testDebugUnitTest   # both handset apps, on the JVM
```

### Backend

Each run starts its own throwaway PostgreSQL cluster on port 5434 in the OS temp
directory (`server/tests/globalSetup.ts`) and applies the migrations to it, so it
never touches your development database. Nothing needs to be running first.

### Client

Vitest in jsdom, with Testing Library. The tests stub `fetch` rather than the
context or the API module, so the real provider logic — token restore, the 401
teardown, role derivation — stays under test rather than being mocked away.

The same command runs in CI on every push and pull request
(`.github/workflows/ci.yml`) — a real PostgreSQL there too, not a stub. The
workflow generates the Prisma client first, since `server/src/generated/` is not
committed, then typechecks, tests and builds both halves of the app.

| File | Covers |
|---|---|
| `tests/unit/installment-math.test.ts` | Schedule totals, end-of-month date arithmetic, late-fee accrual, caps, waivers |
| `tests/unit/payment-service.test.ts` | Allocation order, late fee before principal, advance credit, reversal, receipt numbering, auto-unlock |
| `tests/api/auth.test.ts` | Login, lockout, token forgery, expiry, privilege escalation via a forged role claim |
| `tests/api/tenant-isolation.test.ts` | Cross-dealer reads and writes, customer self-service scoping |
| `tests/api/rbac-and-masking.test.ts` | Role guards, PII redaction per role, pagination |
| `tests/api/lifecycle.test.ts` | Registration → six payments → completion, over HTTP |
| `tests/db/base-repository.test.ts` | CRUD, date-only columns, transaction rollback, database constraints |
| `tests/db/queries.test.ts` | Dealer scoping, relation searches, SQL aggregates, receipt numbering |
| `tests/api/dpc.test.ts` | Device credentials, rotation, revocation, the offline lock round trip, the Android provisioning QR |
| `tests/api/sms-relay.test.ts` | Pairing, the claim lease, sending the same message twice, cross-dealer isolation, retry and give-up, honest delivery reporting |
| `tests/api/contracts.test.ts` | Drafting with the sale, the frozen snapshot, signing, refusing to lock an unsigned or voided agreement, refusing after a genuine restructure through the reschedule endpoint, and *not* refusing when a customer has simply been paying |
| `tests/api/customer-payments.test.ts` | A reported transfer stays unverified and moves no money, applies on confirmation, cannot name another customer's plan, and the queue's scoping and limits |
| `tests/api/offline-rule.test.ts` | Who is permitted to restrict themselves and who is refused — no limit, manual locking, an unsigned, voided or pre-v1.1 agreement — the limit never shortening below the signed figure, a self-lock recorded without becoming `LOCKED`, and the clause printed in both languages |
| `tests/api/disclosure-gating.test.ts` | Terms v1.4: hardware checks, the tamper lock and reset protection printed in both languages; a customer on v1.3 is neither tamper-locked, attested, nor sent the shop's account, and their signals are not stored; v1.3 still renders as signed; emergency calls cannot be switched off |
| `tests/api/contract-pdf.test.ts` | The PDF endpoint's access rules (no session, own shop, own customer, another customer, another dealership) checked before anything renders; what the document carries; escaping; and a real Chromium render where one is installed |
| `tests/api/licenses.test.ts` | A lock is spent once at enrolment and stamped with the IMEI, re-enrolment spends nothing, a paid-off device never returns its lock, running out stops the counter but leaves the QR valid, and only the platform can mint stock |
| `tests/unit/pack-pricing.test.ts` | The price per lock at each tier, for any number from 1 to 500 |
| `tests/api/staged-restrictions.test.ts`, `tests/unit/staged-restrictions.test.ts` | Which level a phone is at, that it is 0 without the policy, a valid contract and v1.2 terms all agreeing, and the engine locking only at the third or final missed installment |
| `tests/api/re-enroll.test.ts` | A wiped phone gets a new QR on the lock it already holds, its old credential stops working, and only that dealer's admin can do it |
| `tests/api/release.test.ts` | The last payment releases the phone, a manual release needs a reason, and a released phone is answered "no longer under management" |
| `tests/api/no-lock-sales.test.ts` | A sale without a lock spends nothing, gets no QR and cannot be locked |
| `tests/api/location.test.ts` | Who may be located and who is refused, the 24-hour request, an unrequested fix being dropped, coordinates absent from ordinary responses, and deletion on release — the server half only |
| `tests/api/security-hardening.test.ts` | IMEI and device-owner checks at enrolment and check-in, the tamper flags, and clearing an alert |
| `tests/api/hardware-attestation.test.ts` | Attestation chains verified against a test root: a matching chip IMEI, a mismatch, an unlocked bootloader, a forged and a revoked chain, the challenge, and serial pinning |
| `tests/api/frp.test.ts` | The FRP status a handset reports reaching the dashboard, and the Google ID rules |
| `tests/api/platform.test.ts` | The super admin's overview: access, shops awaiting payment, revenue and fleet counts |
| `tests/api/admin-guards.test.ts`, `tests/api/super-admin-bootstrap.test.ts` | Admin-only actions refusing everyone else; creating the first super admin from the server shell |
| `tests/db/connection.test.ts` | The database is UTF-8, so an Urdu name can be stored at all |

**Client** (`client/src/**/*.test.ts(x)`)

| File | Covers |
|---|---|
| `components/auth/RouteGuards.test.tsx` | Session gate, the change-password redirect, per-role page and button access |
| `components/dashboard/CollectionQueue.test.ts` | Collapsing a customer's arrears into one call, worst-first ordering, and surfacing the locked handset |
| `utils/format.test.ts` | Rupee formatting, lakh/crore shorthand, the overdue wording, and "last contact" reading Never rather than a guess |
| `context/AuthContext.test.tsx` | Token restore, login, logout, dealer switching, the 401 teardown |
| `services/api.test.ts` | Auth header, query building, error mapping, why a failed sign-in is not an expired session |
| `utils/csv.test.ts` | Quoting, the UTF-8 BOM, spreadsheet formula injection |
| `hooks/usePagination.test.ts` | Page reset on filter and page-size change |
| `i18n/translate.test.ts` | The Roman Urdu switch: known lines swap, unknown ones stay English, numbers in patterns survive |
| `components/layout/navItems.test.ts` | The platform menu against a shop's menu, and no simulator entry |
| `pages/RegisterPage.test.ts`, `pages/PlatformDashboardPage.test.ts`, `pages/EnrollmentPage.test.ts` | Sign-up form checks and pack prices, the WhatsApp number format, the QR payload |
| `components/modals/GoogleIdGuideModal.test.tsx` | The Google ID guide renders in both languages |
| `utils/phoneSupport.test.ts`, `utils/saleValidation.test.ts` | Which phones can be locked, and which field of a sale is wrong |

**Android DPC** (`android/dpc/src/test/`)

| File | Covers |
|---|---|
| `PolicyViewTest.kt` | Parsing the policy a lock screen renders — a JSON null must not become the word "null" in front of a customer, an absent `emergencyCallsAllowed` means permitted, and a command the app cannot carry out is rejected rather than acknowledged |
| `OfflineLockRuleTest.kt` | The only decision the app makes without asking anybody: locking after the limit when money is genuinely late, and *not* locking a paid-up phone however long it stays silent, before the grace period is out, on a limit of zero, on a handset that never reported, or on a clock moved backwards |
| `DpcApiEndpointTest.kt` | Joining the base URL from the QR to an endpoint. Getting this wrong produces a phone that provisions cleanly and never checks in again |
| `StagedRestrictionsTest.kt` | From a level to the restrictions and app suspensions to add or remove |
| `FactoryResetProtectionTest.kt` | Which FRP call is due, the Android 10→11 route change, and whether the policy read back matches what was asked |
| `DeviceIntegrityTest.kt`, `TelemetrySerializationTest.kt` | IMEI normalising, the bootloader and test-keys signals, and what a check-in actually serialises |
| `AttestationChallengeTest.kt` | The enrolment challenge, against the same vector the server tests use |

**Android SMS relay** (`android/sms-relay/src/test/`)

| File | Covers |
|---|---|
| `RelayApiEndpointTest.kt` | The same join, for an address a shopkeeper types by hand on a counter phone |

The Android counts come from the test sources (48 `@Test` in the DPC, 2 in the
relay); CI runs them on every push. The platform calls themselves — the kiosk,
FRP, attestation, location — cannot be exercised on the JVM and are covered by
no automated test.

These made the PostgreSQL cutover safe. The storage engine was replaced entirely
and the behavioural assertions did not change — the same tests that passed against
the JSON store pass against PostgreSQL.

---

## 🐘 PostgreSQL migration

The migration is **complete**. The application reads and writes PostgreSQL exclusively.

### What exists and works

| Piece | File | State |
|---|---|---|
| Prisma schema — 18 tables, 20 enums | `prisma/schema.prisma` | ✅ |
| Versioned SQL migrations — the initial one and 14 since | `prisma/migrations/` | ✅ applied on start |
| Prisma client + pooling + transaction helper | `src/db/prisma.ts` | ✅ |
| Data import from the legacy JSON store | `scripts/import-store-json.ts` | ✅ kept for one-off migration of an existing install |
| Local PostgreSQL with nothing to install | `scripts/pg-server.ts` | ✅ |
| Repository layer over Prisma | `src/db/repositories/` | ✅ |
| Demo dataset loaded straight into PostgreSQL | `src/db/seedPostgres.ts` | ✅ |

Design decisions baked into the schema:

- **Money is `Int`** (whole rupees). The app already rounds to whole rupees; integers remove any chance of floating-point drift on balances.
- **Real date types.** Due dates and grace dates are `DATE`; everything else is `TIMESTAMPTZ`. The repository layer converts back to the ISO strings the app already uses, so domain logic does not have to be rewritten around `Date` objects.
- **Constraints the old JSON store could not enforce:** unique IMEI, unique `(dealer, CNIC)`, unique `(dealer, payment reference)` — that last one stops a double-submit at the counter at the database level, not just in application code.
- **No cascade deletes on financial or audit rows.** Removing a customer must never silently take their payment history with it.

### Running it

```bash
npm run db:dev      # starts a real PostgreSQL on :5433 — leave it running
npm run db:deploy   # applies migrations
npm run db:seed     # loads the demo dataset
npm run db:import   # optional: migrate a legacy server/data/store.json (idempotent)
npm run db:studio   # browse the data
```

`npm run db:dev` runs **PostgreSQL 17** from the `embedded-postgres` package, which ships the genuine server binaries. No installer, no admin rights, no Docker, no Windows service. The cluster lives in `~/.emishield/pgdata` — deliberately outside the OneDrive-synced project folder, because cloud sync rewriting files underneath a running server corrupts it. Production points `DATABASE_URL` at any PostgreSQL server — the compose file in `deploy/` runs PostgreSQL 16 in a container beside the API; no application code changes.

> **Why not PGlite.** PGlite — PostgreSQL compiled to WebAssembly — was the original choice here and was dropped. Against its socket server, the query following *any* Prisma interactive transaction, **including one that committed cleanly**, came back desynchronised by one protocol message and failed. Non-transactional errors were unaffected, and the behaviour was independent of pool size and `maxConnections` on the current 0.5.5 / 0.2.8. Putting payment allocation inside a real transaction is the point of this migration, so the development database has to support them.

Both clusters are created with `--encoding=UTF8 --locale=C`. Without it `initdb` inherits the Windows host locale and builds a **WIN1252** database, which cannot store an Urdu customer name at all; `tests/db/connection.test.ts` asserts the encoding so this cannot regress unnoticed.

### What the cutover changed

The JSON store is gone — `src/db/db.ts` was deleted. Beyond swapping the storage engine:

- **Real transactions.** Payment allocation, customer registration, dealer sign-up, device lock/unlock, late-fee waivers and plan restructuring each commit as a unit. `db.batch` had no rollback, so a failure part-way through registration could leave a customer holding a financed device with no repayment schedule.
- **Work moved into SQL.** Filtering, sorting, pagination, counts and sums are executed by the database. The dashboard previously loaded every device, plan, payment and installment into memory and reduced them in JavaScript.
- **Concurrency the store could not express.** Duplicate payment references and duplicate CNICs are stopped by unique indexes rather than by a read-then-write check; enrollment tokens are claimed with a compare-and-set so two scans of one QR cannot both win; receipt numbers come from the highest issued rather than a row count, which handed concurrent payments the same number.

Two operations deliberately run *after* their transaction commits, because they open transactions of their own and Prisma has no nested interactive transactions — the auto-unlock following a settling payment, and the enrollment QR issued after registration. Both orderings are also the correct ones: a phone should only be released once the money is durably recorded, and a QR should not exist for a device the registration failed to write.

---

## 🗺️ Roadmap

1. **Run the DPC on real handsets.** The app is written, signed and published ([`android/dpc/`](android/dpc/README.md)); the current release is `dpc-v1.5.1` (`almas-sdm-dpc-v1.5.1.apk`), and its release notes carry the two lines of server configuration — `DPC_APK_URL` and `DPC_APK_SIGNATURE_CHECKSUM`. See [android/RELEASE.md](android/RELEASE.md). What is missing is a recorded pass across the Android versions and OEM skins a Pakistani shop actually sells: provisioning by QR from a factory-reset handset, the kiosk lock under each vendor's skin, boot restore, and now also FRP after a recovery wipe, staged restrictions, release on payoff and whether each phone's secure chip attests its IMEI. The signing key can only be created once and cannot be rotated — an APK signed with a different key will not update an installed one, and those handsets are device owner, so the customer cannot factory-reset out of a bad build.
2. **Release DPC 1.5.2 and prove location for recovery on a phone.** The heartbeat now answers `reportLocation` in the source ([above](#location-for-recovery)); tag `dpc-v1.5.2`, point the server at the new APK, and try it on a locked phone before telling a shop the feature works.
3. **An SMS aggregator account** (Jazz / Telenor / Zong corporate, or Twilio) with a PTA-approved sender mask. The channel is built ([SMS through an aggregator](#sms-through-an-aggregator)); what is missing is the account, and a first real send through it.
4. **A JazzCash merchant account, and a sandbox run.** The hosted checkout is built ([Where a gateway attaches](#where-a-gateway-attaches)); the blocker is a merchant account, which needs business registration and a bank account, and then proving the signature against the JazzCash sandbox before production.
5. **Deeper client coverage** — guards, auth, the API client, CSV export and pagination are tested, and so are the money and lock screens: the financed-sale wizard, payments (record, verify, reverse, customer-reported transfers), lock / unlock / release, contract signing, enrolment QR, licences, settings and the Roman Urdu switch (`client/src/test/harness.tsx` is the shared page-test setup). Still untested: the dashboard, customers, notifications, audit log and platform pages. Rescheduling a plan and waiving a late fee exist in the API client but have no screen yet.
6. **Legal review of the contract terms** — the agreement is written, bilingual, signed and enforced ([Consent](#-consent-the-contract-a-lock-rests-on)), but it was drafted by engineers. A Pakistani lawyer should read it before a shop relies on it — clause 4, and within it the paragraph (from terms v1.1) that permits a handset to restrict itself when it cannot reach the shop, is what to put in front of them first. The brief to hand over is [docs/legal-review-brief.md](docs/legal-review-brief.md).
7. PWA offline mode.
8. **Operating the hosted server.** It runs; what a README cannot show is whether the nightly backup has been restored somewhere once, and whether the dumps leave the machine. [deploy/DEPLOY.md](deploy/DEPLOY.md) says how.
