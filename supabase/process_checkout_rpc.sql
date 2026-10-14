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
DO $do_not_run$ BEGIN RAISE EXCEPTION 'DO NOT RUN: process_checkout_rpc.sql is a retired snapshot, superseded by migrations 20261011120000 and 20261011140000. Nothing was changed.'; END $do_not_run$;

-- process_checkout_rpc.sql
-- Run this in your Supabase SQL Editor to create the transaction function.

CREATE OR REPLACE FUNCTION process_checkout(
    p_shop_id uuid,
    p_sale_data jsonb,
    p_inventory_logs jsonb,
    p_bottle_updates jsonb,
    p_product_updates jsonb,
    p_customer_id text,
    p_credit_increment numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- This allows the function to bypass RLS and perform atomic operations safely
AS $$
DECLARE
    bottle_rec record;
    prod_rec record;
BEGIN
    -- 1. Security Check (ensure the caller belongs to this shop)
    IF NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND "shopId" = p_shop_id
    ) AND auth.uid() != p_shop_id THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    -- 2. Insert Sale
    INSERT INTO sales (
        "id", "shopId", "customerId", "totalAmount", "totalCOGS", "totalProfit", 
        "paymentMethod", "items", "actorName", "actorRole", "userName", 
        "saleDate", "saleDateClient", "notes", "splitAmounts", "createdAt", "updatedAt"
    )
    SELECT 
        id, "shopId", "customerId", "totalAmount", "totalCOGS", "totalProfit",
        "paymentMethod", "items", "actorName", "actorRole", "userName",
        ("saleDate")::timestamptz, "saleDateClient", "notes", "splitAmounts", ("createdAt")::timestamptz, ("updatedAt")::timestamptz
    FROM jsonb_populate_record(null::sales, p_sale_data);

    -- 3. Insert Inventory Logs
    IF jsonb_array_length(p_inventory_logs) > 0 THEN
        INSERT INTO inventory_logs (
            "id", "shopId", "productId", "productName", "type", "action", 
            "quantityChange", "previousStock", "newStock", "change", 
            "mlChange", "newStockMl", "reason", "notes", "actorName", 
            "userName", "actorRole", "createdAtClient", "createdAt"
        )
        SELECT 
            id, "shopId", "productId", "productName", type, action, 
            "quantityChange", "previousStock", "newStock", change, 
            "mlChange", "newStockMl", reason, notes, "actorName", 
            "userName", "actorRole", "createdAtClient", ("createdAt")::timestamptz
        FROM jsonb_populate_recordset(null::inventory_logs, p_inventory_logs);
    END IF;

    -- 4. Update Bottles
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

    -- 5. Update Products Stock
    IF p_product_updates IS NOT NULL AND jsonb_array_length(p_product_updates) > 0 THEN
        FOR prod_rec IN SELECT * FROM jsonb_array_elements(p_product_updates)
        LOOP
            UPDATE products
            SET "stockQuantity" = "stockQuantity" - (prod_rec.value->>'deduction')::numeric
            WHERE id = prod_rec.value->>'id';
        END LOOP;
    END IF;

    -- 6. Update Customer Credit
    IF p_customer_id IS NOT NULL AND p_credit_increment > 0 THEN
        UPDATE customers
        SET "creditBalance" = COALESCE("creditBalance", 0) + p_credit_increment
        WHERE id = p_customer_id;
    END IF;

END;
$$;
