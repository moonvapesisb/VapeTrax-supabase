-- =====================================================================
-- supabase/rehearsal/fixtures.sql
-- REHEARSAL ONLY. Loaded after replica.sql by supabase/rehearsal/lib.mjs
-- (replica({ fixtures: true })). NEVER paste this into the Supabase SQL
-- Editor: it would add fake rows to the real shop. It refuses to run there.
--
-- Synthetic edge cases only. No real customer, product or account data:
-- every name, phone and email below is invented, and every email uses the
-- reserved example.invalid domain. The shapes copy what the live data
-- profile (supabase/diagnostics/live-snapshot-2026-10-11.md) found:
--   * 20-character Firestore-style text ids next to uuid-style ids;
--   * *Client dates as Firestore JSON, ISO text and Postgres-style text;
--   * products."bottleSize" as '30ml', '30', '', '60 ML', 'n/a' and null;
--   * bottles with more ml than their size, a negative ml, an orphan and a
--     bottle pointing at another shop's product;
--   * category, paymentMethod and saleType spelling variants;
--   * 'others' credits whose names differ only by case and spaces;
--   * sales and credits pointing at customers that do not exist;
--   * money with more than 2 decimals, duplicate names and phones.
-- It also holds rehearsal.v1_payloads: RPC payloads in the exact shape the
-- deployed app (commit 2c5de29) sends, built from NewSale.handleCompleteSale
-- and lib/salesReversal.ts. tests/06_v1_payloads.mjs replays them.
--
-- tests/04_integrity_probe.mjs asserts exact counts over these rows. If you
-- add or change a row here, update the expected numbers there.
-- =====================================================================

do $fixtures_guard$
begin
  if coalesce(current_setting('rehearsal.replica', true), '') <> 'on' then
    raise exception 'DO NOT RUN: supabase/rehearsal/fixtures.sql is for the local rehearsal only. Nothing was changed.';
  end if;
end
$fixtures_guard$;

