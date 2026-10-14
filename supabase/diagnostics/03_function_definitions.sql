-- =====================================================================
-- VapeTrax live DB check 3 of 4: FUNCTION DEFINITIONS
-- Read-only: this query changes nothing.
--
-- How to run:
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Click the single result cell, copy its JSON and paste it back to Claude
--
-- Shows: the full source code of every function in the public schema
-- (process_checkout, process_reversal, process_stock_adjustment, and any
-- others), so we know exactly which version is live.
-- =====================================================================
select jsonb_pretty(coalesce(jsonb_agg(jsonb_build_object(
  'name', p.proname,
  'args', pg_get_function_identity_arguments(p.oid),
  'definition', pg_get_functiondef(p.oid)
) order by p.proname), '[]'::jsonb))
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
