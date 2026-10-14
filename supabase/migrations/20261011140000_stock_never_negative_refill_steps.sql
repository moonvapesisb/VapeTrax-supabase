-- =====================================================================
-- 20261011140000_stock_never_negative_refill_steps.sql
-- PHASE 0 (step 0.8): the owner's stock and refill rules.
--
--   1. Stock can NEVER go below zero, whatever screen, device or bug tries:
--      - any negative stock / bottle ml left from the past is reset to 0
--        and logged ("please recount");
--      - database CHECK rules refuse negative stock and negative bottle ml;
--      - process_checkout never deducts below zero. The POS blocks short
--        sales at the counter; a sale that still arrives short (offline, or
--        two devices at once) is kept, stock stops at 0, and a "shortfall -
--        please recount" log entry and alert are written.
--   2. Refills are sold only in 0.5 ml steps (0.5, 1, 1.5, ...). Quantities
--      of every sale line must be whole numbers.
--   3. process_reversal refuses negative "restore" amounts.
--
-- Requires 20261011120000_emergency_security_lockdown.sql (already applied).
-- Safe to run more than once. One transaction: all or nothing.
--
-- BEFORE RUNNING:
--   1. Deploy the matching app version first.
--   2. On EVERY phone/PC that runs VapeTrax, fully close and reopen the app
--      (or reload the page twice) and check the refill window shows the new
--      - / + 0.5 ml buttons. Old open tabs would keep the old refill box.
--   3. On each of those devices, check the sync panel (bottom right) shows
--      no sales waiting to sync.
-- How to run: SQL Editor -> New query -> paste this whole file -> Run.
-- Then run supabase/diagnostics/verify_20261011140000.sql.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Repair: reset any negative stock to 0, with an audit log entry
-- ---------------------------------------------------------------------
insert into public.inventory_logs (
  id, "shopId", "productId", "productName", type, action, change,
  "quantityChange", "previousStock", "newStock", reason, notes,
  "actorName", "actorRole", "createdAtClient", "createdAt"
)
select
  gen_random_uuid()::text, p."shopId", p.id, p.name, 'correction', 'correction',
  -p."stockQuantity", -p."stockQuantity", p."stockQuantity", 0,
  'Automatic correction: stock was below zero',
  'Stock reset to 0 by the never-negative rule. Please recount this product.',
  'System', 'system',
  to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now()
from public.products p
where p."stockQuantity" < 0;

update public.products
   set "stockQuantity" = 0, "updatedAt" = now()
 where "stockQuantity" < 0;

update public.bottles
   set "remainingMl" = 0, status = 'empty', "updatedAt" = now()
 where "remainingMl" < 0;

-- ---------------------------------------------------------------------
-- 2. Database rules: stock and bottle ml can never be negative
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'products_stock_not_negative'
                   and conrelid = 'public.products'::regclass) then
    alter table public.products
      add constraint products_stock_not_negative check ("stockQuantity" >= 0);
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'bottles_remaining_not_negative'
                   and conrelid = 'public.bottles'::regclass) then
    alter table public.bottles
      add constraint bottles_remaining_not_negative check ("remainingMl" >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2b. Shortfall alerts: make sure product_id is text (products use text
--     ids), and let shop members read their alerts and mark them resolved
--     (the Stock page shows them). Insert/delete stay server-only.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'inventory_alerts'
               and column_name = 'product_id' and data_type = 'uuid') then
    alter table public.inventory_alerts alter column product_id type text using product_id::text;
  end if;
end $$;

grant select on public.inventory_alerts to authenticated;
grant update (resolved, resolved_at) on public.inventory_alerts to authenticated;

