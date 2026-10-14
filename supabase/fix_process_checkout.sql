-- =====================================================================
-- DO NOT RUN THIS FILE. It is a retired historical snapshot.
--
-- It is kept only as a record of how the database used to look. The live
-- database is now defined by the applied migrations
--   supabase/migrations/20261011120000_emergency_security_lockdown.sql
--   supabase/migrations/20261011140000_stock_never_negative_refill_steps.sql
-- and described by supabase/diagnostics/live-snapshot-2026-10-11.md.
--
-- Running this file in the Supabase SQL Editor would undo those fixes: it
-- can let anyone holding the public app key call shop functions, expose
-- one shop's data to another, and break checkout and the never-below-zero
-- stock rule. The DO block below stops the whole script with an error
-- before anything else runs. Do not remove it, and do not run parts of
-- this file by selecting them.
-- =====================================================================
DO $do_not_run$ BEGIN RAISE EXCEPTION 'DO NOT RUN: fix_process_checkout.sql is a retired snapshot, superseded by migrations 20261011120000 and 20261011140000. Nothing was changed.'; END $do_not_run$;

-- Drop existing function if needed
DROP FUNCTION IF EXISTS public.process_checkout;

-- Fix inventory_alerts product_id column type (it was created as UUID but products.id is TEXT)
ALTER TABLE IF EXISTS public.inventory_alerts ALTER COLUMN product_id TYPE TEXT;

CREATE OR REPLACE FUNCTION public.process_checkout(
  p_shop_id UUID,
  p_sale_data JSONB,
  p_product_updates JSONB,
  p_bottle_updates JSONB,
  p_inventory_logs JSONB,
  p_customer_id TEXT DEFAULT NULL,
  p_credit_increment NUMERIC DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prod JSONB;
  v_bot JSONB;
  v_log JSONB;
  v_current_stock NUMERIC;
BEGIN
  -- 1. Insert Sale
  INSERT INTO public.sales (
    id, "shopId", "customerId", items, "totalAmount", 
    "paymentMethod", "splitAmounts", 
    "saleDate", "saleDateClient", "actorName", "actorRole", "totalCOGS", "totalProfit", "createdAt", "updatedAt"
  )
  VALUES (
    (p_sale_data->>'id'),
    p_shop_id,
    (CASE WHEN (p_sale_data->>'customerId') IS NULL OR (p_sale_data->>'customerId') = '' THEN NULL ELSE (p_sale_data->>'customerId') END),
    p_sale_data->'items',
    (p_sale_data->>'totalAmount')::NUMERIC,
    p_sale_data->>'paymentMethod',
    p_sale_data->'splitAmounts',
    NOW(),
    (p_sale_data->>'saleDateClient')::TIMESTAMP WITH TIME ZONE,
    p_sale_data->>'actorName',
    p_sale_data->>'actorRole',
    (p_sale_data->>'totalCOGS')::NUMERIC,
    (p_sale_data->>'totalProfit')::NUMERIC,
    NOW(),
    NOW()
  );

  -- 2. Process Product Stock Updates with Graceful Negative Handling
  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_product_updates)
  LOOP
    -- Fetch the current true stock directly from the database before deducting
    SELECT "stockQuantity" INTO v_current_stock 
    FROM public.products 
    WHERE id = (v_prod->>'id') FOR UPDATE;

    -- Update the stock by deducting the exact amount the cashier rang up
    UPDATE public.products
    SET 
      "stockQuantity" = "stockQuantity" - (v_prod->>'deduction')::NUMERIC,
      "updatedAt" = NOW()
    WHERE id = (v_prod->>'id');

    -- If this deduction pushes the stock below 0, generate an alert!
    IF (v_current_stock - (v_prod->>'deduction')::NUMERIC) < 0 THEN
      INSERT INTO public.inventory_alerts (
        shop_id, product_id, product_name, message
      ) VALUES (
        p_shop_id, 
        (v_prod->>'id'), 
        (SELECT name FROM public.products WHERE id = (v_prod->>'id')), 
        'Negative Stock Alert: Offline sync pushed stock to ' || (v_current_stock - (v_prod->>'deduction')::NUMERIC)::TEXT
      );
    END IF;
  END LOOP;

  -- 3. Process Bottle Updates (Status / Remaining ML)
  FOR v_bot IN SELECT * FROM jsonb_array_elements(p_bottle_updates)
  LOOP
    INSERT INTO public.bottles (
      id, "productId", "shopId", "bottleSize", "remainingMl", status, "openedDate", "createdAt", "updatedAt"
    ) VALUES (
      (v_bot->>'id'),
      (v_bot->>'productId'),
      p_shop_id,
      (v_bot->>'bottleSize')::NUMERIC,
      (v_bot->>'remainingMl')::NUMERIC,
      v_bot->>'status',
      (CASE WHEN (v_bot->>'openedDate') IS NOT NULL AND (v_bot->>'openedDate') != '' THEN (v_bot->>'openedDate')::TIMESTAMP WITH TIME ZONE ELSE NULL END),
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      "remainingMl" = EXCLUDED."remainingMl",
      status = EXCLUDED.status,
      "openedDate" = COALESCE(EXCLUDED."openedDate", public.bottles."openedDate"),
      "updatedAt" = NOW();
  END LOOP;

  -- 4. Insert Inventory Logs
  FOR v_log IN SELECT * FROM jsonb_array_elements(p_inventory_logs)
  LOOP
    INSERT INTO public.inventory_logs (
      id, "productId", "productName", "shopId", action, type, change, "quantityChange", 
      "mlChange", "newStock", reason, notes, "actorName", "actorRole", "createdAt", "createdAtClient"
    )
    VALUES (
      (v_log->>'id'),
      (v_log->>'productId'),
      v_log->>'productName',
      p_shop_id,
      v_log->>'action',
      v_log->>'type',
      (v_log->>'change')::NUMERIC,
      (v_log->>'quantityChange')::NUMERIC,
      (v_log->>'mlChange')::NUMERIC,
      (v_log->>'newStock')::NUMERIC,
      v_log->>'reason',
      v_log->>'notes',
      v_log->>'actorName',
      v_log->>'actorRole',
      NOW(),
      (v_log->>'createdAtClient')::TIMESTAMP WITH TIME ZONE
    );
  END LOOP;

  -- 5. Update Customer Credit if applicable
  IF p_customer_id IS NOT NULL AND p_customer_id != '' AND p_credit_increment > 0 THEN
    UPDATE public.customers
    SET "creditBalance" = COALESCE("creditBalance", 0) + p_credit_increment
    WHERE id = p_customer_id;
  END IF;
END;
$$;
