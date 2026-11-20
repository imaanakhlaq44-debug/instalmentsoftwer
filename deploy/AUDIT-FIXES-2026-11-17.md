# Audit fixes — release notes (17 November 2026)

Apply after a verified backup and a successful restore rehearsal. Deployed to https://app.almassdm.pro on 17 November 2026 after an isolated PostgreSQL 16 restore, staging checks and rollback preparation. Actual physical-handset acceptance remains pending; no handset was reset, updated or locked during this deployment.

## Database migration

Migration `20261117000000_audit_financial_security` adds user session versions, payment allocation history, and unique receipt numbers per dealer. Run the duplicate-receipt query in `deploy/one-off/audit-financial-reconciliation.sql` before migration (the remaining queries require the new allocation column). Reconcile any duplicate groups before applying the uniqueness index. Do not delete financial records or silently renumber receipts already issued.

Use the usual `npm run db:deploy` in server after preflight. Do not use schema push against production. Generate the Prisma client during build. A failed migration must be resolved through the deployment runbook before API restart.

## Historical financial data

New payments persist their exact principal/fee allocation and credit delta. Reversal uses this footprint. Historical verified payments have no reliable footprint; reversal returns a clear conflict requiring reconciliation rather than guessing which installments to debit. Consumed overpayment credit requires reversing later dependent payments first.

The reconciliation SQL flags old schedule/remaining-balance discrepancies. Review against receipts/contracts before any correction. This release does not fabricate missing historical allocations or automatically repair customer balances.

Cash totals now count receipt cash and reversal cash, excluding allocation classifications from extra inflow. Reversed original receipts remain part of cash history so the contra-entry nets to zero.

## Sessions

Password changes and admin resets revoke earlier tokens. Password-change responses return a replacement session, which the dashboard stores. Logout revokes all sessions of that account. Existing tokens remain valid only while the stored session version is zero; accounts changing/resetting passwords or signing out invalidate them.

## Concurrency and capacity

Multi-record transactions take a PostgreSQL transaction advisory lock before reading. This deliberately serializes mutations across API workers, providing a conservative correctness boundary for payment verification and receipt allocation. It can limit write throughput; measure on the intended fleet before increasing traffic. Do not remove the lock without replacing it with tested resource-level locking and retry handling.

## Enforcement and deployment

Dealer-triggered overdue evaluation is dealer-scoped. Nightly dates use Asia/Karachi; database sessions use UTC so SQL leases and retry windows remain consistent. Already-overdue installments retry enforcement. Fleet requests have a separate rate budget. Android normal check-ins now answer recovery location requests. FTPS failures stop deployment; plaintext FTP fallback is removed.

Backups check pg_dump independently, compress a private temporary dump, validate gzip, and publish only after all steps succeed. Perform an actual isolated PostgreSQL restore before relying on the backup in production.

## Remaining physical/operational checks

Verify factory-reset provisioning, emergency dialing, lock/unlock, reboot, offline behavior, recovery location, APK updates and final release on each supported Android/OEM. Verify production restore, secure upload, NAT fleet capacity and live SMS behavior. Unit tests and builds cannot establish these hardware/operational outcomes.
