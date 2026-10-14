# Release R1: your steps (about 30 minutes)

R1 brings:

- **Instant screen updates on every device.** A sale, stock change, product, customer or expense change shows on all devices within about 2 seconds, with no reload.
- **A smooth cashier workflow.** A cashier never sees a button that would fail, and errors are plain sentences.
- **Shop-to-Shop Stock Transfer.**
- **A database security update (0.3).**
  - Deleting a product or customer archives it, so it can be recovered.
  - Logs and udhaar history can't be changed.
  - Deleting a sale restores exactly what it took.
  - Cashiers see the shop name on invoices.

Do it **when the shop is closed**, **in this order**. Paste every result back to Claude.

---

### Part 1: database (Supabase → SQL Editor → New query, for each file)

1. **Everything synced.** On every phone or PC that sells, open VapeTrax online and wait until the bottom-right badge shows **nothing waiting**.
2. **Backup.** Run `supabase/ops/snapshot_public.sql`. The result must say `"all_counts_match": true`.
3. **Security update.** Run `supabase/migrations/20261012100000_lockdown_followup.sql` **once**. Every row in the result table must say **true**.
   - If it shows an error instead, nothing was changed. Paste the error to Claude.
4. **Checks.** Run each of these; each must end with **ALL TESTS PASSED**:
   - `supabase/tests/00_lockdown_smoke.sql`
   - `supabase/tests/01_legacy_rpc_smoke.sql`

   Then run `supabase/diagnostics/verify_20261012100000.sql`. It must say `all_checks_passed: true`.
5. **Transfers.** Run `supabase/migrations/20261012200000_shop_links_and_transfers.sql` **once**. Every row must say **true**. Then run `supabase/diagnostics/verify_20261012200000.sql`, which must also say `all_checks_passed: true`.

### Part 2: app

6. **Deploy.** Run:
   ```bash
   git push zain_repo release/r1:main
   ```
   When Vercel says **Ready**, open VapeTrax on each device. It asks to **Reload** once it's idle; tap it.

### Part 3: quick tests

7. **Two devices** (for example a laptop and a phone, both logged in):
   - Sell on the phone. The sale appears in the laptop's Sales History, and the stock drops, within about 2 seconds.
   - Add stock to a product on the laptop. The phone shows the new stock within about 2 seconds.
   - Turn the phone's Wi-Fi off, sell 1 item, then turn it back on. The badge goes to 0, and the stock went down **once**.
8. **Second shop and a transfer:**
   1. In a private browser window, **sign up a new account**. This is shop 2.
   2. In shop 2, go to **Settings** and set its **Shop Name**.
   3. In shop 1: **Shop Transfers → Generate link code**. In shop 2: **Shop Transfers → Link with a code**, and type the code. The code works once, for 30 minutes.
   4. In shop 1: **New transfer** → pick shop 2 → add 1 device and 1 sealed e-liquid bottle → **Check transfer** → **Confirm transfer**.
   5. Check:
      - shop 1's stock went down;
      - shop 2's stock went up;
      - both shops list the transfer under **History**;
      - Inventory Logs show `transfer_out` in shop 1 and `transfer_in` in shop 2;
      - trying to send more than you have is refused.
9. **Optional cashier:** in **Settings → Cashiers**, add a cashier and log in as them on a phone. They can sell, add customers, take udhaar payments and add expenses. They can't delete sales or change products or stock. Invoices show your shop name.

### Part 4: optional checks for lost sales (read-only)

10. Run these and paste the results to Claude. If they list sales, Claude will help you ring them again.
    - `supabase/diagnostics/09_lost_edits_before_update.sql`: sales the old "Edit" button may have lost.
    - `supabase/diagnostics/08_lost_sales.sql`

---

**If anything looks wrong after step 6:** in Vercel, open **Deployments** → the previous deployment → **⋯** → **Instant Rollback**. The database steps are safe to keep: the previous app version works with them.
