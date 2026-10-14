-- =====================================================================
-- Verify migration 20261012100000_lockdown_followup.sql
-- Read-only. Run it any time AFTER the migration and paste the result back.
-- "all_checks_passed": true means the follow-up is fully in place.
-- (The migration itself also ran the real-user check, acting as each real
-- login; that check needs no repeating here.)
-- If it stops with "function private.lockdown_followup_checks() does not
-- exist", the migration has not been run.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'all_checks_passed', bool_and(c.ok),
  'checks', jsonb_object_agg(c.check_name, c.ok),
  'failed', coalesce(jsonb_agg(jsonb_build_object('check', c.check_name, 'detail', c.detail)) filter (where c.ok is not true), '[]'::jsonb)
))
from private.lockdown_followup_checks() c;
