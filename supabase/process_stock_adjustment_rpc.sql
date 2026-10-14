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
DO $do_not_run$ BEGIN RAISE EXCEPTION 'DO NOT RUN: process_stock_adjustment_rpc.sql is a retired snapshot, superseded by migrations 20261011120000 and 20261011140000. Nothing was changed.'; END $do_not_run$;

-- process_stock_adjustment_rpc.sql
-- Run this in your Supabase SQL Editor to create the stock adjustment transaction function.

CREATE OR REPLACE FUNCTION process_stock_adjustment(
    p_shop_id uuid,
    p_product_id text,
    p_product_update jsonb,
    p_bottle_updates jsonb,
    p_bottle_inserts jsonb,
    p_inventory_logs jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    bottle_rec record;
    new_bottle record;
BEGIN
    -- 1. Security Check
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND "shopId" = p_shop_id
    ) AND auth.uid() != p_shop_id THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    -- 2. Update Product
    IF p_product_update IS NOT NULL THEN
        UPDATE products
        SET 
            "name" = p_product_update->>'name',
            "category" = p_product_update->>'category',
            "costPrice" = (p_product_update->>'costPrice')::numeric,
            "sellingPrice" = (p_product_update->>'sellingPrice')::numeric,
            "minStockLevel" = (p_product_update->>'minStockLevel')::numeric,
            "unit" = p_product_update->>'unit',
            "bottleSize" = p_product_update->>'bottleSize',
            "unitCostPerMl" = (p_product_update->>'unitCostPerMl')::numeric,
            "pricePerMl" = (p_product_update->>'pricePerMl')::numeric,
            "stockQuantity" = (p_product_update->>'stockQuantity')::numeric,
            "updatedAt" = (p_product_update->>'updatedAt')::timestamptz
        WHERE id = p_product_id;
    END IF;

    -- 3. Update Existing Bottles
    IF p_bottle_updates IS NOT NULL AND jsonb_array_length(p_bottle_updates) > 0 THEN
        FOR bottle_rec IN SELECT * FROM jsonb_array_elements(p_bottle_updates)
        LOOP
            UPDATE bottles
            SET 
                "remainingMl" = (bottle_rec.value->>'remainingMl')::numeric,
                "status" = bottle_rec.value->>'status',
                "openedDate" = CASE 
                    WHEN bottle_rec.value->>'openedDate' IS NOT NULL 
                    THEN (bottle_rec.value->>'openedDate')::timestamptz 
                    ELSE "openedDate" 
                END,
                "updatedAt" = (bottle_rec.value->>'updatedAt')::timestamptz
            WHERE id = bottle_rec.value->>'id';
        END LOOP;
    END IF;

    -- 4. Insert New Bottles
    IF p_bottle_inserts IS NOT NULL AND jsonb_array_length(p_bottle_inserts) > 0 THEN
        INSERT INTO bottles (
            "productId", "shopId", "bottleSize", "remainingMl", "status", "openedDate", "createdAt", "updatedAt"
        )
        SELECT 
            "productId", "shopId", "bottleSize"::numeric, "remainingMl"::numeric, "status", 
            ("openedDate")::timestamptz, ("createdAt")::timestamptz, ("updatedAt")::timestamptz
        FROM jsonb_populate_recordset(null::bottles, p_bottle_inserts);
    END IF;

    -- 5. Insert Inventory Logs
    IF p_inventory_logs IS NOT NULL AND jsonb_array_length(p_inventory_logs) > 0 THEN
        INSERT INTO inventory_logs (
            "id", "shopId", "productId", "productName", "type", "action", 
            "quantityChange", "previousStock", "newStock", "change", 
            "mlChange", "newStockMl", "reason", "notes", "actorName", 
            "userName", "actorRole", "createdAtClient", "createdAt", "createdBy"
        )
        SELECT 
            id, "shopId", "productId", "productName", type, action, 
            "quantityChange", "previousStock", "newStock", change, 
            "mlChange", "newStockMl", reason, notes, "actorName", 
            "userName", "actorRole", "createdAtClient", ("createdAt")::timestamptz, "createdBy"
        FROM jsonb_populate_recordset(null::inventory_logs, p_inventory_logs);
    END IF;

END;
$$;

