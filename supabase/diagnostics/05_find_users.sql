-- =====================================================================
-- VapeTrax: list every login account and what it is linked to.
-- Read-only: this query changes nothing.
--
-- How to run: SQL Editor -> New query -> paste this file -> Run ->
-- copy the single result cell and paste it back to Claude.
-- =====================================================================
select jsonb_pretty(jsonb_agg(jsonb_build_object(
  'email', u.email,
  'user_id', u.id,
  'created_at', u.created_at,
  'last_sign_in_at', u.last_sign_in_at,
  'email_confirmed', u.email_confirmed_at is not null,
  'profile_role', p.role,
  'member_of_shop', p."shopId",
  'is_MAIN_shop_account',
     u.id = 'c7587ec2-753c-4767-a9f3-8bcf6b30e685'::uuid
     or p."shopId" = 'c7587ec2-753c-4767-a9f3-8bcf6b30e685'::uuid,
  'data_owned_as_shop', jsonb_build_object(
     'products',          (select count(*) from public.products x          where x."shopId" = u.id),
     'sales',             (select count(*) from public.sales x             where x."shopId" = u.id),
     'customers',         (select count(*) from public.customers x         where x."shopId" = u.id),
     'bottles',           (select count(*) from public.bottles x           where x."shopId" = u.id),
     'inventory_logs',    (select count(*) from public.inventory_logs x    where x."shopId" = u.id),
     'credits',           (select count(*) from public.credits x           where x."shopId" = u.id),
     'expenses',          (select count(*) from public.expenses x          where x."shopId" = u.id),
     'personal_expenses', (select count(*) from public.personal_expenses x where x."shopId" = u.id),
     'settings',          (select count(*) from public.settings x          where x."shopId" = u.id),
     'cashiers_in_shop',  (select count(*) from public.profiles x          where x."shopId" = u.id and x.id <> u.id)
  )
) order by u.created_at))
from auth.users u
left join public.profiles p on p.id = u.id;
