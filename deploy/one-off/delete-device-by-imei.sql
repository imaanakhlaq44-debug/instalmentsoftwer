-- Permanently removes ONE phone (by IMEI) and everything recorded against it:
-- its plan, installments, payments, ledger entries, contract, QR tokens,
-- notifications and action log. Its customer is removed too, but only when
-- that customer has no other phone on record.
--
-- The lock already spent on this phone is NOT returned (device_licenses is left
-- as it is), so registering the phone again spends a new lock.
--
-- Run a backup first. Usage on the server:
--   cd /opt/almas-sdm && ./deploy/backup.sh
--   docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
--     exec -T db psql -U almas -d almas_sdm -v imei=869025047492217 -v confirm=no < deploy/one-off/delete-device-by-imei.sql
-- confirm=no  → shows what would be deleted, then rolls back (nothing changes)
-- confirm=yes → deletes for real

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t_dev  ON COMMIT DROP AS SELECT id, customer_id FROM devices WHERE imei = :'imei';
CREATE TEMP TABLE t_plan ON COMMIT DROP AS SELECT id FROM installment_plans WHERE device_id IN (SELECT id FROM t_dev);
CREATE TEMP TABLE t_pay  ON COMMIT DROP AS SELECT id FROM payments WHERE plan_id IN (SELECT id FROM t_plan);
-- The customer goes only if this was their one and only phone.
CREATE TEMP TABLE t_cust ON COMMIT DROP AS
  SELECT DISTINCT d.customer_id AS id FROM t_dev d
  WHERE NOT EXISTS (SELECT 1 FROM devices o WHERE o.customer_id = d.customer_id AND o.imei <> :'imei');

\echo '--- What will be deleted ---'
SELECT d.id AS device_id, d.brand, d.model, d.status, c.name AS customer, p.status AS plan_status, p.remaining_balance
FROM devices d
JOIN customers c ON c.id = d.customer_id
LEFT JOIN installment_plans p ON p.device_id = d.id
WHERE d.imei = :'imei';
SELECT
  (SELECT count(*) FROM t_dev)  AS devices,
  (SELECT count(*) FROM t_plan) AS plans,
  (SELECT count(*) FROM installments WHERE plan_id IN (SELECT id FROM t_plan)) AS installments,
  (SELECT count(*) FROM t_pay)  AS payments,
  (SELECT count(*) FROM transactions WHERE plan_id IN (SELECT id FROM t_plan) OR payment_id IN (SELECT id FROM t_pay)) AS ledger_entries,
  (SELECT count(*) FROM t_cust) AS customers_removed_too;

-- Children first; installments go with their plan, contracts and action logs with the device (ON DELETE CASCADE).
DELETE FROM transactions      WHERE plan_id IN (SELECT id FROM t_plan) OR payment_id IN (SELECT id FROM t_pay);
DELETE FROM payments          WHERE id IN (SELECT id FROM t_pay);
DELETE FROM contracts         WHERE device_id IN (SELECT id FROM t_dev);
DELETE FROM installment_plans WHERE id IN (SELECT id FROM t_plan);
DELETE FROM enrollment_tokens WHERE device_id IN (SELECT id FROM t_dev);
DELETE FROM notifications     WHERE device_id IN (SELECT id FROM t_dev);
DELETE FROM devices           WHERE id IN (SELECT id FROM t_dev);

-- The customer, when this was their only phone.
DELETE FROM transactions      WHERE customer_id IN (SELECT id FROM t_cust);
DELETE FROM payments          WHERE customer_id IN (SELECT id FROM t_cust);
DELETE FROM installments      WHERE customer_id IN (SELECT id FROM t_cust);
DELETE FROM enrollment_tokens WHERE customer_id IN (SELECT id FROM t_cust);
DELETE FROM notifications     WHERE customer_id IN (SELECT id FROM t_cust);
UPDATE users SET customer_id = NULL WHERE customer_id IN (SELECT id FROM t_cust);
DELETE FROM customers         WHERE id IN (SELECT id FROM t_cust);

\if :{?confirm}
\else
  \set confirm no
\endif
SELECT (:'confirm' = 'yes') AS do_commit \gset
\if :do_commit
  COMMIT;
  \echo '--- DELETED ---'
\else
  ROLLBACK;
  \echo '--- Preview only: nothing was changed. Run again with -v confirm=yes to delete. ---'
\endif