-- ---------------------------------------------------------------------
-- Accounts: the main shop, a synthetic second shop, an unconfirmed signup
-- ---------------------------------------------------------------------
insert into auth.users (id, email, created_at, email_confirmed_at, last_sign_in_at) values
  ('c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'main-shop@example.invalid',   '2026-10-03T08:00:00Z', '2026-10-03T08:05:00Z', '2026-10-11T07:00:00Z'),
  ('d2d2d2d2-0000-4000-8000-000000000002', 'second-shop@example.invalid', '2026-10-05T08:00:00Z', '2026-10-05T08:05:00Z', '2026-10-06T07:00:00Z'),
  ('e3e3e3e3-0000-4000-8000-000000000003', 'unconfirmed@example.invalid', '2026-10-07T08:00:00Z', null, null);

insert into auth.identities (user_id, provider, provider_id) values
  ('c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'email',  'c7587ec2-753c-4767-a9f3-8bcf6b30e685'),
  ('d2d2d2d2-0000-4000-8000-000000000002', 'google', '100000000000000000002'),
  ('e3e3e3e3-0000-4000-8000-000000000003', 'email',  'e3e3e3e3-0000-4000-8000-000000000003');

insert into public.profiles (id, username, email, role, "shopId") values
  ('c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Main Owner',   'main-shop@example.invalid',   'admin', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685'),
  ('d2d2d2d2-0000-4000-8000-000000000002', 'Fixture Second Owner', 'second-shop@example.invalid', 'admin', 'd2d2d2d2-0000-4000-8000-000000000002');

insert into public.settings ("shopId", "shopName") values
  ('c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Main Shop');

-- ---------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------
insert into public.products (id, "shopId", name, category, "costPrice", "sellingPrice", "stockQuantity", "bottleSize", "pricePerMl", "unitCostPerMl", "createdAtClient") values
  ('prodPod0000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Pod X',     'device',     1000,     1500,   10, null,    0,  0, '{"_seconds":1789885800,"_nanoseconds":0}'),
  ('prodPod0000000000002', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'pod x ',    'Device',     1000,     1500,    4, '',      0,  0, '2026-09-21T06:30:00.000Z'),
  ('prodMango00000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Mango Ice', 'e-liquid',   1500,     2000,   75, '30ml', 70, 50, '{"_seconds":1789885800,"_nanoseconds":0}'),
  ('prodGrape00000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Grape',     'e-liquid',   1200,     1800,   40, '30',   60, 40, null),
  ('prodMint000000000005', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Mint',      'e-liquid',   1200,     1800,    0, '',     60, 40, null),
  ('prodBerry00000000006', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Berry',     ' E-Liquid ', 2500.123, 3000.5, 60, '60 ML', 0,  0, null),
  ('a7a7a7a7-0000-4000-8000-000000000007', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Coil', 'accessory', 200, 350, 25, 'n/a', 0, 0, null),
  ('prodNeg0000000000008', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Old Battery', 'accessory', 300,     500,   -2, null,    0,  0, null),
  ('prodShop2Item0000001', 'd2d2d2d2-0000-4000-8000-000000000002', 'Shop2 Juice', 'e-liquid', 1500,     2000,   30, '30ml', 70, 50, null);

-- ---------------------------------------------------------------------
-- Bottles
-- ---------------------------------------------------------------------
insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status, "openedDate", "createdAt") values
  ('botl0000000000000001', 'prodMango00000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 30, 'closed', null, '2026-09-20T06:30:00Z'),
  ('botl0000000000000002', 'prodMango00000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 30, 'closed', null, '2026-09-20T06:31:00Z'),
  ('botl0000000000000003', 'prodMango00000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 15, 'opened', '2026-10-05T09:00:00Z', '2026-09-20T06:29:00Z'),
  ('botl0000000000000004', 'prodGrape00000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 30, 'closed', null, '2026-09-20T06:30:00Z'),
  ('botl0000000000000005', 'prodGrape00000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30,  5, 'opened', '2026-10-06T09:00:00Z', '2026-09-20T06:28:00Z'),
  -- more ml than the bottle holds
  ('botl0000000000000006', 'prodMint000000000005', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 45, 'opened', '2026-10-06T09:00:00Z', '2026-09-20T06:30:00Z'),
  ('botl0000000000000007', 'prodMango00000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30,  0, 'sold',   null, '2026-09-20T06:27:00Z'),
  -- orphan: its product does not exist
  ('botl0000000000000008', 'prodGone000000000099', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 10, 'opened', '2026-10-01T09:00:00Z', '2026-09-20T06:30:00Z'),
  -- cross-shop: in the main shop, but its product belongs to the second shop
  ('botl0000000000000009', 'prodShop2Item0000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 30, 'closed', null, '2026-09-20T06:30:00Z'),
  ('b1b1b1b1-0000-4000-8000-000000000010', 'prodGrape00000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, 0, 'empty', '2026-09-25T09:00:00Z', '2026-09-20T06:30:00Z'),
  -- negative ml: 20261011140000 resets it to 0 and marks it empty
  ('botl0000000000000011', 'prodMint000000000005', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 30, -3, 'opened', '2026-10-02T09:00:00Z', '2026-09-20T06:30:00Z'),
  ('botlShop200000000001', 'prodShop2Item0000001', 'd2d2d2d2-0000-4000-8000-000000000002', 30, 30, 'closed', null, '2026-10-05T09:00:00Z');

-- ---------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------
insert into public.customers (id, "shopId", name, phone, email, "creditBalance", "createdAtClient") values
  ('cust0000000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Customer One',   '0300-1112223',  'customer-one@example.invalid', 850, '{"_seconds":1789885800,"_nanoseconds":0}'),
  ('cust0000000000000002', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Customer Two',   '03001112223',   null, 100, '2026-09-21T06:30:00.000Z'),
  ('cust0000000000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Customer Three', '+923004445556', null,   0, null),
  ('cust0000000000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Customer Four',  '03004445556',   null,   0, null),
  ('cust0000000000000005', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Fixture Customer Five',  '03001112223',   null,   0, null),
  ('custShop200000000001', 'd2d2d2d2-0000-4000-8000-000000000002', 'Fixture Shop Two Buyer', '03001112223',   null,   0, null);

-- ---------------------------------------------------------------------
-- Sales (historic rows, as imported from Firestore and written since)
-- ---------------------------------------------------------------------
insert into public.sales (id, "shopId", "customerId", "totalAmount", "totalCOGS", "totalProfit", "paymentMethod", items, "saleDate", "saleDateClient", "splitAmounts", "actorName", "actorRole") values
  ('sale0000000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', null, 1500, 1000, 500, 'cash',
   $j$[{"productId":"prodPod0000000000001","productName":"Pod X","quantity":1,"unitPrice":1500,"costPrice":1000,"totalPrice":1500,"saleType":"regular"}]$j$,
   '2026-10-01T05:00:00Z', '{"_seconds":1790830800,"_nanoseconds":0}', null, 'main-shop', 'admin'),
  ('sale0000000000000002', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', null, 210, 150, 60, 'Cash ',
   $j$[{"productId":"prodMango00000000003","productName":"Mango Ice","quantity":2,"unitPrice":105,"costPrice":75,"totalPrice":210,"saleType":"refill","refillAmount":1.5,"bottleSize":30,
        "bottleChanges":[{"bottleId":"botl0000000000000003","beforeRemainingMl":18,"afterRemainingMl":15,"beforeStatus":"opened","afterStatus":"opened"}]}]$j$,
   '2026-10-02T06:00:00Z', '2026-10-02T06:00:00.000Z', null, 'main-shop', 'admin'),
  -- old Firestore line: no productId, 'refillMl' instead of refillAmount
  ('sale0000000000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'cust0000000000000001', 300, 200, 100, 'credit',
   $j$[{"productName":"Mango Ice","quantity":1,"unitPrice":300,"saleType":"Refill ","refillMl":4}]$j$,
   '2026-10-03T07:00:00Z', '2026-10-03 07:00:00.25+00', null, 'main-shop', 'admin'),
  -- saleDateClient two hours away from saleDate
  ('sale0000000000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'cust0000000000000001', 150, 100, 50, 'split',
   $j$[{"productId":"prodGrape00000000004","productName":"Grape","quantity":1,"unitPrice":150,"costPrice":100,"totalPrice":150,"saleType":"full_bottle","bottleSize":30,"bottleChanges":[]}]$j$,
   '2026-10-04T08:00:00Z', '{"_seconds":1791108000,"_nanoseconds":500000000}', '{"cash":100,"online":0,"credit":50}', 'main-shop', 'admin'),
  -- customer that does not exist; profit with 4 decimals
  ('sale0000000000000005', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'custMissing000000098', 700, 400, 12.3456, 'cash',
   $j$[{"productId":"a7a7a7a7-0000-4000-8000-000000000007","productName":"Coil","quantity":2,"unitPrice":350,"costPrice":200,"totalPrice":700,"saleType":"regular"}]$j$,
   '2026-10-05T08:00:00Z', null, null, 'main-shop', 'admin'),
  -- customer of the OTHER shop
  ('sale0000000000000006', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'custShop200000000001', 1500, 1000, 500, ' online',
   $j$[{"productId":"prodPod0000000000001","productName":"Pod X","quantity":1,"unitPrice":1500,"costPrice":1000,"totalPrice":1500,"saleType":"regular"}]$j$,
   '2026-10-06T08:00:00Z', '2026-10-06T08:00:00.000Z', null, 'main-shop', 'admin'),
  -- uuid id (written by the Supabase-era app); price not in whole rupees
  ('c0c0c0c0-0000-4000-8000-000000000007', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', null, 1499.5, 1000, 499.5, 'cash',
   $j$[{"productId":"prodPod0000000000002","productName":"pod x","quantity":1,"unitPrice":1499.5,"costPrice":1000,"totalPrice":1499.5,"saleType":"regular","refillAmount":null}]$j$,
   '2026-10-07T08:00:00Z', '2026-10-07T08:00:00.000Z', null, 'main-shop', 'admin'),
  -- a line that is not an object
  ('sale0000000000000008', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', null, 0, 0, 0, 'cash',
   $j$["junk"]$j$,
   '2026-10-08T08:00:00Z', '2026-10-08T08:00:00.000Z', null, 'main-shop', 'admin'),
  ('saleShop200000000001', 'd2d2d2d2-0000-4000-8000-000000000002', null, 2000, 1500, 500, 'cash',
   $j$[{"productId":"prodShop2Item0000001","productName":"Shop2 Juice","quantity":1,"unitPrice":2000,"costPrice":1500,"totalPrice":2000,"saleType":"full_bottle","bottleSize":30}]$j$,
   '2026-10-06T09:00:00Z', '2026-10-06T09:00:00.000Z', null, 'second-shop', 'admin');

-- ---------------------------------------------------------------------
-- Credits (udhaar)
-- ---------------------------------------------------------------------
insert into public.credits (id, "shopId", "creditType", "customerId", "entityName", "entityContact", amount, "transactionType", "createdAtClient") values
  ('cred0000000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'customer', 'cust0000000000000001', null, null, 700, 'given', '{"_seconds":1789885800,"_nanoseconds":0}'),
  ('cred0000000000000002', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'customer', 'cust0000000000000001', null, null, 200, 'taken', '{"_seconds":1789972200,"_nanoseconds":0}'),
  ('cred0000000000000003', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'others', null, 'Fixture Traders',   '0311-0000001', 1000, 'given', '2026-09-22T06:30:00.000Z'),
  ('cred0000000000000004', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'others', null, 'fixture traders ',  null,           400, 'taken', null),
  ('cred0000000000000005', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'others', null, 'Fixture Supplies',  null,           250, 'given', null),
  ('cred0000000000000006', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'customer', 'custMissing000000099', null, null, 300, 'given', null),
  ('cred0000000000000007', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'others', null, null, null, 50, 'given', null);

-- ---------------------------------------------------------------------
-- Inventory logs, expenses
-- ---------------------------------------------------------------------
insert into public.inventory_logs (id, "shopId", "productId", "productName", type, action, change, "newStock", reason, "createdAtClient") values
  ('invl0000000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'prodPod0000000000001', 'Pod X', 'sale', 'sale', -1, 9, 'Sale: regular', '2026-10-01 10:00:00.12+00'),
  ('0a0a0a0a-0000-4000-8000-000000000002', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'prodGrape00000000004', 'Grape', 'adjustment', 'update', 5, 40, 'Stock count', '2026-10-02T10:00:00.000Z'),
  ('manual-log-1', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'prodMango00000000003', 'Mango Ice', 'restock', 'add', 30, 75, 'Restock', '2026-10-03T10:00:00.000Z');

insert into public.expenses (id, "shopId", category, description, amount, "expenseDate", "createdAtClient") values
  ('expn0000000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Rent', 'Fixture rent', 500.555, '2026-10-01T05:00:00Z', '2026-10-01T05:00:00.000Z');

insert into public.personal_expenses (id, "shopId", category, description, amount, "createdAtClient") values
  ('pexp0000000000000001', 'c7587ec2-753c-4767-a9f3-8bcf6b30e685', 'Home', 'Fixture personal', 200, '2026-10-01T05:00:00.000Z');

-- ---------------------------------------------------------------------
-- Captured v1 payloads (deployed app, commit 2c5de29), replayed by
-- tests/06_v1_payloads.mjs in seq order as the main shop's admin.
--   kind 'rpc':    target = function, args = named arguments exactly as
--                  supabase.rpc(target, args) sends them (and as the sync
--                  queue stores them in syncQueue.payload).
--   kind 'delete': target = table, args = {"id": ...}; the edit-sale flow
--                  deletes the old sale row directly between its reversal
--                  and its new checkout.
-- ---------------------------------------------------------------------
create schema rehearsal;
create table rehearsal.v1_payloads (
  seq    int primary key,
  name   text not null,
  source text not null,
  kind   text not null check (kind in ('rpc', 'delete')),
  target text not null,
  args   jsonb not null
);

insert into rehearsal.v1_payloads (seq, name, source, kind, target, args) values
(1, 'checkout: regular item, cash', 'src/pages/NewSale.tsx handleCompleteSale (regular line)', 'rpc', 'process_checkout', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_data": {
    "id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a01", "customerId": null, "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "totalAmount": 1500, "totalCOGS": 1000, "totalProfit": 500, "paymentMethod": "cash",
    "items": [{"productId": "prodPod0000000000001", "productName": "Pod X", "quantity": 1, "unitPrice": 1500, "costPrice": 1000,
               "totalPrice": 1500, "totalCost": 1000, "profit": 500, "saleType": "regular", "refillAmount": null}],
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "splitAmounts": null, "saleDate": "2026-10-11T09:15:00.000Z", "saleDateClient": "2026-10-11T09:15:00.000Z",
    "createdAt": "2026-10-11T09:15:00.000Z", "updatedAt": "2026-10-11T09:15:00.000Z"
  },
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000001", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "productId": "prodPod0000000000001", "productName": "Pod X", "action": "sale", "type": "sale", "change": -1, "quantityChange": -1,
    "newStock": 9, "reason": "Sale: regular", "notes": "Sale: regular",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T09:15:00.000Z", "createdAtClient": "2026-10-11T09:15:00.000Z"
  }],
  "p_bottle_updates": [],
  "p_product_updates": [{"id": "prodPod0000000000001", "deduction": 1}],
  "p_customer_id": null,
  "p_credit_increment": 0
}$j$),
(2, 'checkout: refill 1.5 ml x 2 on credit', 'src/pages/NewSale.tsx handleCompleteSale (refill line)', 'rpc', 'process_checkout', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_data": {
    "id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a02", "customerId": "cust0000000000000001", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "totalAmount": 210, "totalCOGS": 150, "totalProfit": 60, "paymentMethod": "credit",
    "items": [{"productId": "prodMango00000000003", "productName": "Mango Ice", "quantity": 2, "unitPrice": 105, "costPrice": 75,
               "totalPrice": 210, "totalCost": 150, "profit": 60, "saleType": "refill", "refillAmount": 1.5, "bottleSize": 30,
               "bottleChanges": [{"bottleId": "botl0000000000000003", "beforeRemainingMl": 15, "afterRemainingMl": 12,
                                  "beforeStatus": "opened", "afterStatus": "opened",
                                  "beforeOpenedDate": "2026-10-05T09:00:00.000Z", "afterOpenedDate": null}]}],
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "splitAmounts": null, "saleDate": "2026-10-11T09:20:00.000Z", "saleDateClient": "2026-10-11T09:20:00.000Z",
    "createdAt": "2026-10-11T09:20:00.000Z", "updatedAt": "2026-10-11T09:20:00.000Z"
  },
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000002", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "productId": "prodMango00000000003", "productName": "Mango Ice", "action": "sale", "type": "sale",
    "mlChange": -3, "change": -3, "quantityChange": 0, "newStockMl": 72, "newStock": 72,
    "reason": "Sale: refill", "notes": "Refill 1.5ml x 2",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T09:20:00.000Z", "createdAtClient": "2026-10-11T09:20:00.000Z"
  }],
  "p_bottle_updates": [{"id": "botl0000000000000003", "productId": "prodMango00000000003", "bottleSize": 30, "remainingMl": 12,
                        "status": "opened", "openedDate": "2026-10-05T09:00:00.000Z", "updatedAt": "2026-10-11T09:20:00.000Z"}],
  "p_product_updates": [{"id": "prodMango00000000003", "deduction": 3}],
  "p_customer_id": "cust0000000000000001",
  "p_credit_increment": 210
}$j$),
(3, 'checkout: full bottle, split cash + online + credit', 'src/pages/NewSale.tsx handleCompleteSale (full_bottle line)', 'rpc', 'process_checkout', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_data": {
    "id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a03", "customerId": "cust0000000000000001", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "totalAmount": 1800, "totalCOGS": 1200, "totalProfit": 600, "paymentMethod": "split",
    "items": [{"productId": "prodGrape00000000004", "productName": "Grape", "quantity": 1, "unitPrice": 1800, "costPrice": 1200,
               "totalPrice": 1800, "totalCost": 1200, "profit": 600, "saleType": "full_bottle", "refillAmount": null, "bottleSize": 30,
               "bottleChanges": [{"bottleId": "botl0000000000000004", "beforeRemainingMl": 30, "afterRemainingMl": 0,
                                  "beforeStatus": "closed", "afterStatus": "sold", "beforeOpenedDate": null, "afterOpenedDate": null}]}],
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "splitAmounts": {"cash": 1000, "online": 500, "credit": 300},
    "saleDate": "2026-10-11T09:25:00.000Z", "saleDateClient": "2026-10-11T09:25:00.000Z",
    "createdAt": "2026-10-11T09:25:00.000Z", "updatedAt": "2026-10-11T09:25:00.000Z"
  },
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000003", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "productId": "prodGrape00000000004", "productName": "Grape", "action": "sale", "type": "sale",
    "mlChange": -30, "change": -30, "quantityChange": -1, "newStockMl": 10, "newStock": 10,
    "reason": "Sale: full_bottle", "notes": "Full bottle x 1",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T09:25:00.000Z", "createdAtClient": "2026-10-11T09:25:00.000Z"
  }],
  "p_bottle_updates": [{"id": "botl0000000000000004", "productId": "prodGrape00000000004", "bottleSize": 30, "status": "sold",
                        "remainingMl": 0, "updatedAt": "2026-10-11T09:25:00.000Z"}],
  "p_product_updates": [{"id": "prodGrape00000000004", "deduction": 30}],
  "p_customer_id": "cust0000000000000001",
  "p_credit_increment": 300
}$j$),
(4, 'checkout: refill that opens a bottle the server has never seen', 'src/pages/NewSale.tsx handleCompleteSale (refill line, missing-bottle branch)', 'rpc', 'process_checkout', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_data": {
    "id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a04", "customerId": null, "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "totalAmount": 100, "totalCOGS": 83.33743333333334, "totalProfit": 16.662566666666663, "paymentMethod": "cash",
    "items": [{"productId": "prodBerry00000000006", "productName": "Berry", "quantity": 2, "unitPrice": 50, "costPrice": 41.66871666666667,
               "totalPrice": 100, "totalCost": 83.33743333333334, "profit": 16.662566666666663, "saleType": "refill", "refillAmount": 1, "bottleSize": 60,
               "bottleChanges": [{"bottleId": "b0c1d2e3-f4a5-4b6c-9d7e-000000000001", "beforeRemainingMl": 60, "afterRemainingMl": 58,
                                  "beforeStatus": "closed", "afterStatus": "opened", "beforeOpenedDate": null, "afterOpenedDate": null}]}],
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "splitAmounts": null, "saleDate": "2026-10-11T09:30:00.000Z", "saleDateClient": "2026-10-11T09:30:00.000Z",
    "createdAt": "2026-10-11T09:30:00.000Z", "updatedAt": "2026-10-11T09:30:00.000Z"
  },
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000004", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "productId": "prodBerry00000000006", "productName": "Berry", "action": "sale", "type": "sale",
    "mlChange": -2, "change": -2, "quantityChange": 0, "newStockMl": 58, "newStock": 58,
    "reason": "Sale: refill", "notes": "Refill 1ml x 2",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T09:30:00.000Z", "createdAtClient": "2026-10-11T09:30:00.000Z"
  }],
  "p_bottle_updates": [{"id": "b0c1d2e3-f4a5-4b6c-9d7e-000000000001", "productId": "prodBerry00000000006", "bottleSize": 60,
                        "remainingMl": 58, "status": "opened", "openedDate": "2026-10-11T09:30:00.000Z", "updatedAt": "2026-10-11T09:30:00.000Z"}],
  "p_product_updates": [{"id": "prodBerry00000000006", "deduction": 2}],
  "p_customer_id": null,
  "p_credit_increment": 0
}$j$),
(5, 'reversal: delete the refill sale (seq 2)', 'src/lib/salesReversal.ts deleteSaleWithReversal', 'rpc', 'process_reversal', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a02",
  "p_delete_sale": true,
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000005", "productId": "prodMango00000000003", "productName": "Mango Ice",
    "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "action": "return", "type": "return",
    "mlChange": 3, "change": 3, "quantityChange": 0, "reason": "Sale deleted (restored): 5F6A02", "notes": "Inventory restored",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T10:00:00.000Z", "createdAtClient": "2026-10-11T10:00:00.000Z"
  }],
  "p_bottle_updates": [{"bottleId": "botl0000000000000003", "remainingMl": 15, "status": "opened",
                        "openedDate": "2026-10-05T09:00:00.000Z", "updatedAt": "2026-10-11T10:00:00.000Z"}],
  "p_product_updates": [{"productId": "prodMango00000000003", "addition": 3}],
  "p_customer_id": "cust0000000000000001",
  "p_credit_decrement": 210
}$j$),
(6, 'edit sale, step 1: reverse the old regular sale (seq 1) without deleting it', 'src/lib/salesReversal.ts reverseSaleImpact(isEdit = true)', 'rpc', 'process_reversal', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a01",
  "p_delete_sale": false,
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000006", "productId": "prodPod0000000000001", "productName": "Pod X",
    "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "action": "return", "type": "return",
    "change": 1, "quantityChange": 1, "reason": "Sale edited (restored old): 5F6A01", "notes": "Inventory restored",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T10:05:00.000Z", "createdAtClient": "2026-10-11T10:05:00.000Z"
  }],
  "p_bottle_updates": null,
  "p_product_updates": [{"productId": "prodPod0000000000001", "addition": 1}],
  "p_customer_id": null,
  "p_credit_decrement": 0
}$j$),
(7, 'edit sale, step 2: delete the old sale row directly', 'src/pages/NewSale.tsx handleCompleteSale (isEditing: supabase.from(''sales'').delete())', 'delete', 'sales', $j$
{"id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a01"}$j$),
(8, 'edit sale, step 3: check out again under the same sale id, now quantity 2', 'src/pages/NewSale.tsx handleCompleteSale (isEditing)', 'rpc', 'process_checkout', $j$
{
  "p_shop_id": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
  "p_sale_data": {
    "id": "f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a01", "customerId": null, "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "totalAmount": 3000, "totalCOGS": 2000, "totalProfit": 1000, "paymentMethod": "cash",
    "items": [{"productId": "prodPod0000000000001", "productName": "Pod X", "quantity": 2, "unitPrice": 1500, "costPrice": 1000,
               "totalPrice": 3000, "totalCost": 2000, "profit": 1000, "saleType": "regular", "refillAmount": null}],
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "splitAmounts": null, "saleDate": "2026-10-11T09:15:00.000Z", "saleDateClient": "2026-10-11T09:15:00.000Z",
    "createdAt": "2026-10-11T09:15:00.000Z", "updatedAt": "2026-10-11T10:05:00.000Z"
  },
  "p_inventory_logs": [{
    "id": "a0b1c2d3-e4f5-4a6b-8c7d-000000000008", "shopId": "c7587ec2-753c-4767-a9f3-8bcf6b30e685",
    "productId": "prodPod0000000000001", "productName": "Pod X", "action": "sale", "type": "sale", "change": -2, "quantityChange": -2,
    "newStock": 8, "reason": "Sale: regular", "notes": "Sale: regular",
    "createdBy": "c7587ec2-753c-4767-a9f3-8bcf6b30e685", "actorRole": "admin", "actorName": "main-shop",
    "createdAt": "2026-10-11T10:05:00.000Z", "createdAtClient": "2026-10-11T10:05:00.000Z"
  }],
  "p_bottle_updates": [],
  "p_product_updates": [{"id": "prodPod0000000000001", "deduction": 2}],
  "p_customer_id": null,
  "p_credit_increment": 0
}$j$);