-- ---------------------------------------------------------------------
-- 3. process_checkout: same signature; adds the stock and refill rules
-- ---------------------------------------------------------------------
create or replace function public.process_checkout(
  p_shop_id text,
  p_sale_data jsonb,
  p_product_updates jsonb,
  p_bottle_updates jsonb,
  p_inventory_logs jsonb,
  p_customer_id text default null,
  p_credit_increment numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop      uuid;
  v_item      jsonb;
  v_prod      jsonb;
  v_bot       jsonb;
  v_log       jsonb;
  v_qty       numeric;
  v_ml        numeric;
  v_deduction numeric;
  v_name      text;
  v_category  text;
  v_stock     numeric;
  v_unit      text;
begin
  begin
    v_shop := p_shop_id::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid shop id' using errcode = '22023';
  end;

  if not private.is_shop_member(v_shop) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_sale_data is null or coalesce(p_sale_data->>'id', '') = '' then
    raise exception 'Sale id is required' using errcode = '22023';
  end if;

  -- 1. Insert the sale. A retry of a sale that was already saved stops here,
  --    so stock and credit are never applied twice.
  insert into public.sales (
    id, "shopId", "customerId", items, "totalAmount", "paymentMethod",
    "splitAmounts", "saleDate", "saleDateClient", "actorName", "actorRole",
    "totalCOGS", "totalProfit", "createdAt", "updatedAt"
  )
  values (
    p_sale_data->>'id',
    v_shop,
    nullif(trim(coalesce(p_sale_data->>'customerId', '')), ''),
    p_sale_data->'items',
    (p_sale_data->>'totalAmount')::numeric,
    p_sale_data->>'paymentMethod',
    p_sale_data->'splitAmounts',
    coalesce((p_sale_data->>'saleDate')::timestamptz, now()),
    p_sale_data->>'saleDateClient',
    p_sale_data->>'actorName',
    p_sale_data->>'actorRole',
    (p_sale_data->>'totalCOGS')::numeric,
    (p_sale_data->>'totalProfit')::numeric,
    coalesce((p_sale_data->>'createdAt')::timestamptz, now()),
    now()
  )
  on conflict (id) do nothing;

  if not found then
    return;
  end if;

  -- 2. Sale lines: whole-number quantities; refills only in 0.5 ml steps.
  --    (Checked after the insert so an already-saved sale replays as a no-op;
  --    an error here rolls the insert back too.)
  for v_item in select * from jsonb_array_elements(coalesce(p_sale_data->'items', '[]'::jsonb))
  loop
    v_qty := (v_item->>'quantity')::numeric;
    -- (">= 100000" also rejects NaN and Infinity, which pass the other tests)
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) or v_qty >= 100000 then
      raise exception 'Quantity for "%" must be a whole number above zero (got %).',
        coalesce(v_item->>'productName', '?'), coalesce(v_item->>'quantity', 'nothing')
        using errcode = '22023';
    end if;
    if v_item->>'saleType' = 'refill' then
      v_ml := (v_item->>'refillAmount')::numeric;
      if v_ml is null or v_ml <= 0 or (v_ml * 2) <> trunc(v_ml * 2) or v_ml >= 100000 then
        raise exception 'Refill for "%" must be in 0.5 ml steps (0.5, 1, 1.5 ...), not % ml.',
          coalesce(v_item->>'productName', '?'), coalesce(v_item->>'refillAmount', 'nothing')
          using errcode = '22023';
      end if;
    end if;
  end loop;

  -- 3. Stock deductions: only this shop's products, and NEVER below zero.
  --    The POS blocks sales at the counter when stock is short. If a sale
  --    still arrives short (made offline, or two devices sold the last unit
  --    at the same moment), the goods have already left the shop: the sale
  --    is kept, stock stops at 0, and a "shortfall - please recount" log and
  --    alert are written for the owner.
  for v_prod in select * from jsonb_array_elements(coalesce(p_product_updates, '[]'::jsonb))
  loop
    v_deduction := coalesce((v_prod->>'deduction')::numeric, 0);
    if v_deduction < 0 or v_deduction >= 1000000 then
      raise exception 'Invalid stock deduction (%).', v_deduction using errcode = '22023';
    end if;

    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) - v_deduction,
           "updatedAt"     = now()
     where id = v_prod->>'id'
       and "shopId" = v_shop
       and coalesce("stockQuantity", 0) >= v_deduction;

    if not found then
      select p.name, p.category, coalesce(p."stockQuantity", 0)
        into v_name, v_category, v_stock
        from public.products p
       where p.id = v_prod->>'id' and p."shopId" = v_shop
       for update;
      if found and v_stock >= v_deduction then
        -- A restock committed in between (we waited for its lock): normal deduction.
        update public.products
           set "stockQuantity" = v_stock - v_deduction, "updatedAt" = now()
         where id = v_prod->>'id' and "shopId" = v_shop;
      elsif found then
        v_unit := case when v_category = 'e-liquid' then 'ml' else 'pcs' end;

        update public.products
           set "stockQuantity" = 0, "updatedAt" = now()
         where id = v_prod->>'id' and "shopId" = v_shop;

        insert into public.inventory_logs (
          id, "shopId", "productId", "productName", type, action, change,
          "quantityChange", "previousStock", "newStock", reason, notes,
          "actorName", "actorRole", "createdAtClient", "createdAt", "createdBy"
        )
        values (
          gen_random_uuid()::text, v_shop, v_prod->>'id', v_name, 'correction', 'shortfall',
          -v_stock, -v_stock, v_stock, 0,
          format('Stock shortfall on sale %s: sold %s %s but only %s %s was in stock',
                 right(p_sale_data->>'id', 6), v_deduction, v_unit, v_stock, v_unit),
          'Stock stopped at 0 (it can never go below zero). Please recount this product.',
          'System', 'system',
          to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now(),
          auth.uid()::text
        );

        -- Best effort: the alert must never be the reason a sale is lost.
        begin
          insert into public.inventory_alerts (shop_id, product_id, product_name, message)
          values (
            v_shop, v_prod->>'id', v_name,
            format('Shortfall: sold %s %s but only %s %s was in stock. Please recount.',
                   v_deduction, v_unit, v_stock, v_unit)
          );
        exception when others then
          raise warning 'Shortfall alert not written: %', sqlerrm;
        end;
      end if;
      -- Product no longer exists in this shop (deleted): nothing to deduct.
    end if;
  end loop;

  -- 4. Bottle upserts: new bottles go into this shop; existing bottles are
  --    updated only if they belong to this shop. (ml >= 0 is a table rule.)
  for v_bot in select * from jsonb_array_elements(coalesce(p_bottle_updates, '[]'::jsonb))
  loop
    insert into public.bottles as b (
      id, "productId", "shopId", "bottleSize", "remainingMl", status,
      "openedDate", "createdAt", "updatedAt"
    )
    values (
      v_bot->>'id',
      v_bot->>'productId',
      v_shop,
      (v_bot->>'bottleSize')::numeric,
      (v_bot->>'remainingMl')::numeric,
      v_bot->>'status',
      nullif(trim(coalesce(v_bot->>'openedDate', '')), '')::timestamptz,
      now(),
      now()
    )
    on conflict (id) do update set
      "remainingMl" = excluded."remainingMl",
      status        = excluded.status,
      "openedDate"  = coalesce(excluded."openedDate", b."openedDate"),
      "updatedAt"   = now()
    where b."shopId" = excluded."shopId";
  end loop;

  -- 5. Inventory logs: always under this shop, with the real user id
  for v_log in select * from jsonb_array_elements(coalesce(p_inventory_logs, '[]'::jsonb))
  loop
    insert into public.inventory_logs (
      id, "productId", "productName", "shopId", action, type, change,
      "quantityChange", "mlChange", "newStock", reason, notes,
      "actorName", "actorRole", "createdAtClient", "createdAt", "createdBy"
    )
    values (
      v_log->>'id',
      v_log->>'productId',
      v_log->>'productName',
      v_shop,
      v_log->>'action',
      v_log->>'type',
      (v_log->>'change')::numeric,
      (v_log->>'quantityChange')::numeric,
      nullif(v_log->>'mlChange', '')::numeric,
      nullif(v_log->>'newStock', '')::numeric,
      v_log->>'reason',
      v_log->>'notes',
      v_log->>'actorName',
      v_log->>'actorRole',
      v_log->>'createdAtClient',
      coalesce((v_log->>'createdAt')::timestamptz, now()),
      auth.uid()::text
    )
    on conflict (id) do nothing;
  end loop;

  -- 6. Customer credit (udhaar): only this shop's customer
  if p_customer_id is not null
     and trim(p_customer_id) <> ''
     and coalesce(p_credit_increment, 0) > 0
  then
    update public.customers
       set "creditBalance" = coalesce("creditBalance", 0) + p_credit_increment,
           "updatedAt"     = now()
     where id = p_customer_id
       and "shopId" = v_shop;
  end if;
