-- Measured (docs/operations/performance.md): the (action, created_at) index added in 20261118090000 is never chosen. The audit
-- viewer filters actions by prefix with OR and orders by time, which the created_at index already serves. An unused index only
-- slows every audit write, so it is removed.
DROP INDEX "audit_logs_action_created_at_idx";
