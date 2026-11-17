-- Read-only preflight before the 20261117000000 migration.
-- Any duplicate receipt group requires manual reconciliation; do not renumber issued receipts blindly.
SELECT dealer_id, receipt_number, COUNT(*) AS duplicates
FROM payments WHERE receipt_number IS NOT NULL
GROUP BY dealer_id, receipt_number HAVING COUNT(*) > 1;

-- Historical payments lack a recoverable allocation footprint. Their reversal is intentionally blocked.
SELECT id, dealer_id, plan_id, amount, receipt_number
FROM payments WHERE status = 'VERIFIED' AND allocation_json IS NULL;

-- Compare principal obligations with the schedule after prior reschedules.
SELECT p.id, p.financed_amount, COALESCE(SUM(i.amount_due),0) AS schedule_principal,
       p.remaining_balance, COALESCE(SUM(i.amount_due-i.amount_paid),0) AS schedule_remaining
FROM installment_plans p LEFT JOIN installments i ON i.plan_id=p.id
GROUP BY p.id HAVING p.financed_amount <> COALESCE(SUM(i.amount_due),0)
OR p.remaining_balance <> COALESCE(SUM(i.amount_due-i.amount_paid),0);