end;
$$;

revoke all on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) from public;
revoke all on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) from anon;
grant execute on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 4. process_reversal: same as 20261011120000, plus: restore amounts can
--    never be negative (a negative "restore" would reduce stock)
-- ---------------------------------------------------------------------
create or replace function public.process_reversal(
  p_shop_id uuid,
  p_sale_id text,
  p_delete_sale boolean,
  p_inventory_logs jsonb,
  p_bottle_updates jsonb,
  p_product_updates jsonb,
  p_customer_id text,
  p_credit_decrement numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec      record;
  v_addition numeric;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_delete_sale then
    delete from public.sales
     where id = p_sale_id
       and "shopId" = p_shop_id;
    if not found then
      return;
    end if;
  end if;

  insert into public.inventory_logs (
    id, "shopId", "productId", "productName", type, action,
    "quantityChange", "previousStock", "newStock", change,
    "mlChange", "newStockMl", reason, notes, "actorName",
    "userName", "actorRole", "createdAtClient", "createdAt", "createdBy"
  )
  select
    r.id, p_shop_id, r."productId", r."productName", r.type, r.action,
    r."quantityChange", r."previousStock", r."newStock", r.change,
    r."mlChange", r."newStockMl", r.reason, r.notes, r."actorName",
    r."userName", r."actorRole", r."createdAtClient",
    coalesce(r."createdAt", now()), auth.uid()::text
  from jsonb_populate_recordset(null::public.inventory_logs, coalesce(p_inventory_logs, '[]'::jsonb)) r
  where r.id is not null
  on conflict (id) do nothing;

  for v_rec in select * from jsonb_array_elements(coalesce(p_bottle_updates, '[]'::jsonb))
  loop
    update public.bottles
       set "remainingMl" = (v_rec.value->>'remainingMl')::numeric,
           status        = v_rec.value->>'status',
           "openedDate"  = case
                             when v_rec.value->>'openedDate' is not null
                             then (v_rec.value->>'openedDate')::timestamptz
                             else null
                           end,
           "updatedAt"   = coalesce((v_rec.value->>'updatedAt')::timestamptz, now())
     where id = v_rec.value->>'bottleId'
       and "shopId" = p_shop_id;
  end loop;

  for v_rec in select * from jsonb_array_elements(coalesce(p_product_updates, '[]'::jsonb))
  loop
    v_addition := coalesce((v_rec.value->>'addition')::numeric, 0);
    if v_addition < 0 then
      raise exception 'Invalid stock restore amount (%).', v_addition using errcode = '22023';
    end if;
    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) + v_addition,
           "updatedAt"     = now()
     where id = v_rec.value->>'productId'
       and "shopId" = p_shop_id;
  end loop;

  if p_customer_id is not null and coalesce(p_credit_decrement, 0) > 0 then
    update public.customers
       set "creditBalance" = coalesce("creditBalance", 0) - p_credit_decrement,
           "updatedAt"     = now()
     where id = p_customer_id
       and "shopId" = p_shop_id;
  end if;
end;
$$;

revoke all on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) from public;
revoke all on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) from anon;
grant execute on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
