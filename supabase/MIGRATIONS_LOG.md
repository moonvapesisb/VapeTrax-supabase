# Supabase Migrations Log

Applied in filename order in the Supabase SQL Editor.

- `20261011120000_emergency_security_lockdown.sql` — Applied 2026-10-11 (recorded in `20261012100000_lockdown_followup.sql`). Never run `20261011120000_emergency_security_lockdown.sql` again.
- `20261011140000_stock_never_negative_refill_steps.sql` — Applied 2026-10-11 (recorded in `20261012100000_lockdown_followup.sql`). Never run `20261011140000_stock_never_negative_refill_steps.sql` again.
- `20261012100000_lockdown_followup.sql` — Applied (date unverified). Never run `20261012100000_lockdown_followup.sql` again (once `20261127100000_cash_and_bank_management.sql` is applied, re-running `20261012100000` would overwrite `process_checkout`/`process_reversal` and drop finance SELECT policies).
- `20261012200000_shop_links_and_transfers.sql` — Applied (date unverified). Linked shops and stock transfers.
- `20261127100000_cash_and_bank_management.sql` — Applied 2026-11-27. Cash & Bank Account Management ledger, RLS, and RPCs.

## Known Limitations (Cash & Bank Module)

- **Edit-sale reversal/checkout crash window**: Editing an existing sale executes `process_reversal` online first and then queues the replacement `process_checkout` locally in Dexie. If the browser crashes, loses power, or is closed between `process_reversal` succeeding and the replacement checkout being queued, the original sale is already reversed on the server while the unsaved replacement items remain in the cart.
- **Return payment method**: Sales recorded with `paymentMethod = 'return'` do not create finance ledger entries (a dedicated Refund flow is tracked separately out of scope).
