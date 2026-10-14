# VapeTrax: Step-by-Step Remediation Plan

*Final plan, revision 2. Generated 2026-10-11 on branch `fix/audit-remediation`. It covers **all 250 audit findings**, plus the owner's requirements: multi-owner / multi-shop SaaS with Shop-to-Shop Stock Transfer, never-negative stock, and 0.5 ml refill steps.*

> **How this plan works**
> - Each step is one reviewable commit.
> - Database changes are SQL files the owner pastes into the Supabase SQL Editor, followed by a verify script.
> - App changes go live only when the owner pushes (Vercel deploys from `zain_repo/main`).
> - Every migration is rehearsed on a local Postgres copy of the live database before the owner sees it.

## Phases at a glance

| Phase | What you get | Steps | Rough effort |
|---|---|---|---|
| 0 | Emergency security and data safety (database locked down, backups complete, dangerous buttons disabled, stock and refill rules) | 10 | ~16 days |
| 1 | Foundations: clean repo, real type checking, automated tests, CI, error handling everywhere | 11 | ~16.5 days |
| 2 | Multi-shop database: owners → shops → staff, role-based security, ledgers, server commands, reports past 1,000 rows | 9 | ~28 days |
| 3 | Offline sync rebuilt: reliable outbox, no lost or doubled sales, live refresh, proper offline login | 4 | ~14 days |
| 4 | App fixes and UX: receipts, void/return, stock with reasons, dashboard and reports, accessibility, PWA | 13 | ~34.5 days |
| 5 | Multi-shop screens and **Shop-to-Shop Stock Transfer** | 3 | ~10 days |
| 6 | Retire old code paths, strict typing, documentation | 5 | ~8.5 days |

Total: **55 steps, roughly 128 working days** (S ≈ ½ day, M ≈ 2 days, L ≈ 4 days). This is a rough guide; owner actions and live checks add time between releases.

## Progress tracker

**Phase 0: Emergency security (baseline, lockdown follow-up, R0 hotfix)**

- ✅ **0.0** Baseline already in place (record only, no commit) *(effort S)*
- ⬜ **0.1** Remove remaining secrets, personal data, dangerous SQL and risky scripts from HEAD *(effort S)*
- ⬜ **0.2** Integrity probe, snapshot op, migration log and PGlite rehearsal harness *(effort M)*
- ⬜ **0.3** Migration 20261012100000_lockdown_followup (delta on the applied lockdown) *(effort L)*
- ⬜ **0.4** R0a: sync queue remainder, Dexie versionchange guard, backup count check *(effort M)*
- ⬜ **0.5** R0b: complete offline cache and interim report paging *(effort M)*
- ⬜ **0.6** R0c: auth without admin fallback, minimal offline session, request telemetry, checkout and udhaar safety *(effort M)*
- ⬜ **0.7** R0d: safe Stock and Sales actions, Edit and remove-item paused, prompted updates; R0 release *(effort M)*
- ⬜ **0.8** Git history purge and canonical remote (owner-confirmed; no commit) *(effort S)*
- 🟡 **0.9** Owner's rules: stock never below zero, refills only in 0.5 ml steps, whole-rupee prices *(effort S)*

**Phase 1: Foundations (client release R1)**

- ⬜ **1.1** Encoding normalisation (UTF-8, LF, no BOM, no mojibake) *(effort S)*
- ⬜ **1.2** Supabase folder: archive legacy SQL, conventions, SQL test prelude in the rehearsal *(effort S)*
- ⬜ **1.3** Repo cleanup: Firebase and AI Studio leftovers, dead modules, docs to history *(effort S)*
- ⬜ **1.4** Dependencies, package metadata and scripts *(effort M)*
- ⬜ **1.5** TypeScript foundation: React types, tsconfig split, typed Supabase client, env validation *(effort M)*
- ⬜ **1.6** ESLint and Prettier with a one-time format commit *(effort S)*
- ⬜ **1.7** Vitest and domain core: money, dates, payments, product, business-rule fallbacks *(effort M)*
- ⬜ **1.8** CI pipeline and repository policy files *(effort S)*
- ⬜ **1.9** Playwright harness with a hermetic Supabase mock and legacy-behaviour e2e *(effort M)*
- ⬜ **1.10** Domain part 2: bottles, cart, inventory log, import parser, checkout extraction, clean bottleSize writes *(effort L)*
- ⬜ **1.11** Error toolkit, checked writes, error boundaries, logging, interim compare-and-set for stock and credit *(effort M)*

**Phase 2: Multi-tenant data model and server command layer**

- ⬜ **2.1** Migration 20261020100000_tenancy: organizations, shops, memberships, invites, links, shop management *(effort L)*
- ⬜ **2.2** Migration 20261020110000_rls_by_role: gate R0, role-aware policies, sales writes revoked *(effort M)*
- ⬜ **2.3** Migration 20261027100000_schema_hardening (+ optional 20261027100100_repair_sale_dates) *(effort L)*
- ⬜ **2.4** Migration 20261103100000_ledgers_and_documents *(effort L)*
- ⬜ **2.5** Migration 20261103110000_sale_commands: checkout, void, edit, return; legacy translators *(effort L)*
- ⬜ **2.6** Migration 20261103120000_reconcile_bottles (required) *(effort M)*
- ⬜ **2.7** Migration 20261110100000_stock_party_commands: products, stock, bottles, import, customers, udhaar, expenses *(effort L)*
- ⬜ **2.8** Migration 20261110110000_sync_support: delta pull, sync signals, dead letters, devices, health *(effort M)*
- ⬜ **2.9** Migration 20261110120000_reports: business-day reports, history search, cross-tenant test *(effort M)*

**Phase 3: Sync redesign (client release R2)**

- ⬜ **3.1** Command client, contracts and server handshake *(effort M)*
- ⬜ **3.2** Dexie v2 outbox, standalone sync worker and Sync Center (replaces SyncEngine) *(effort L)*
- ⬜ **3.3** Delta pull, pending-effects overlay, realtime via sync_signals, local sales history *(effort L)*
- ⬜ **3.4** Tenancy-aware auth: membership cache, onboarding, invites, team, logout rules *(effort L)*

**Phase 4: Frontend refactor, bug and UX fixes (client releases R3a-R3d)**

- ⬜ **4.1** Shared accessible UI kit and accessibility migration *(effort L)*
- ⬜ **4.2** App shell: lazy routes, layout route, role guards, code splitting, responsive layout, busy guard *(effort M)*
- ⬜ **4.3** PWA and deployment hardening: icons, manifest, install prompt, idle updates, Vercel headers *(effort M)*
- ⬜ **4.4** Query layer (TanStack Query), repositories, QueryState and shared shop settings *(effort L)*
- ⬜ **4.5** POS feature split, checkout v2 builder, replace mode, per-shop rates in the POS *(effort L)*
- ⬜ **4.6** Receipt printing (58/80 mm thermal) and correct invoices *(effort M)*
- ⬜ **4.7** Sales history split: void, return, bulk void, cashier attribution *(effort L)*
- ⬜ **4.8** Products and stock on commands: metadata form, delta adjustments with reasons, counts, archive, import wizard *(effort L)*
- ⬜ **4.9** Customers, udhaar, parties and expenses on commands *(effort M)*
- ⬜ **4.10** Dashboard and alerts on report RPCs *(effort M)*
- ⬜ **4.11** Detailed Reports and Inventory Logs on report RPCs *(effort M)*
- ⬜ **4.12** Settings split: every field wired or removed, per-shop rates tab, complete backup export *(effort M)*
- ⬜ **4.13** Auth hardening: password policy, recovery flow, server-enforced sensitive actions *(effort S)*

**Phase 5: Multi-shop UI and shop-to-shop stock transfers (release R4)**

- ⬜ **5.1** Migration 20261124100000_catalog_and_transfers *(effort L)*
- ⬜ **5.2** Multi-shop management UI: shop switcher, shops, links, catalog cloning *(effort M)*
- ⬜ **5.3** Shop-to-shop transfer screens *(effort L)*

**Phase 6: Contract, legacy removal and documentation**

- ⬜ **6.1** Migration 20261215100000_contract_lockdown (gate A) *(effort M)*
- ⬜ **6.2** Migration 20261215110000_legacy_cleanup: type conversions, remaining constraints, drops *(effort M)*
- ⬜ **6.3** Migration 20270115100000_retire_legacy_rpcs and removal of client legacy paths (gate B) *(effort S)*
- ⬜ **6.4** Strict TypeScript completion, zero-any lint ratchet, CSP enforcement *(effort M)*
- ⬜ **6.5** Documentation: README, architecture, AI-assistant guide, ADRs, release checklist, backlog *(effort M)*

## What the owner needs to do

Everything else is done in code. These are the moments your action is needed:

- **0.0** Baseline already in place (record only, no commit)
  - None to run. Confirm that the 2026-10-11 run of verify_20261011120000.sql returned all_checks_passed = true, and that Vercel production builds from zain_repo/main (currently c65dde5).
- **0.1** Remove remaining secrets, personal data, dangerous SQL and risky scripts from HEAD
  - Confirm the old sb_secret_ key is revoked: Dashboard > Project Settings > API Keys shows it revoked, and a request with it returns 401.
  - Review Auth and API logs since 2026-09-30 for service-role traffic and report anything unusual.
  - Confirm both GitHub repositories (origin = zarrarmalik78/VapeTrax-Supabase, zain_repo = ZainMal3125/Vape-Trax-Supabase) are private.
  - Name the remote and branch Vercel builds production from (the c65dde5 redeploy suggests zain_repo/main). Both remotes fast-forward to this branch.
  - Keep a backed-up copy of the local private/ folder (spreadsheet, parser output, unredacted script).
- **0.2** Integrity probe, snapshot op, migration log and PGlite rehearsal harness
  - Paste supabase/diagnostics/06_integrity_probe.sql into Dashboard > SQL Editor, run it, and paste the JSON back. It contains no personal data.
  - Run supabase/ops/snapshot_public.sql and paste back the printed row counts.
  - Tell us:
- the Supabase plan (Free or Pro, and whether PITR or backups exist);
- whether Auth > Confirm email is on;
- whether Google sign-in is enabled;
- how many devices or browsers run the POS;
- whether public sign-ups are needed right now (the shop has no cashiers).
  - From the Table Editor, export CSV copies of sales, products, customers, credits and bottles as an off-database backup.
  - Compare the Firestore collection counts (migration-log.json or the Firebase console) with the live counts. suppliers and purchases are 0 live, and profiles were re-created. Export Firestore before it is decommissioned, and say whether supplier or purchase data must be re-imported (that goes to the backlog).
- **0.3** Migration 20261012100000_lockdown_followup (delta on the applied lockdown)
  - (We confirm first that npm run sql:rehearse is green for this file.)
  - Ask every POS device to come online until its sync badge shows 0 pending.
  - Run supabase/ops/snapshot_public.sql immediately before.
  - During closed hours, paste 20261012100000_lockdown_followup.sql into the SQL Editor, run it once (it is all-or-nothing), and paste back the validation table.
  - Run supabase/tests/00_lockdown_smoke.sql and 01_legacy_rpc_smoke.sql and paste their result lines. They roll back and leave no data.
  - Smoke test on the deployed app using one designated test product only:
- note its stock;
- ring one online and one offline cash sale on it;
- reconnect and confirm each sale appears once;
- delete both sales from Sales History and confirm the stock is back to the noted value;
- record the sale ids in MIGRATIONS_LOG.md.
Cashier checks run only in the rehearsal, because the live shop has no cashier.
  - Fill in MIGRATIONS_LOG.md for this file.
- **0.4** R0a: sync queue remainder, Dexie versionchange guard, backup count check
  - None until the R0 release in step 0.7.
- **0.5** R0b: complete offline cache and interim report paging
  - None until the R0 release in step 0.7. Then run supabase/ops/check_month_total.sql for one past month and paste the total.
- **0.6** R0c: auth without admin fallback, minimal offline session, request telemetry, checkout and udhaar safety
  - None until the R0 release in step 0.7.
- **0.7** R0d: safe Stock and Sales actions, Edit and remove-item paused, prompted updates; R0 release
  - Approve pushing the branch as a fast-forward of the named Vercel remote, and deploying R0. Do this only after 20261012100000 has been validated.
  - Smoke-test the Vercel preview with the checklist in the commit message, using only the designated test product (preview writes go to the production database). Delete the test sales afterwards and record their ids.
  - Ask staff to open every POS device once.
  - After 7 days, run supabase/ops/gate_r0.sql and paste the result.
- **0.8** Git history purge and canonical remote (owner-confirmed; no commit)
  - Confirm in writing that force-pushing both remotes is approved, and name the canonical remote connected to Vercel.
  - Tell every collaborator to re-clone after the push.
  - Enable GitHub secret scanning with push protection on the canonical repository.
- **0.9** Owner's rules: stock never below zero, refills only in 0.5 ml steps, whole-rupee prices
  - Optional: run 06_negative_stock_history.sql and paste the result, to see when and how stock went negative.
  - Deploy the app first: run `git push zain_repo fix/audit-remediation:main`.
  - Fully close and reopen VapeTrax on every phone/PC (the refill window must show the new -/+ 0.5 ml buttons).
  - Check that the sync panel shows nothing waiting, then paste the migration into the SQL Editor and run verify_20261011140000.sql.
- **1.5** TypeScript foundation: React types, tsconfig split, typed Supabase client, env validation
  - Decide how types are refreshed after each migration: download them from Dashboard > API Docs, provide a personal access token so npx supabase gen types can run, or keep the hand-maintained overrides.
- **1.8** CI pipeline and repository policy files
  - When pushing is allowed, enable branch protection on main (require CI and pull requests) and Dependabot alerts on the canonical repository.
- **1.9** Playwright harness with a hermetic Supabase mock and legacy-behaviour e2e
  - Optional: create a free staging Supabase project for rehearsing migrations against real PostgREST and Auth, and add E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY secrets.
- **1.11** Error toolkit, checked writes, error boundaries, logging, interim compare-and-set for stock and credit
  - Optional: create a free Sentry project and set VITE_SENTRY_DSN in Vercel.
  - Approve deploying R1 (steps 1.1-1.11) after the preview checklist. It needs no database change.
- **2.1** Migration 20261020100000_tenancy: organizations, shops, memberships, invites, links, shop management
  - Run supabase/diagnostics/05_find_users.sql again and paste the result, so the expected counts in the file are current.
  - (We confirm first that sql:rehearse is green.)
  - Ask devices to sync to 0 pending, run ops/snapshot_public.sql, then run 20261020100000_tenancy.sql during closed hours. Paste back the validation table, including any suspended orgs.
  - Choose the org signup mode (code is recommended until onboarding ships in R2) and the default maxShops (proposed: 3).
  - Optional: turn off public sign-ups in Supabase Auth until R2. This also blocks the legacy add-cashier sign-up; the shop has no cashiers today.
  - Run tests/dist/02_tenancy_smoke.sql and paste the result.
  - On the deployed app, confirm the owner can log in, sell, and still sees Settings, Dashboard and Reports.
- **2.2** Migration 20261020110000_rls_by_role: gate R0, role-aware policies, sales writes revoked
  - Run supabase/ops/gate_r0.sql and paste the result. Confirm in writing that every POS device has been opened since R0.
  - (We confirm first that sql:rehearse is green.)
  - Run the snapshot, then 20261020110000_rls_by_role.sql in a quiet period. Paste the validation table and the 03_rls_matrix result.
  - On the deployed app, make a sale, add a customer, receive a payment, add an expense, edit a product and delete a sale. Report anything blocked.
- **2.3** Migration 20261027100000_schema_hardening (+ optional 20261027100100_repair_sale_dates)
  - (We confirm first that sql:rehearse is green, including the replay of old Stock-form payloads.)
  - Ask devices to sync, run the snapshot, then run 20261027100000_schema_hardening.sql during closed hours. Paste the validation table, which lists: CHECKs not added and their violators, renamed duplicate products, duplicate customer phones, tombstones created, orphan bottles removed, and unparseable timestamps.
  - Decide how duplicate customer phones should be resolved (merge, keep both, or clear one).
  - Run only the PREVIEW section of 20261027100100_repair_sale_dates.sql. Approve the apply section only if it reports affected rows.
  - Spot-check on the deployed app: edit a device and an e-liquid product, edit a customer and an expense, record an 'others' udhaar entry, and check the dashboard figures.
- **2.4** Migration 20261103100000_ledgers_and_documents
  - (We confirm first that sql:rehearse is green.)
  - Ask devices to sync to 0 pending, run the snapshot, then run this file during closed hours, immediately followed by 2.5 and 2.6 in the same session. Paste the validation table and the 05_ledger_smoke result.
  - Review the credit reconciliation list (stored balance versus derived history) and say which mismatches need an explained adjustment entry (ops/credit_adjustment.sql).
- **2.5** Migration 20261103110000_sale_commands: checkout, void, edit, return; legacy translators
  - Run this file in the same closed-hours session, right after 2.4 validates. Paste the validation table and the 06 and 01 results.
  - Decide the cashier price-override policy (default: allowed, with the list price recorded) and whether cashiers may backdate (default: 0 days). Both are per-shop settings.
  - On the deployed app, using only the designated test product: an offline sale syncs; deleting a sale makes it disappear; trying to edit a bill shows an 'update required' error (Edit is hidden since R0).
- **2.6** Migration 20261103120000_reconcile_bottles (required)
  - Run the PREVIEW section, review the planned changes, then run the APPLY section in the same session as 2.4 and 2.5. Paste the validation table.
- **2.7** Migration 20261110100000_stock_party_commands: products, stock, bottles, import, customers, udhaar, expenses
  - (We confirm first that sql:rehearse is green.)
  - Run 20261110100000_stock_party_commands.sql and paste the validation table and the 07 result.
  - Decide whether a udhaar payment above the balance is kept as an advance (default: yes, with a warning and a flag).
- **2.8** Migration 20261110110000_sync_support: delta pull, sync signals, dead letters, devices, health
  - (We confirm first that sql:rehearse is green.)
  - Run 20261110110000_sync_support.sql and paste the validation table and the 08 result.
- **2.9** Migration 20261110120000_reports: business-day reports, history search, cross-tenant test
  - (We confirm first that sql:rehearse is green.)
  - Run 20261110120000_reports.sql and paste the validation table and the 09 and 99 results.
  - Compare one past day's report_dashboard totals with your paper or Excel record and report any difference.
  - Confirm that 03:00 Asia/Karachi is the right business-day start.
- **3.4** Tenancy-aware auth: membership cache, onboarding, invites, team, logout rules
  - Approve the R2 deploy (steps 3.1-3.4) only after every Phase 2 migration is applied (schemaVersion 10). Otherwise the app pauses syncing behind a banner.
  - Create one invite for a test cashier account and confirm joining works end to end.
  - Tell staff that new cashiers join by invite code.
  - After a week, check Sync Center > Sync health and confirm every POS device shows the R2 build.
- **4.3** PWA and deployment hardening: icons, manifest, install prompt, idle updates, Vercel headers
  - Provide the real shop or brand logo (square SVG or 512x512 PNG), or approve the generated wordmark.
  - After the deploy, check the preview response headers and the console for CSP report-only violations for one release.
- **4.4** Query layer (TanStack Query), repositories, QueryState and shared shop settings
  - Approve deploying R3a (steps 4.1-4.4) after the preview checklist.
- **4.6** Receipt printing (58/80 mm thermal) and correct invoices
  - Tell us the receipt printer model, the paper width, and whether printing is from Android or Windows. Then test-print one receipt.
- **4.7** Sales history split: void, return, bulk void, cashier attribution
  - Approve deploying R3b (steps 4.5-4.7). Then show staff the new Void, Return and Edit flows and the receipt button.
- **4.9** Customers, udhaar, parties and expenses on commands
  - Approve deploying R3c (steps 4.8-4.9).
- **4.10** Dashboard and alerts on report RPCs
  - Compare one day's Dashboard totals with your cash count for that day and report any difference.
- **4.12** Settings split: every field wired or removed, per-shop rates tab, complete backup export
  - Review the per-shop rates in Settings > Rates and correct them.
  - Download a fresh backup after this release and keep it off the device.
- **4.13** Auth hardening: password policy, recovery flow, server-enforced sensitive actions
  - Apply the listed Auth settings in the Supabase dashboard. Do not enable CAPTCHA.
  - Approve deploying R3d (steps 4.10-4.13).
- **5.1** Migration 20261124100000_catalog_and_transfers
  - (We confirm first that sql:rehearse is green.)
  - Ask devices to sync to 0 pending and run the snapshot. Run the file during closed hours: the catalogItemId backfill updates every product row. Paste the validation table and the 10 and 99 results.
  - Confirm the transfer rules:
- one-step atomic transfer;
- allowed for the owner or a user who is admin or manager in both shops;
- the shops must be linked;
- stock moves at the sender's average cost;
- the receiver keeps its own prices;
- new receiver products copy the sender's price for review;
- the sender never goes negative.
- **5.2** Multi-shop management UI: shop switcher, shops, links, catalog cloning
  - Deploy only after 20261124100000 is validated.
  - Create the second shop (or have its owner sign up with a code from ops/create_org_signup_code.sql), clone the catalog, set its prices and rates, and link the two shops.
- **5.3** Shop-to-shop transfer screens
  - Approve deploying R4 (steps 5.2-5.3).
  - Do one small real transfer, then compare both shops' stock and stock history with a physical count.
- **6.1** Migration 20261215100000_contract_lockdown (gate A)
  - Run ops/gate_contract.sql and paste the result. Continue only if it passes.
  - Ask all staff to confirm the app shows the current version.
  - (We confirm first that sql:rehearse is green.) Run the snapshot, then this file, and paste the validation table and the 11_contract_smoke result.
- **6.2** Migration 20261215110000_legacy_cleanup: type conversions, remaining constraints, drops
  - Confirm the keep-or-drop decision for every legacy table that still has rows.
  - (We confirm first that sql:rehearse is green.) Run the snapshot, then this file, and paste the validation table.
- **6.3** Migration 20270115100000_retire_legacy_rpcs and removal of client legacy paths (gate B)
  - Run ops/gate_retire_legacy.sql and paste the result. Continue only if it passes.
  - (We confirm first that sql:rehearse is green.) Run this file, paste the validation table, then approve deploying the client change.
- **6.4** Strict TypeScript completion, zero-any lint ratchet, CSP enforcement
  - Confirm that no CSP violations were reported on the previous release, then approve the deploy.
- **6.5** Documentation: README, architecture, AI-assistant guide, ADRs, release checklist, backlog
  - Review docs/BACKLOG.md and set priorities for the next round.

## Phases in detail

### Phase 0: Emergency security (baseline, lockdown follow-up, R0 hotfix)

**Goal:** Build on the baseline already applied and deployed. Remove the remaining secrets, personal data and dangerous SQL from HEAD. Capture the open live-state questions and commit the rehearsal harness. Close the remaining database exposure with a defensive delta migration. Ship R0: it makes the sync queue safe, makes the offline cache and reports complete, stops the admin fallback, keeps offline users signed in, and hides destructive actions.

**Done when:** Step 0.0 is confirmed. 06_integrity_probe output and a snapshot are captured. 20261012100000_lockdown_followup is rehearsed green, applied, and every validation row (including the real-user check) is ok. Both smoke tests print ALL TESTS PASSED. R0 is pushed as a fast-forward of the Vercel remote, the production deployment shows that SHA, and gate_r0.sql is collecting builds. The owner has made a recorded decision on the history purge.

#### ✅ Step 0.0: Baseline already in place (record only, no commit)

*Effort S*

Record what is already done, as preconditions for every later step. Nothing in this step changes code or data.

**bbfa2df: supabase/migrations/20261011120000_emergency_security_lockdown.sql** (applied by the owner; verify_20261011120000.sql reported every check passed).
- Schema private (USAGE for authenticated only) with private.is_shop_member(uuid).
- Anon revoked on tables, sequences and functions, including default privileges.
- profiles: RLS on, with select/insert_self/insert_cashier/update/delete policies; role and shopId are not updatable (column grants).
- inventory_alerts: allow-all policies replaced by inventory_alerts_shop.
- updatedAt added to profiles and expenses.
- process_checkout, process_reversal and process_stock_adjustment (text) are membership-checked, shop-scoped and use search_path ''. Checkout returns early on a replayed sale id. Reversal with delete = true is safe against double deletes. The uuid adjustment overload is dropped. Both legacy RPCs still return void.

**62148ab:** the test shop 158a7adf, its cashier and an unconfirmed account were deleted. Live is now one shop (c7587ec2-753c-4767-a9f3-8bcf6b30e685), one account and 0 cashiers. The committed script contains four email addresses (handled in 0.1 and 0.8).

**1c186d6:**
- Paged, ordered backup of every shop table, including settings and personal_expenses, with _meta counts.
- Restore disabled.
- Queue backoff from 5 s to 5 min, with a useRef single-run guard.
- Clear queue is admin-only, needs a typed DELETE and downloads a copy first.
- createCashier restores the admin session before inserting the profile and reports a failed link.
- migrate.js reads its key from the environment.

**c65dde5:** an empty commit that pushed all of the above to zain_repo/main and redeployed. The deployed client is therefore most likely the 1c186d6 code, and the old service worker force-reloads devices onto it.

**Key:** the owner revoked the leaked sb_secret_ key.

**Findings already fixed:**
- By 20261011120000:
  - SEC-2, DB-3: no self-escalation.
  - SEC-3, DB-2: the live effect is reverted. The UTF-16 files themselves are deleted in 0.1 under HYG-2.
  - SEC-4, SEC-5, SEC-6, DB-4, FIN-1, SYNC-1: authorization and shop scoping.
  - SEC-9: inventory_alerts.
  - SEC-19: every app function sets search_path. Supabase's rls_auto_enable is excluded from later checks.
  - DB-9: replay-safe checkout.
  - FE-14: updatedAt columns.
- By 1c186d6:
  - SEC-10, FE-1, PERF-1, FIN-9, DB-10, UX-7: complete export, restore disabled.
  - UX-5: no cashier can discard. Per-item discard follows in 0.4.
  - GAP2-5: restore can no longer rewrite the audit trail.

SEC-11 is only partly fixed here (session restore). The rest arrives with invites in 3.4.

**Migrations:**
- 20261011120000_emergency_security_lockdown.sql - already applied and verified live on 2026-10-11 (no action)

**Files:** `supabase/migrations/20261011120000_emergency_security_lockdown.sql`, `supabase/diagnostics/verify_20261011120000.sql`, `supabase/diagnostics/live-snapshot-2026-10-11.md`, `supabase/diagnostics/05_find_users.sql`, `src/lib/backup.ts`, `src/components/settings/BackupRestoreTab.tsx`, `src/components/sync/SyncEngine.tsx`, `src/contexts/AuthContext.tsx`, `src/lib/db.ts`

**Owner actions:**
- None to run. Confirm that the 2026-10-11 run of verify_20261011120000.sql returned all_checks_passed = true, and that Vercel production builds from zain_repo/main (currently c65dde5).

**Verification:** git log shows bbfa2df, 62148ab, 1c186d6 and c65dde5 on fix/audit-remediation and zain_repo/main. The recorded verify output is all true. 05_find_users.sql (re-run in 2.1) lists exactly one account, c7587ec2, and no cashiers.

**Fixes findings:** SEC-2, SEC-3, SEC-4, SEC-5, SEC-6, SEC-9, SEC-19, DB-2, DB-3, DB-4, DB-9, FIN-1, SYNC-1, FE-14, SEC-10, FE-1, PERF-1, FIN-9, DB-10, UX-5, UX-7, GAP2-5

#### ⬜ Step 0.1: Remove remaining secrets, personal data, dangerous SQL and risky scripts from HEAD

*Effort S · depends on 0.0*

1. Delete migrate.js. It now reads the key from the environment, but it is still a re-runnable writer to production, and the revoked key stays in history until 0.8.
2. Delete test_sale.js, which inserts a fake sale with the anon key.
3. Delete supabase/fix-rls.sql and supabase/grants.sql. They are UTF-16, and re-running either one in the SQL Editor disables RLS on profiles and settings and grants ALL to anon, reopening SEC-3. The commit message records that they remain in history and are superseded by 20261011120000.
4. Move 'VapeTrax_Business_Lodhran (1).xlsx' and temp_excel_parser/ (result.json has personal names) into a new gitignored private/ folder, then git rm --cached them.
5. supabase/scripts/2026-10-11_delete_test_shop_and_users.sql:
   - move the original, which holds four email addresses and user uuids, to private/;
   - commit a redacted copy, with emails replaced by <account-1..3> and the main shop's email removed, keeping the guards and a note of the run date, so the record of an executed destructive script stays in the repo.
   - 05_find_users.sql and live-snapshot-2026-10-11.md contain uuids but no emails or names, so they stay.
6. Untrack supabase/.temp/ (linked project identifiers).
7. Remove the dead GEMINI_API_KEY define from vite.config.ts.
8. Extend .gitignore with: private/, *.xlsx, *.xls, temp_*/, supabase/.temp/, .firebase/, *.bak, playwright-report/, test-results/, coverage/, migration-*.json, firebase-admin-key.json, .obsidian/workspace*.json.
9. Run git grep checks for secrets and emails.

The emails also remain in pushed history on zain_repo (62148ab), so the 0.8 purge path list includes the script.

**Files:** `migrate.js`, `test_sale.js`, `supabase/fix-rls.sql`, `supabase/grants.sql`, `VapeTrax_Business_Lodhran (1).xlsx`, `temp_excel_parser/parser.js`, `temp_excel_parser/result.json`, `temp_excel_parser/package.json`, `temp_excel_parser/package-lock.json`, `supabase/scripts/2026-10-11_delete_test_shop_and_users.sql`, `supabase/.temp/linked-project.json`, `supabase/.temp/cli-latest`, `vite.config.ts`, `.gitignore`

**Owner actions:**
- Confirm the old sb_secret_ key is revoked: Dashboard > Project Settings > API Keys shows it revoked, and a request with it returns 401.
- Review Auth and API logs since 2026-09-30 for service-role traffic and report anything unusual.
- Confirm both GitHub repositories (origin = zarrarmalik78/VapeTrax-Supabase, zain_repo = ZainMal3125/Vape-Trax-Supabase) are private.
- Name the remote and branch Vercel builds production from (the c65dde5 redeploy suggests zain_repo/main). Both remotes fast-forward to this branch.
- Keep a backed-up copy of the local private/ folder (spreadsheet, parser output, unredacted script).

**Verification:** These pass:
- git ls-files lists none of the removed or moved paths;
- git check-ignore private/x succeeds;
- git grep -nE 'sb_secret_|service_role|eyJhbGci' returns nothing;
- git grep -nE '@(gmail|yahoo|hotmail|outlook)\.com' returns nothing;
- npm run build passes.

**Fixes findings:** SEC-1, DB-1, HYG-1, HYG-2, HYG-12, SEC-22

#### ⬜ Step 0.2: Integrity probe, snapshot op, migration log and PGlite rehearsal harness

*Effort M · depends on 0.1*

Diagnostics 01-05 and live-snapshot-2026-10-11.md are committed and reused. This step adds only what the snapshot leaves open, plus the tooling every later migration needs.

(1) supabase/diagnostics/06_integrity_probe.sql is read-only, returns one JSON cell and contains no personal data. It reports:
- the md5 and markers of every public function body, confirming the 20261011120000 bodies are live, plus the full rls_auto_enable definition;
- relforcerowsecurity and the current policies (name, cmd, roles) per table;
- products.bottleSize value classes by category: numeric, '', null, with 'ml', other. 2.3 needs this;
- bottles: remainingMl > bottleSize, negative ml, status distribution, orphan or cross-shop bottles, and e-liquid stockQuantity versus active bottle ml (mismatch count and total);
- raw category, paymentMethod and saleType values with case and whitespace variants;
- non-uuid ids per table (Firestore style), and sales.items lines without productId;
- sales.items line keys present (bottleChanges, refillMl, costPrice) with counts, for the 2.4 backfill;
- sales and credits pointing at missing customers;
- 'others' credits grouped by lower(btrim(entityName));
- the stored creditBalance versus the derived balance (mismatch count);
- money values with more than 2 decimals, per column;
- the count of sales where saleDate differs from try-parsed saleDateClient (Firestore JSON aware) by more than 10 minutes. About 0 is expected;
- duplicate product keys and customer phones (counts);
- users and profiles counts, providers in use and unconfirmed users.

(2) supabase/ops/snapshot_public.sql: a standalone DO block that copies every public table, plus auth.users(id, email, created_at), into app_backup_YYYYMMDD_HH24MI, revokes all privileges on it, and prints row counts.

(3) supabase/MIGRATIONS_LOG.md: a table of file, date applied, validation result and test-sale ids. The first row is 20261011120000 (applied 2026-10-11, verify all true).

(4) supabase/rehearsal/: commit the PGlite harness that verified 20261011120000.
- replica.sql: schema only, from scratchpad/pgcheck/live_before.sql. It has roles anon, authenticated and service_role; an auth schema with auth.uid() reading request.jwt.claim.sub; auth.users with created_at; an extensions schema exposing uuid_generate_v5 through PGlite's uuid_ossp contrib; and an rls_auto_enable event-trigger stub.
- fixtures.sql: synthetic edge cases only. It covers 20-character Firestore-style ids on sales, products, customers and bottles; Firestore-JSON and Postgres-text *Client values; bottleSize '', '30ml', '30' and null; bottles with remainingMl > bottleSize; 'others' credits; and sales pointing at missing customers. It also includes captured v1 payloads from NewSale.handleCompleteSale and salesReversal.ts.
- run.mjs: applies supabase/migrations/*.sql in filename order twice (idempotency), then every supabase/tests/*.sql. It prints pass or fail and exits non-zero on any failure.
- tests/00_baseline.mjs: ported from test_lockdown.mjs (42 checks).
- Add @electric-sql/pglite as a devDependency and the npm script sql:rehearse.

(5) supabase/README.md:
- how to run diagnostics, snapshots and the rehearsal;
- the naming convention YYYYMMDDHHMMSS_name.sql;
- the rule that every migration passes sql:rehearse before it is sent to the owner.

**Files:** `supabase/diagnostics/06_integrity_probe.sql`, `supabase/ops/snapshot_public.sql`, `supabase/MIGRATIONS_LOG.md`, `supabase/rehearsal/replica.sql`, `supabase/rehearsal/fixtures.sql`, `supabase/rehearsal/run.mjs`, `supabase/rehearsal/tests/00_baseline.mjs`, `supabase/README.md`, `package.json`, `package-lock.json`

**Owner actions:**
- Paste supabase/diagnostics/06_integrity_probe.sql into Dashboard > SQL Editor, run it, and paste the JSON back. It contains no personal data.
- Run supabase/ops/snapshot_public.sql and paste back the printed row counts.
- Tell us:
- the Supabase plan (Free or Pro, and whether PITR or backups exist);
- whether Auth > Confirm email is on;
- whether Google sign-in is enabled;
- how many devices or browsers run the POS;
- whether public sign-ups are needed right now (the shop has no cashiers).
- From the Table Editor, export CSV copies of sales, products, customers, credits and bottles as an off-database backup.
- Compare the Firestore collection counts (migration-log.json or the Firebase console) with the live counts. suppliers and purchases are 0 live, and profiles were re-created. Export Firestore before it is decommissioned, and say whether supplier or purchase data must be re-imported (that goes to the backlog).

**Verification:** These pass:
- grep shows 06 has no insert, update, delete, alter, create, drop, grant or revoke outside comments, and its output parses as JSON;
- the snapshot schema's row counts match public;
- npm run sql:rehearse applies 20261011120000 twice on the replica and passes the 42 ported checks.

The probe answers are written into the 0.3 commit message and confirm 0.3's defensive branches: live function md5s, bottleSize classes, non-uuid id counts, bottle mismatches and the rls_auto_enable body.

#### ⬜ Step 0.3: Migration 20261012100000_lockdown_followup (delta on the applied lockdown)

*Effort L · depends on 0.2*

Write supabase/migrations/20261012100000_lockdown_followup.sql: one transaction, lock_timeout 5s, statement_timeout 5min, and fully defensive (to_regclass guards, loops over pg_policies, pg_proc and pg_class). It must pass npm run sql:rehearse before it goes to the owner.

DB-6 and SYNC-10 note: the live RPC already kept the client sale date; the overwrite exists only in the repo variants archived in 1.2. This file pins the behaviour with tests.

(0) Precondition and ledger.
- First statement: if to_regprocedure('private.is_shop_member(uuid)') is null then raise exception 'apply 20261011120000 first'.
- Create private.schema_migrations(version pk, name, appliedAt, note) and insert '20261011120000' as applied (on conflict do nothing).
- Create private.app_config (key, value jsonb) with schema_version = 1 and min_client_build = null.
- Create private.policy_snapshots, function_snapshots, repair_log, deleted_rows (table, rowId, shopId, row jsonb, deletedBy, deletedAt, clientBuild) and legacy_rpc_calls (day, shopId, fn, clientBuild default 'unknown', deviceId, calls).
- Helpers:
  - drop_all_policies, snapshot_policies, restore_policies, snapshot_functions;
  - restore_functions, which drops each function by its full signature before recreating it, because a return-type change rules out CREATE OR REPLACE;
  - require_migration(text[]), mark_migration;
  - client_build() (the x-client-build header, else 'unknown') and device_id();
  - try_parse_ts (ISO, Postgres text, Firestore {_seconds} JSON, epoch ms; exception-safe);
  - is_fresh_auth_user(uid): an auth user created in the last hour who has no profile;
  - require_client_build(): a pass-through until 2.8.
- private.legacy_shop_ids() returns uuid[] [auth.uid(), the caller's profiles.shopId], and is empty when auth.uid() is null.
- private.legacy_is_shop_admin(shop) is true when shop = auth.uid() and the caller's role is admin.
- Redefine private.is_shop_member(p) as p is not null and p = any(private.legacy_shop_ids()), so there is one membership source.

(1) Grants and RLS, re-asserted.
- RLS on every public table, relforcerowsecurity off, and anon has nothing.
- Revoke EXECUTE from public and anon on every non-extension public function except public.rls_auto_enable, which is excluded by name and event_trigger return type.

(2) profiles (locked by 20261011120000).
- profiles_insert_cashier additionally requires private.is_fresh_auth_user(id), so an admin can no longer claim an existing account. 1c186d6's createCashier inserts right after signUp, so it keeps working.
- A BEFORE UPDATE trigger rejects role or shopId changes by API callers, as defence in depth on top of the column grants.

(3) settings.
- SELECT for members (shopId = any(legacy_shop_ids())), so cashier invoices get branding.
- INSERT and UPDATE only for the shop admin (shopId = auth.uid()). No DELETE.

(4) Business tables.
- products, bottles, customers, sales and expenses: replace the legacy 'Shop access' FOR ALL policy with TO authenticated policies on shopId = any((select private.legacy_shop_ids())). The products, customers and bottles SELECT policies also hide archived rows.
- credits and inventory_logs: SELECT and INSERT only, plus a trigger rejecting UPDATE, DELETE and TRUNCATE (append-only).

(5) personal_expenses: admin-only (FOR ALL TO authenticated using and with check shopId = (select auth.uid())), not deny-all. It holds 14 live rows, and the backup exports it.

(6) Unused tables present (finance_accounts, finance_transactions, daily_summaries, stock_alerts, inventory_alerts, users, suppliers, purchases): drop every policy, including inventory_alerts_shop (drop policy if exists). With RLS on, that means deny-all. All are empty live.

(7) Additive fixes for the deployed client.
- Default gen_random_uuid()::text on every text-PK business table, so the old Stock page's bottle inserts and product-delete log start working.
- Add deletedAt, deletedBy and deleteReason to products and customers, and archivedAt to bottles.

(8) Delete safety. This is needed now, because the inventory_logs id default lets the old single-product delete reach products.delete() for the first time.
- SECURITY DEFINER BEFORE DELETE triggers on products, customers and bottles, active only when current_user = 'authenticated', set deletedAt and deletedBy (or archivedAt) and return NULL. PostgREST reports 0 rows and no error, which the deployed client treats as success. A queued sale can no longer reference a vanished row, and definer RPCs still see archived rows.
- Every other API delete copies OLD into private.deleted_rows.
- A transaction-local counter in the same triggers raises mass_delete_blocked (errcode PT422) when one API transaction deletes more than 25 rows. Definer RPCs are unaffected.

(9) Legacy RPCs. Snapshot functions under the label 'pre_20261012100000', then explicitly run drop function public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric) and drop function public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric). Recreate both with identical argument names: returns jsonb, SECURITY DEFINER, search_path '', schema-qualified names, EXECUTE revoked from public and anon and granted to authenticated.

process_checkout (delta over the applied body):
- Counts the call in legacy_rpc_calls. The build comes from the header, else p_sale_data->>'clientBuild', else 'unknown'.
- Returns {status: 'applied' or 'duplicate', saleId}.
- Locks all referenced products first: select ... where id = any(ids) and shopId = v_shop order by id for update. This prevents 40P01 deadlocks between devices.
- saleDate is the payload saleDate, else try_parse_ts(saleDateClient), else now(). A value more than 10 minutes in the future is clamped and logged to repair_log. Past dates are never rewritten. saleDateClient is stored verbatim.
- The credit increment is derived from paymentMethod ('credit' means totalAmount) and splitAmounts.credit, capped at totalAmount and never negative. p_credit_increment is ignored.
- inventory_logs rows are stamped server-side: shopId, createdBy = auth.uid(), actorName and actorRole from profiles, previousStock and newStock from the locked row, and refId = the full sale id.
- A product not found in this shop has its deduction, bottles and log skipped and is recorded in repair_log ('missing_product'). A missing customer's credit is recorded ('missing_customer'). The sale itself is always stored, never rejected.
- Bottles are upserted only when their product belongs to this shop. A newly created bottle id is logged ('bottle_created_at_checkout') for the 2.6 reconciliation.

process_reversal:
- Shop admin only (legacy_is_shop_admin). The deployed UI shows delete only to admins.
- Always deletes the stored sale (DELETE ... WHERE id AND shopId RETURNING *), whatever p_delete_sale says. Both deployed callers delete right after, and their own delete then affects 0 rows.
- When no row comes back, it returns {status: 'duplicate'} and restores nothing. This adds no new error path for old clients.
- Restorations are computed from the stored row:
  - stock from the items[] quantities (refill ml x qty, full-bottle size x qty);
  - bottles by delta from items[].bottleChanges: remainingMl += before - after, capped at bottleSize, with status recomputed, never the absolute 'before' snapshot;
  - credit from the stored payment fields.
- Client arrays and p_credit_decrement are ignored. Logs are stamped as above, and the call is counted.

process_stock_adjustment becomes a stub raising PT410 deprecated. Nothing enqueues it.

(10) mark_migration, notify pgrst, then the validation query (check, ok, detail):
- RLS is on for every table and relforcerowsecurity is off;
- anon has no table privilege and no EXECUTE;
- no policy uses true;
- every SECURITY DEFINER function except rls_auto_enable sets search_path;
- there is exactly one process_checkout, one process_reversal and one process_stock_adjustment;
- authenticated cannot UPDATE profiles.role or shopId;
- the real-user check: for each real profile (today only c7587ec2), impersonate it with set local role authenticated plus request.jwt.claims, and assert that its counts on products, bottles, customers, sales, expenses, credits, inventory_logs, settings and personal_expenses (14) equal what postgres sees for that shop. A mismatch raises and rolls everything back.

Tests: supabase/tests/00_lockdown_smoke.sql and 01_legacy_rpc_smoke.sql. Both run as begin ... rollback with throwaway users and shops. They use real payload shapes and a Firestore-style sale id, and they run in the rehearsal first.

**Migrations:**
- 20261012100000_lockdown_followup.sql - seeds the migration ledger with 20261011120000; private helpers (snapshots, require/mark_migration, legacy_shop_ids, is_shop_member redefined, try_parse_ts, client_build, require_client_build pass-through, app_config); settings readable by members; append-only credits/inventory_logs; admin-only personal_expenses; deny-all unused tables; id defaults; archive-on-delete for products/customers/bottles plus mass-delete guard; fresh-user-only cashier insert; process_checkout/process_reversal dropped and recreated returning jsonb with telemetry, ordered locks, date clamp, derived credit, stamped logs and delta bottle restores; process_stock_adjustment stub

**Files:** `supabase/migrations/20261012100000_lockdown_followup.sql`, `supabase/tests/00_lockdown_smoke.sql`, `supabase/tests/01_legacy_rpc_smoke.sql`, `supabase/rehearsal/fixtures.sql`, `supabase/MIGRATIONS_LOG.md`, `supabase/README.md`

**Owner actions:**
- (We confirm first that npm run sql:rehearse is green for this file.)
- Ask every POS device to come online until its sync badge shows 0 pending.
- Run supabase/ops/snapshot_public.sql immediately before.
- During closed hours, paste 20261012100000_lockdown_followup.sql into the SQL Editor, run it once (it is all-or-nothing), and paste back the validation table.
- Run supabase/tests/00_lockdown_smoke.sql and 01_legacy_rpc_smoke.sql and paste their result lines. They roll back and leave no data.
- Smoke test on the deployed app using one designated test product only:
- note its stock;
- ring one online and one offline cash sale on it;
- reconnect and confirm each sale appears once;
- delete both sales from Sales History and confirm the stock is back to the noted value;
- record the sale ids in MIGRATIONS_LOG.md.
Cashier checks run only in the rehearsal, because the live shop has no cashier.
- Fill in MIGRATIONS_LOG.md for this file.

**Verification:** Every validation row is ok, including the real-user check. A curl GET to /rest/v1/profiles and /rest/v1/settings with only the anon key returns 401 or an empty array.

The tests prove:
- a user cannot read or write another shop's rows;
- a user cannot change their own role or shopId;
- the same checkout replayed twice creates one sale and returns duplicate;
- reversing twice restores once;
- a reversal restores bottles by delta, so a refill made after the sale is kept;
- a foreign shop id gets 42501;
- an API product delete archives the row (hidden from SELECT, deletedAt set);
- a 30-row API bulk delete raises mass_delete_blocked;
- personal_expenses is visible to the admin and invisible to a cashier;
- a checkout naming a missing product stores the sale and writes repair_log;
- a Firestore-style sale id works end to end.

The deployed client logs in, sells and syncs.

**Fixes findings:** SEC-16, DB-6, DB-7, DB-17, FIN-3, FIN-11, SYNC-10, GAP2-4

#### ⬜ Step 0.4: R0a: sync queue remainder, Dexie versionchange guard, backup count check

*Effort M · depends on 0.3*

This is a hotfix on HEAD. 1c186d6 already provides backoff, a single-run guard and an admin-only typed clear. What remains:

SyncEngine.tsx:
- Run the queue under navigator.locks.request('vapetrax-sync', {ifAvailable: true}) on top of the useRef guard, so two tabs never send at once. Fall back to a localStorage lease where Web Locks is missing.
- Count only server-reached failures. After 10 of them the item becomes status 'failed', with a Retry button that resets retryCount and nextAttemptAt. Store lastErrorCode.
- Count an RPC result of {status: 'duplicate'}, or 23505 on sales_pkey, as success.
- Run on online, visibilitychange and the existing timer only, not on every liveQuery emission.
- Replace the whole-queue clear with:
  - 'Export unsynced (JSON)' for every role;
  - an admin-only per-item Discard that works only online, downloads that item first, needs a typed DELETE, and removes just that item.

db.ts:
- SyncOperation gains lastErrorCode.
- db.on('versionchange') closes the connection and shows a blocking 'Reload required' banner, reloading when the cart is empty. An old tab then never crashes when a newer build upgrades Dexie in 3.2.

backup.ts: after reading each table, compare its row count with a head count (count exact, head: true). Fail the export on a mismatch, which catches a table silently hidden by RLS.

**Files:** `src/components/sync/SyncEngine.tsx`, `src/lib/db.ts`, `src/lib/backup.ts`

**Owner actions:**
- None until the R0 release in step 0.7.

**Verification:** With a forced failing payload, retries are spaced about 5, 10 and 20 seconds apart, and the item turns failed after 10 server failures. A cashier sees Export but no Discard. Discard is disabled offline. With two tabs open, a queued sale is sent once. A mocked count mismatch fails the backup. npm run build passes.

**Fixes findings:** SYNC-4, SYNC-5, FE-9, PERF-5, FIN-12

#### ⬜ Step 0.5: R0b: complete offline cache and interim report paging

*Effort M · depends on 0.3*

The live shop has more than 1,000 rows in both sales and bottles, so today the POS holds an arbitrary 1,000 of about 3,000 bottles, refills fabricate phantom bottles, and Dashboard, Sales and Detailed Reports totals are truncated.

src/lib/sync.ts (syncCloudToLocal):
- Page every table with .order('id').range(from, from + 999) until a short page, building a complete id set per table. On any page error, abort without touching Dexie.
- Never call clear(). bulkPut the fetched rows, then delete only local ids absent from a complete fetch.
- Rows referenced by pending or failed syncQueue items keep their local version until the queue drains. These are product ids from p_product_updates, bottle ids from p_bottle_updates, and p_customer_id. Unsynced deductions are therefore never overwritten.
- Use one Dexie transaction per table.

src/lib/fetchAllPages.ts is temporary; it is replaced by repositories in 4.4. It pages in order (date, then id) and cross-checks the count.

useDashboardAggregations, Sales.tsx and DetailedReports.tsx load their date range through it. DetailedReports drops the Firebase-era 90-day window.

This also removes the main source of phantom bottles. SYNC-9 and FE-10 are fixed for good in 1.10 and 2.5.

Add supabase/ops/check_month_total.sql, a read-only query that sums one month's sales for comparison.

**Files:** `src/lib/sync.ts`, `src/contexts/DataContext.tsx`, `src/lib/fetchAllPages.ts`, `src/hooks/useDashboardAggregations.ts`, `src/pages/Dashboard.tsx`, `src/pages/Sales.tsx`, `src/pages/DetailedReports.tsx`, `supabase/ops/check_month_total.sql`

**Owner actions:**
- None until the R0 release in step 0.7. Then run supabase/ops/check_month_total.sql for one past month and paste the total.

**Verification:** On the R0 preview build, used read-only against production:
- the Dexie bottles count equals the bottles count from 06;
- a pending deduction survives a refresh;
- a past month's Dashboard revenue and a 120-day Detailed Report equal the SQL totals.

npm run build passes.

**Fixes findings:** SYNC-15, FIN-13, PERF-3, FE-8, FIN-8, HYG-13

#### ⬜ Step 0.6: R0c: auth without admin fallback, minimal offline session, request telemetry, checkout and udhaar safety

*Effort M · depends on 0.3*

AuthContext:
- Create a profile only on PGRST116. On any other error, keep the cached profile. With no cache, enter 'unverified': no role, and the POS is blocked with 'Connect to the internet to verify your account'.
- Never cache or grant an unconfirmed role, never fall back to admin, and never use user.id as shopId when profile.shopId is null.
- Role 'pending' (new accounts from 2.1 on) and any unknown role show 'Your account is not linked to a shop yet' and allow no writes. Neither is ever treated as a cashier.
- Minimal offline session: when getSession or refresh fails with a network error, and localStorage still holds a session whose user id matches a cached profile, stay signed in as 'offline-authenticated'. POS and queue only; online-only pages show 'Needs internet'.
- Caches are cleared only on an explicit SIGNED_OUT, never on a null session caused by the network. 3.4 generalises this to memberships.

ProtectedRoute handles the unverified, pending and offline-authenticated states.

src/lib/supabase.ts sends global headers:
- x-client-build: the git SHA, injected as __APP_BUILD__ by a vite define;
- x-device-id: a random id kept in localStorage.
The checkout payload also carries p_sale_data.clientBuild as a fallback, in case the CORS preflight rejects custom headers.

NewSale.tsx:
- split validation in integer paisa;
- reject negative parts and a non-positive custom or refill price;
- round the refill unit price to 2 decimals.

CustomerModal.tsx: drop creditBalance from the edit payload and show it read-only.

Dashboard.tsx: recovered credit filters credits on createdAt, with creditType customer and transactionType taken.

Settings.tsx: when the settings load fails with anything other than 'no row', show an error banner with Retry and disable Save.

**Files:** `src/contexts/AuthContext.tsx`, `src/components/layout/ProtectedRoute.tsx`, `src/lib/supabase.ts`, `vite.config.ts`, `src/pages/NewSale.tsx`, `src/components/customers/CustomerModal.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Settings.tsx`

**Owner actions:**
- None until the R0 release in step 0.7.

**Verification:** These pass:
- an offline reload keeps the role and shop;
- forcing the profile fetch to 500 with no cache shows unverified, not admin, and shopId is never user.id;
- opening the app offline with the clock moved 2 hours past the last refresh opens the POS as offline-authenticated, and it sells;
- a 'pending' profile sees the not-linked message;
- a split of 333.33/333.33/333.34 on 1000 is accepted and -5 is rejected;
- a customer edit sends no creditBalance;
- a payment recorded today shows as recovered credit;
- a failed settings load disables Save;
- requests carry x-client-build, and the preflight succeeds (otherwise the payload fallback is used);
- after a test sale, legacy_rpc_calls shows the R0 build.

**Fixes findings:** SEC-12, SYNC-2, SYNC-3, FE-6, FIN-15, FE-16, UX-4, FIN-17, FE-13, GAP1-6

#### ⬜ Step 0.7: R0d: safe Stock and Sales actions, Edit and remove-item paused, prompted updates; R0 release

*Effort M · depends on 0.4, 0.5, 0.6*

Stock.tsx:
- Add id: crypto.randomUUID() to the five bottle inserts and to the product-delete inventory_logs payload.
- Check {error} on product insert, update and delete, and on bottle and log inserts, and throw. No success toast on failure.
- Product and customer deletes now archive (0 rows reported): refetch and show 'Archived'.
- When the mass-delete guard blocks a bulk delete of more than 25 items, show a clear message.

Sales.tsx:
- busyIds disable row buttons while a request runs.
- refetchSales() runs in finally.
- Successful ids leave the selection, and bulk delete reports 'n of m deleted'.
- InvoiceModal gets a busy lock.
- Hide Edit and Remove item, with the tooltip 'Paused: delete and ring again'. They return in Phase 4 as server commands.

NewSale: the cart is not persisted while editing. Logout clears vapetrax_cart.

Sales.tsx and InventoryLogs.tsx ignore empty or invalid date inputs instead of crashing.

PwaUpdatePrompt.tsx never reloads mid-operation. It auto-applies the update only when idle: empty cart, no sync in flight, no input focused, on the POS or Dashboard route. Otherwise it shows a persistent 'Update available - Reload' toast, so later releases still propagate.

supabase/ops/gate_r0.sql reports legacy_rpc_calls per build for the last 7 days. It passes when there is no 'unknown' build.

Release:
- Push as a fast-forward of the remote and branch named in 0.1 (probably zain_repo/main; origin/main can also be fast-forwarded).
- Verify that the Vercel production deployment shows the pushed SHA.
- The deployed service worker force-reloads devices onto R0.

**Files:** `src/pages/Stock.tsx`, `src/pages/Sales.tsx`, `src/pages/NewSale.tsx`, `src/pages/InventoryLogs.tsx`, `src/pages/Customers.tsx`, `src/contexts/AuthContext.tsx`, `src/components/ui/PwaUpdatePrompt.tsx`, `supabase/ops/gate_r0.sql`

**Owner actions:**
- Approve pushing the branch as a fast-forward of the named Vercel remote, and deploying R0. Do this only after 20261012100000 has been validated.
- Smoke-test the Vercel preview with the checklist in the commit message, using only the designated test product (preview writes go to the production database). Delete the test sales afterwards and record their ids.
- Ask staff to open every POS device once.
- After 7 days, run supabase/ops/gate_r0.sql and paste the result.

**Verification:** These pass:
- adding an e-liquid with 2 bottles creates 2 bottle rows;
- deleting a sale removes its row, and the button cannot be double-clicked;
- Edit and Remove item are hidden;
- clearing a date input no longer blanks the app;
- a new deploy shows the Reload toast and applies only when idle;
- the Vercel production deployment shows the pushed SHA;
- gate_r0.sql lists the R0 build.

**Fixes findings:** UX-2, FIN-14, FE-5, FE-28, HYG-20, SYNC-16

#### ⬜ Step 0.8: Git history purge and canonical remote (owner-confirmed; no commit)

*Effort S · depends on 0.1*

Run this only after 0.1, and only on explicit written owner confirmation.

1. Take a full backup with git bundle --all.
2. On a fresh mirror clone, run git filter-repo to remove migrate.js (the revoked key), 'VapeTrax_Business_Lodhran (1).xlsx', temp_excel_parser/ and the unredacted supabase/scripts/2026-10-11_delete_test_shop_and_users.sql (four emails, already on zain_repo via 62148ab) from every ref.
3. Re-add the redacted copy at its 0.1 state.
4. Verify with git log --all -S sb_secret_, git log --all -- '*.xlsx' and git log --all -S '@gmail.com' -- supabase/scripts.
5. Force-push the rewritten refs to the canonical remote (the Vercel one). Then force-push the non-canonical remote too, or archive it.
6. Collaborators re-clone. If a repo was ever public, ask GitHub support to purge cached views.

This step creates no commit.

**Files:** `migrate.js`, `VapeTrax_Business_Lodhran (1).xlsx`, `temp_excel_parser/`, `supabase/scripts/2026-10-11_delete_test_shop_and_users.sql`

**Owner actions:**
- Confirm in writing that force-pushing both remotes is approved, and name the canonical remote connected to Vercel.
- Tell every collaborator to re-clone after the push.
- Enable GitHub secret scanning with push protection on the canonical repository.

**Verification:** On a fresh clone of each remote, the three git log searches return nothing. Both remotes show the rewritten SHAs, or the non-canonical one is archived. The Vercel production deploy still builds.

**Fixes findings:** SEC-15, HYG-5, HYG-22

#### 🟡 Step 0.9: Owner's rules: stock never below zero, refills only in 0.5 ml steps, whole-rupee prices

*Effort S · depends on 0.0*

Added by the owner on 2026-10-11 after seeing negative stock 3–4 times.

**Why stock went negative.** The POS checked a local copy of stock that refreshed only at login. The old `process_checkout` subtracted without any check. Retried sales deducted twice (already fixed in 20261011120000).

**Database: migration `20261011140000_stock_never_negative_refill_steps.sql`.**
- Any stock or bottle ml already below zero is reset to 0, with a "please recount" log entry.
- CHECK rules `products_stock_not_negative` and `bottles_remaining_not_negative` refuse minus values from any screen or device.
- `process_checkout` deducts with a guard and never goes below zero. A sale that arrives short (made offline, or two devices sold the last unit at once) is **kept**: stock stops at 0, and a `shortfall` inventory log plus an `inventory_alerts` row are written.
- Refill lines must be in 0.5 ml steps, and every line quantity must be a whole number. Anything else is refused, and the whole sale rolls back.
- `process_reversal` refuses negative restore amounts.

**App changes:**
- `src/lib/quantities.ts` holds the rules: `isValidRefillMl`, `snapRefillMl`, `roundRupees`.
- POS refill pop-up: ±0.5 ml stepper; typed amounts snap to the nearest 0.5 with a notice; refill and custom prices round to whole rupees.
- At checkout, a live server stock check runs, minus sales still waiting to sync, and blocks short sales at the counter.
- Edited old sales with invalid refill amounts are stopped before anything is reversed.
- Stock page: edits read live stock from the server, report refused saves, refresh the POS copy, and give bottle inserts their missing ids.
- `src/lib/liveStock.ts` is the one place that reads live stock. It answers within about 3.5 s with no retries, so the counter never freezes on Wi-Fi without internet. It subtracts this device’s unsynced sales without counting any twice, and keeps the device copy of products and bottles in step after Stock-page saves, bulk import and edit-sale reversals.
- Bulk import adds to live server stock, rounds prices to whole rupees, and makes new products available to the POS right away.
- The Stock page shows unresolved **shortfall alerts** to admins, with a “Mark recounted” button.
- Hardening from adversarial review:
  - the alert insert is best effort and can never roll back a sale;
  - a restock that lands during a shortfall is respected;
  - NaN, Infinity and absurd amounts are refused;
  - edits of old sales with non-whole quantities are stopped before anything is reversed.
- The PGlite harness now lives in `supabase/tests/pglite` (`npm test`).

**Note for 6.2 / legacy cleanup.** `inventory_alerts` now holds real rows. Before it is merged into another alerts table or dropped, `process_checkout` must be repointed and the existing rows migrated.

**Later steps must keep these rules.** Every later checkout or stock command (0.3, 2.5, 2.7, 5.1) must keep the guarded deduction, the CHECK rules, the shortfall handling and the 0.5 ml refill rule.

Owner decision: invalid refill steps are **refused** even for queued sales. This is an exception to the plan's "record, don't reject" principle. The UI enforces the rule, and the queue is drained before the migration is applied.

**Migrations:**
- 20261011140000_stock_never_negative_refill_steps.sql: never-negative stock, 0.5 ml refills, shortfall alerts

**Files:** `src/lib/quantities.ts`, `src/pages/NewSale.tsx`, `src/pages/Stock.tsx`, `supabase/migrations/20261011140000_stock_never_negative_refill_steps.sql`, `supabase/diagnostics/verify_20261011140000.sql`, `supabase/diagnostics/06_negative_stock_history.sql`

**Owner actions:**
- Optional: run 06_negative_stock_history.sql and paste the result, to see when and how stock went negative.
- Deploy the app first: run `git push zain_repo fix/audit-remediation:main`.
- Fully close and reopen VapeTrax on every phone/PC (the refill window must show the new -/+ 0.5 ml buttons).
- Check that the sync panel shows nothing waiting, then paste the migration into the SQL Editor and run verify_20261011140000.sql.

**Verification:** PGlite: 40/40 rule checks, 42/42 lockdown checks with this migration on top, and 10/10 delete-script checks (npm test in supabase/tests/pglite). Helper unit checks, tsc and vite build pass. Two adversarial reviews: all 13 defects found were fixed or verified harmless against live data.

### Phase 1: Foundations (client release R1)

**Goal:** Make the codebase safe to change:
- a clean UTF-8 repo;
- archived legacy SQL with conventions and a SQL test prelude that runs in the PGlite rehearsal;
- pruned dependencies;
- real type checking with a typed Supabase client;
- lint, formatting and tests with CI;
- pure, tested domain modules;
- one error toolkit, so no write fails silently.
It also adds the interim compare-and-set guards against lost stock and credit updates.

**Done when:** npm run ci is green: encoding, typecheck, lint within budget, unit tests (domain coverage at least 90%), build, bundle budget, the legacy e2e suite and sql:rehearse. check-supabase-writes finds zero unchecked writes. R1 is deployed.

#### ⬜ Step 1.1: Encoding normalisation (UTF-8, LF, no BOM, no mojibake)

*Effort S · depends on 0.7*

1. Add .editorconfig (utf-8, lf, final newline, 2-space indent) and .gitattributes (* text=auto eol=lf; *.sql text eol=lf; images, xlsx, pdf and woff2 marked binary).
2. Add a one-off scripts/fix-encoding.mjs. It strips the 23 BOMs, transcodes any UTF-16 file to UTF-8, and replaces known mojibake with the intended characters. The affected lines are Login.tsx:134/197, NewSale.tsx:769, Stock.tsx:22/31/676/728/946 and Settings.tsx:477/497/516, plus the comments in vite.config.ts and Sidebar.tsx. Each replacement is reviewed by hand.
3. Add scripts/check-encoding.mjs, run by npm run check:encoding. It fails on a BOM, UTF-16, CRLF, or U+00C3 / U+00E2 U+20AC sequences.
4. Run git add --renormalize . in the same commit, so the whitespace churn is isolated here.
5. Add a CONTRIBUTING note: never write files with Windows PowerShell 5.1 '>' or Out-File.

**Files:** `.editorconfig`, `.gitattributes`, `scripts/fix-encoding.mjs`, `scripts/check-encoding.mjs`, `src/pages/Login.tsx`, `src/pages/NewSale.tsx`, `src/pages/Stock.tsx`, `src/pages/Settings.tsx`, `src/components/layout/Sidebar.tsx`, `vite.config.ts`, `package.json`, `CONTRIBUTING.md`

**Verification:** node scripts/check-encoding.mjs exits 0. git ls-files --eol shows i/lf for every text file. The Login, POS and Products screens show the correct characters. npm run build passes.

**Fixes findings:** HYG-6, FE-25, UX-28

#### ⬜ Step 1.2: Supabase folder: archive legacy SQL, conventions, SQL test prelude in the rehearsal

*Effort S · depends on 0.3, 1.1*

Archive:
- Move schema.sql, process_checkout_rpc.sql, process_reversal_rpc.sql, process_stock_adjustment_rpc.sql, fix_process_checkout.sql and upgrade_process_checkout.sql into supabase/archive/, re-encoded as UTF-8.
- Add archive/README.md: 'historical snapshots; superseded by migrations/20261011120000 and later; DO NOT RUN'.
- fix-rls.sql and grants.sql were already deleted in 0.1.

supabase/README.md documents the conventions:
- file names YYYYMMDDHHMMSS_name.sql (the existing convention); internal objects live in the private schema;
- one transaction per file, with lock_timeout 5s and statement_timeout 5min;
- require_migration(list of prerequisites) and mark_migration;
- policy and function snapshots;
- idempotent DDL only, with an explicit DROP plus CREATE for return-type changes;
- CHECKs only when clean;
- no in-place type change on a column a deployed client writes before contract;
- a pg_depend and prosrc check before any DROP COLUMN, and never CASCADE;
- a real-user check in every file that touches access;
- sql:rehearse green before sending; never edit an applied file; snapshot and drain before risky files; paste the validation back; a rollback note per file.
It also has the folder map: diagnostics, migrations, tests, ops, rehearsal, archive.

SQL tests:
- supabase/tests/_prelude.sql defines pg_temp helpers: make_user, make_shop, as_user (set local role authenticated plus request.jwt.claims), as_postgres and assert.
- scripts/build-sql-tests.mjs concatenates the prelude and each test into supabase/tests/dist/<name>.sql for pasting.
- rehearsal/run.mjs runs the same prelude-based tests in PGlite.
- Rewrite tests 00 and 01 on the prelude.

supabase/ops/prune_snapshots.sql lists the app_backup_* schemas with their sizes and drops the ones the owner names (Free plan, 500 MB).

**Files:** `supabase/archive/README.md`, `supabase/archive/schema.sql`, `supabase/archive/process_checkout_rpc.sql`, `supabase/archive/process_reversal_rpc.sql`, `supabase/archive/process_stock_adjustment_rpc.sql`, `supabase/archive/fix_process_checkout.sql`, `supabase/archive/upgrade_process_checkout.sql`, `supabase/README.md`, `supabase/tests/_prelude.sql`, `supabase/tests/00_lockdown_smoke.sql`, `supabase/tests/01_legacy_rpc_smoke.sql`, `supabase/rehearsal/run.mjs`, `supabase/ops/prune_snapshots.sql`, `scripts/build-sql-tests.mjs`, `package.json`

**Verification:** The file command reports UTF-8 or ASCII for supabase/archive/*.sql. npm run build:sql-tests produces the dist files. npm run sql:rehearse runs both migrations twice and the prelude-based tests 00 and 01 green.

**Fixes findings:** DB-5, HYG-4

#### ⬜ Step 1.3: Repo cleanup: Firebase and AI Studio leftovers, dead modules, docs to history

*Effort S · depends on 1.1*

Delete:
- firebase.json, .firebaserc, .firebase/, firestore.rules, firestore.indexes.json, firebase-blueprint.json, metadata.json and spec.json;
- src/pages/Dashboard.tsx.bak;
- check_errors.js, replaced by the Playwright smoke spec in 1.9;
- the unreachable double-entry finance module (src/components/finance/*, src/lib/finance-system.ts, src/types/finance.ts). It must not simply be given a route; a server-side journal is in the backlog;
- src/lib/seedData.ts, plus Dashboard's handleSeedData, which inserts sales directly and would fail after 2.2 anyway;
- src/hooks/useSupabase.ts, the dead realtime hook (FilterCondition and OrderCondition move into useSupabaseOnce.ts);
- useCachedSupabaseOnce.

Move usage_fix_implementation_plan.md, Supabase-Migration.md, 'Billing page.png', 'UML Diagrams/' and memory.md (which tells AI editors to use Firestore) to docs/history/.

Replace README.md with a short, accurate stub. Trim .env.example to VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and an optional VITE_SENTRY_DSN.

In vite.config.ts, remove the AI Studio HMR block and point the @ alias at ./src.

**Files:** `firebase.json`, `.firebaserc`, `.firebase/hosting.ZGlzdA.cache`, `firestore.rules`, `firestore.indexes.json`, `firebase-blueprint.json`, `metadata.json`, `spec.json`, `check_errors.js`, `src/pages/Dashboard.tsx.bak`, `src/components/finance/AccountList.tsx`, `src/components/finance/ManualTransactionModal.tsx`, `src/components/finance/TransactionLedger.tsx`, `src/lib/finance-system.ts`, `src/types/finance.ts`, `src/lib/seedData.ts`, `src/pages/Dashboard.tsx`, `src/hooks/useSupabase.ts`, `src/hooks/useSupabaseOnce.ts`, `docs/history/`, `README.md`, `.env.example`, `vite.config.ts`

**Verification:** npm run build passes and the bundle does not grow. grep -ri firestore src returns only date-helper comments, which 1.7 removes. Every route still renders.

**Fixes findings:** HYG-16, HYG-18, FE-24, PERF-16, FIN-20, DB-27, GAP4-12

#### ⬜ Step 1.4: Dependencies, package metadata and scripts

*Effort M · depends on 1.3*

Metadata: package name vapetrax, version 2.0.0, engines node >= 20.19, and .nvmrc set to 22.

Uninstall @google/genai, express, @types/express, firebase-admin, framer-motion, motion, dotenv, tsx, autoprefixer and playwright. @playwright/test returns as a dev dependency in 1.9. Keep zod, react-hook-form and @hookform/resolvers.

Move the build-only packages (vite, @vitejs/plugin-react, @tailwindcss/vite, tailwindcss, vite-plugin-pwa, typescript, @types/node) to devDependencies and remove the duplicate vite entry. Upgrade vite to the latest 6.4.x patch and react-router-dom to the latest patched 7.x.

Replace xlsx 0.18.5 with SheetJS CE 0.20.3 from the official tarball, with the integrity hash pinned. Load it only through await import('xlsx') in DetailedReports and Stock.

Scripts:
- dev (localhost only) and dev:lan;
- typecheck, lint, format, format:check, test, e2e, check:encoding, build:sql-tests, sql:rehearse, ci;
- build 'tsc -b && vite build';
- clean as a node one-liner.

Regenerate package-lock.json.

**Files:** `package.json`, `package-lock.json`, `.nvmrc`, `src/pages/DetailedReports.tsx`, `src/pages/Stock.tsx`

**Verification:** npm ci succeeds on a clean clone. npm audit --omit=dev reports no high or critical issue from the removed packages or xlsx. xlsx sits in its own lazy chunk. npm run dev listens on localhost only.

**Fixes findings:** HYG-7, HYG-8, HYG-9, SEC-20

#### ⬜ Step 1.5: TypeScript foundation: React types, tsconfig split, typed Supabase client, env validation

*Effort M · depends on 1.4*

Install and wire:
- Install @types/react@^19, @types/react-dom@^19 and type-fest.
- Add src/vite-env.d.ts, including the __APP_BUILD__ declaration, and remove the @ts-ignore in PwaUpdatePrompt.

Split tsconfig:
- tsconfig.json holds only references.
- tsconfig.app.json covers src only, with no allowJs or experimentalDecorators.
- tsconfig.node.json covers the tool configs.
- tsconfig.strict.json enables strict and noUncheckedIndexedAccess over src/domain, data, lib, config, offline, commands, types and ui. New src/features folders are added as they are created.

Typed client:
- src/types/db.ts is MergeDeep<generated, overrides>, hand-declaring objects added by migrations until regenerated types arrive.
- src/config/env.ts validates env with zod. main.tsx renders src/app/errors/ConfigErrorScreen.tsx when env is invalid.
- src/lib/supabase.ts uses createClient<Database>.

src/types/domain.ts types DataContext and the sale JSONB.

Fix the resulting errors: the backup table list, useSupabaseOnce typing, the Stock bottle status and record payloads, and any writes to columns that do not exist.

**Files:** `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.strict.json`, `src/vite-env.d.ts`, `src/config/env.ts`, `src/lib/supabase.ts`, `src/types/db.ts`, `src/types/domain.ts`, `src/app/errors/ConfigErrorScreen.tsx`, `src/main.tsx`, `src/contexts/DataContext.tsx`, `src/lib/backup.ts`, `src/hooks/useSupabaseOnce.ts`, `src/pages/Stock.tsx`, `src/components/ui/PwaUpdatePrompt.tsx`

**Owner actions:**
- Decide how types are refreshed after each migration: download them from Dashboard > API Docs, provide a personal access token so npx supabase gen types can run, or keep the hand-maintained overrides.

**Verification:** npm run typecheck reports 0 errors for both projects. A build with an empty VITE_SUPABASE_URL shows the configuration screen. Writing a column that does not exist fails typecheck.

**Fixes findings:** FE-15, HYG-3, HYG-14, HYG-17, GAP3-9, DB-8

#### ⬜ Step 1.6: ESLint and Prettier with a one-time format commit

*Effort S · depends on 1.5*

eslint.config.js (ESLint 9 flat config):
- typescript-eslint 8, with type-checked rules in the strict folders;
- react-hooks and react-refresh;
- jsx-a11y as warnings;
- eslint-config-prettier;
- no-restricted-imports for the layer rules: the Supabase client may be imported only from src/data, src/offline, src/commands and a shrinking allowlist of legacy pages;
- no-console as a warning;
- no-restricted-syntax banning discarded awaited Supabase calls;
- @typescript-eslint/no-explicit-any as a warning with a budget.

Add .prettierrc.json and .prettierignore, and format src and the config files in this single commit.

scripts/lint-budget.json records the current warning counts. scripts/lint-budget.mjs fails CI when a count rises.

**Files:** `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `scripts/lint-budget.json`, `scripts/lint-budget.mjs`, `package.json`, `src/`

**Verification:** npm run lint exits 0 within the budget. format:check passes. The commit is formatting only (git diff -w --stat is small). typecheck and build pass.

#### ⬜ Step 1.7: Vitest and domain core: money, dates, payments, product, business-rule fallbacks

*Effort M · depends on 1.6*

Install vitest 3, @vitest/coverage-v8, jsdom and @testing-library/react 16.

Domain modules:
- src/domain/money.ts: paisa helpers, validateSplit, strict parseMoney.
- src/domain/dates.ts: todayKarachi, businessDayRange(from, to, startHour), parseDateSafe, formatDate, formatDateTime.
- src/domain/payments.ts: getPaymentBreakdown for object, JSON-string and null splits; getPaymentStatus.
- src/domain/product.ts: ProductCategory (device, coil, e-liquid, other), normalizeCategory, isELiquid, stockUnit, parseMl.
- src/config/businessRules.ts: named constants (DEFAULT_BOTTLE_ML, DEFAULT_REFILL_PRICE_PER_ML, IMPORT_MARKUP, BUSINESS_DAY_START_HOUR, TIMEZONE, LOW_STOCK_DEFAULT, MIN_PASSWORD_LENGTH, EXPENSE_CATEGORIES, PAGE_SIZE). These are **fallback defaults only**: from 2.3 on, the app reads the per-shop rates on settings through useShopSettings and falls back to these constants.
Each module has table tests drawn from the audit's verified cases.

Replace the call sites:
- the payment breakdown (7 places);
- the 26 'e-liquid' literals;
- about 10 '|| new Date()' display fallbacks;
- the UTC-day defaults in Expenses and NewSale;
- '$' in formatCurrency.

src/lib/dates.ts is replaced by domain/dates.

**Files:** `vitest.config.ts`, `src/domain/money.ts`, `src/domain/money.test.ts`, `src/domain/dates.ts`, `src/domain/dates.test.ts`, `src/domain/payments.ts`, `src/domain/payments.test.ts`, `src/domain/product.ts`, `src/domain/product.test.ts`, `src/config/businessRules.ts`, `src/lib/dates.ts`, `src/pages/Dashboard.tsx`, `src/pages/Sales.tsx`, `src/lib/salesReversal.ts`, `src/components/credits/CustomerCreditHistoryModal.tsx`, `src/pages/NewSale.tsx`, `src/pages/Stock.tsx`, `src/pages/Expenses.tsx`, `src/pages/Customers.tsx`, `src/pages/InventoryLogs.tsx`, `src/pages/DetailedReports.tsx`, `package.json`

**Verification:** npm test is green with src/domain coverage of at least 90%. businessDayRange('2026-10-09','2026-10-09',3) gives [2026-10-08T22:00Z, 2026-10-09T22:00Z). parseMoney('Rs. 1,500/-') returns 1500. parseMl('30ml') returns 30. No 'e-liquid' literal remains outside product.ts, and no toISOString().split. Null dates render as a dash.

**Fixes findings:** GAP3-8, GAP3-10, GAP3-14, GAP3-15, UX-30, FE-29, FIN-22, GAP1-13

#### ⬜ Step 1.8: CI pipeline and repository policy files

*Effort S · depends on 1.2, 1.7*

.github/workflows/ci.yml runs on Node 22 with npm ci, then:
- check:encoding;
- typecheck for the app and strict projects;
- lint plus the budget, and format:check;
- vitest with coverage;
- build, then check:bundle;
- sql:rehearse, which applies every migration twice on the PGlite replica and runs every SQL test;
- npm audit --omit=dev (non-blocking until 6.4);
- the gitleaks action.

Supporting scripts and files:
- scripts/check-bundle-size.mjs, with thresholds starting at the current sizes;
- scripts/check-supabase-writes.mjs, which fails on any awaited supabase.from or rpc whose result is discarded;
- .gitleaks.toml;
- .github/dependabot.yml;
- .github/pull_request_template.md, with the migration checklist (rehearsal green, real-user check, 'deploy only after migration X');
- .git-blame-ignore-revs.

npm run ci runs the same chain locally.

**Files:** `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `.gitleaks.toml`, `.git-blame-ignore-revs`, `scripts/check-bundle-size.mjs`, `scripts/check-supabase-writes.mjs`, `package.json`

**Owner actions:**
- When pushing is allowed, enable branch protection on main (require CI and pull requests) and Dependabot alerts on the canonical repository.

**Verification:** npm run ci passes locally end to end, including sql:rehearse. actionlint validates the workflow. gitleaks finds no secret in HEAD.

**Fixes findings:** HYG-15

#### ⬜ Step 1.9: Playwright harness with a hermetic Supabase mock and legacy-behaviour e2e

*Effort M · depends on 1.8*

Add @playwright/test 1.63.x and playwright.config.ts. Its webServer runs build:e2e plus vite preview on port 4173, with VITE_SUPABASE_URL=http://127.0.0.1:54321.

e2e/fixtures/supabaseMock.ts uses page.route to serve:
- auth token, user and logout;
- REST tables from in-memory fixtures, with Range and Content-Range;
- scripted RPC responses: applied, duplicate, 500 or a PTxxx error;
- delete responses that return 0 rows, to mimic archive-on-delete.

e2e/fixtures/data.ts holds a shop, products (including an e-liquid with bottles), customers, and more than 1,000 bottles and sales.

Specs:
- auth;
- roles;
- pos-online;
- pos-offline (setOffline, two sales, the badge shows 2, exactly two RPC calls, the badge clears);
- pos-offline-reload;
- offline-session (clock moved 2 hours);
- split-validation;
- smoke: visits every route and fails on any pageerror or console.error.

Add the e2e job to CI.

**Files:** `playwright.config.ts`, `e2e/fixtures/supabaseMock.ts`, `e2e/fixtures/data.ts`, `e2e/auth.spec.ts`, `e2e/roles.spec.ts`, `e2e/pos-online.spec.ts`, `e2e/pos-offline.spec.ts`, `e2e/pos-offline-reload.spec.ts`, `e2e/offline-session.spec.ts`, `e2e/split-validation.spec.ts`, `e2e/smoke.spec.ts`, `.github/workflows/ci.yml`, `package.json`

**Owner actions:**
- Optional: create a free staging Supabase project for rehearsing migrations against real PostgREST and Auth, and add E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY secrets.

**Verification:** npm run e2e is green three runs in a row. Breaking the checkout payload makes pos-online fail.

#### ⬜ Step 1.10: Domain part 2: bottles, cart, inventory log, import parser, checkout extraction, clean bottleSize writes

*Effort L · depends on 1.7, 1.9*

Bottles: move src/lib/bottles.ts to src/domain/bottles.ts with:
- toEpochMs for ISO strings, Date and {seconds}, which fixes refill FIFO;
- newBottle and newClosedBottles, which always set a crypto.randomUUID id;
- allocateRefill, pickFullBottles, drainForAdjustment and fillForAdjustment;
- a claims map so several cart lines of one product never plan against the same bottle snapshot.

Other domain modules:
- src/domain/cart.ts;
- src/domain/inventoryLog.ts (the MovementType enum and makeInventoryLog);
- src/domain/import/parseProductSheet.ts: strict parseMoney, de-duplication within the file, caps, row numbers from __rowNum__, a reason for each invalid row, and a rejected-rows CSV;
- src/domain/checkout.ts: buildLegacyCheckoutPayload, extracted from NewSale.handleCompleteSale with injected now() and newId(), guarded by golden tests;
- src/domain/rpc/contracts.ts: zod schemas for the v1 payloads.

Product writes from Stock send bottleSize as String(parsed ml) for e-liquid and null for devices and coils, never '' or '30ml'. This lines up with the bottleSizeMl shadow column in 2.3.

Replace the 7 bottle-creation sites and the 12 hand-built log sites. Bottles created at checkout are written to Dexie in the same transaction, so they stop multiplying.

Bottle Details shows dates through parseDateSafe, plus 'opened N days ago'.

**Files:** `src/domain/bottles.ts`, `src/domain/bottles.test.ts`, `src/domain/cart.ts`, `src/domain/cart.test.ts`, `src/domain/inventoryLog.ts`, `src/domain/inventoryLog.test.ts`, `src/domain/import/parseProductSheet.ts`, `src/domain/import/parseProductSheet.test.ts`, `src/domain/checkout.ts`, `src/domain/checkout.test.ts`, `src/domain/rpc/contracts.ts`, `src/lib/bottles.ts`, `src/pages/NewSale.tsx`, `src/pages/Stock.tsx`, `src/pages/Sales.tsx`, `src/lib/salesReversal.ts`

**Verification:** These pass:
- the golden tests reproduce the pre-refactor payloads except for the intended fixes (ids, FIFO, multi-line claims);
- pos-online and pos-offline stay green;
- 'Rs. 1,500/-' imports as 1500;
- a row with 'abc' is invalid with a reason;
- a refill across two cart lines never double-allocates a bottle;
- saving a device sends bottleSize null.

**Fixes findings:** GAP3-1, GAP3-3, GAP3-5, GAP3-6, GAP3-7, GAP3-12, GAP1-3, FE-10, FE-26, UX-33, FIN-21

#### ⬜ Step 1.11: Error toolkit, checked writes, error boundaries, logging, interim compare-and-set for stock and credit

*Effort M · depends on 1.10*

src/lib/errors.ts provides:
- AppError kinds;
- toAppError for PostgrestError, AuthError and fetch TypeError;
- must();
- mustAffect(), for updates only: it uses .select('id') so a zero-row update becomes 'stale';
- toUserMessage, mapping 23505, 23503, 42501, PGRST116, PGRST202, 57014, network errors, invalid_credentials and the guard codes mass_delete_blocked, customer_has_balance, use_void and app_update_required;
- notifyError.

Deletes on products, customers and sales use must() followed by a refetch, never mustAffect. Archive-on-delete reports 0 rows on success.

src/lib/log.ts and src/lib/monitoring.ts: optional Sentry with a PII-scrubbing beforeSend.

Error boundaries: AppErrorBoundary (Reload, 'Clear cart and reload', 'Apply update', the pending-sync count read through raw IndexedDB), RouteErrorBoundary and WidgetBoundary, plus the createRoot error hooks and window listeners.

Convert all 39 unchecked writes to must() or mustAffect(). A success toast appears only after the final step.

Interim lost-update guards, until the R3c commands:
- Stock.tsx stock writes and AddCreditModal credit writes read the current row from the server, compute the new value, and write with a compare-and-set predicate (.eq('stockQuantity', expected) or .eq('creditBalance', expected)) plus .select('id').
- On 0 rows, they refetch and ask the user to retry.

Other fixes:
- salesReversal reads treat only PGRST116 as 'not found';
- delete the Firebase auth/* checks;
- secureAction maps network failures to an offline message;
- console calls are replaced by log, and no-console becomes an error.

**Files:** `src/lib/errors.ts`, `src/lib/errors.test.ts`, `src/lib/log.ts`, `src/lib/monitoring.ts`, `src/app/errors/AppErrorBoundary.tsx`, `src/app/errors/RouteErrorBoundary.tsx`, `src/app/errors/WidgetBoundary.tsx`, `src/main.tsx`, `src/App.tsx`, `src/pages/Stock.tsx`, `src/pages/Sales.tsx`, `src/lib/backup.ts`, `src/lib/salesReversal.ts`, `src/components/credits/AddCreditModal.tsx`, `src/components/customers/CustomerModal.tsx`, `src/pages/Customers.tsx`, `src/pages/Expenses.tsx`, `src/contexts/AuthContext.tsx`, `src/lib/secureAction.ts`, `eslint.config.js`, `e2e/archive-delete.spec.ts`, `e2e/stock-cas.spec.ts`, `package.json`

**Owner actions:**
- Optional: create a free Sentry project and set VITE_SENTRY_DSN in Vercel.
- Approve deploying R1 (steps 1.1-1.11) after the preview checklist. It needs no database change.

**Verification:** These pass:
- check-supabase-writes finds zero unchecked writes;
- a route that throws shows the fallback while the sidebar survives;
- a mocked delete returning 0 rows shows 'Archived', not 'changed on another device';
- a mocked mass_delete_blocked shows a clear message;
- two simulated devices each adding 5 units through the Stock page end at +10 (the second one retries after a compare-and-set miss);
- a credit payment racing another one never loses an amount.

**Fixes findings:** GAP1-1, GAP1-2, GAP1-4, GAP1-11, GAP1-12, UX-6, UX-32, FIN-5, FIN-10

### Phase 2: Multi-tenant data model and server command layer

**Goal:** Introduce organizations, shops and memberships with role-aware RLS, and harden the schema without breaking deployed clients. Move every stock, money and udhaar change into append-only ledgers written only by idempotent, shop-scoped SECURITY DEFINER commands, plus report and sync RPCs. This is the expand phase: deployed clients keep working through capture-mode guards, mirrors, archive-on-delete and secured legacy RPC translators.

**Done when:** Every migration from 20261020100000_tenancy to 20261110120000_reports, including the required 20261103120000_reconcile_bottles, is rehearsed green, applied in order and validated, and recorded in MIGRATIONS_LOG.md. Gate R0 passed before rls_by_role. Every SQL smoke test, including 99_cross_tenant, prints ALL TESTS PASSED. v_stock_reconciliation, v_credit_reconciliation and v_bottle_reconciliation read zero. The deployed R1 client still logs in, sells online and offline, and syncs.

#### ⬜ Step 2.1: Migration 20261020100000_tenancy: organizations, shops, memberships, invites, links, shop management

*Effort L · depends on 1.2, 0.7*

Write supabase/migrations/20261020100000_tenancy.sql (require_migration('20261012100000')).

Tables:
- organizations (status, maxShops) and org_members (owner);
- shops (timezone Asia/Karachi, businessDayStartHour 3, currency PKR, status, unique(orgId, id));
- shop_members (admin, manager or cashier; active or disabled);
- shop_invites (sha256 codeHash, role, optional email, maxUses, usedCount, expiresAt, revokedAt);
- shop_links (shopA < shopB, composite FKs (orgId, shopX) to shops);
- audit_log (append-only);
- in private: shop_counters(shopId, nextInvoiceNo), org_counters(orgId, nextTransferNo), platform_settings (orgSignupMode default 'code', defaultMaxShops 3), org_signup_codes (hashed), flags and invite_attempts.
The counters live in private, so checkouts never fire audit or touch triggers on shops or organizations.

Helpers in private (SECURITY DEFINER STABLE, search_path ''):
- user_shop_ids, shops_with_role, has_shop_role;
- assert_shop_role (PT401 or PT403);
- is_org_owner, user_org_ids, effective_role, actor_name, audit().
Orgs and shops with status 'trial' or 'active' count as usable.

Real-user check, part 1: before redefining anything, store each real profile's visible shop set and per-table visible counts in a temp table.

Then redefine:
- legacy_shop_ids() := user_shop_ids();
- legacy_is_shop_admin(shop) := has_shop_role(shop, '{admin}') (the owner passes);
- is_shop_member(p) := p = any(user_shop_ids()).
That moves every earlier policy and both legacy RPCs onto memberships.

Backfill. The expected live state is filled in when the file is authored, from a fresh 05_find_users.sql run: one org and shop c7587ec2-753c-4767-a9f3-8bcf6b30e685, one owner, 0 cashiers.
- Orgs and shops are inserted with status 'active' explicitly (ON CONFLICT DO NOTHING), with names from settings.shopName.
- If the main shop's backfill differs from the expected counts, the migration raises.
- Any other self-admin profile with data created by open signups since 2026-10-11 becomes its own org and shop with status 'suspended'. These are listed with row counts for the owner's decision; ops/suspend_org.sql suspends and un-suspends.

Profiles:
- The role check gains 'pending'.
- Mirror rules:
  - an org owner gets role 'admin' and shopId = their oldest owned active shop;
  - otherwise the oldest active membership decides (admin or manager -> 'admin', cashier -> 'cashier');
  - no membership -> 'pending' and shopId null.
- Replace profiles_insert_self with a BEFORE INSERT trigger that forces role and shopId from memberships ('pending' and null when there are none) and ignores client values. The exception is the legacy bridge: an admin inserting a cashier profile for a fresh auth user into their own shop keeps role cashier, and an AFTER trigger creates the active cashier membership.
- Deleting a profile disables the membership.
- There is no auth.users trigger.

Foreign keys:
- Drop the shopId FKs to auth.users.
- Add shopId -> shops(id) ON DELETE RESTRICT NOT VALID on every business table, and profiles.shopId -> shops ON DELETE SET NULL.
- VALIDATE each FK only when its orphan pre-count is 0; otherwise list the orphans.

RPCs (definer, authenticated only, audited):
- app_info() returns {schemaVersion, migrations[], minClientBuild, serverTime}.
- my_context() returns user, orgs and shops with role, timezone, businessDayStartHour and currency, creating a pending profile if one is missing.
- create_organization(p_org_name, p_shop_name, p_signup_code).
- create_shop(p_org_id, p_name): owner only; enforces maxShops; copies branding and the per-shop rates once 2.3 adds them.
- update_shop(p_shop_id, p_name, p_timezone, p_business_day_start_hour): owner only. The timezone is checked against pg_timezone_names and the hour must be 0-23. Stored businessDate values are not recomputed retroactively (documented).
- archive_shop(p_shop_id, p_reason, p_force): owner only. Refused while stock, udhaar or pending transfers exist unless forced. Unlinks the shop.
- update_organization(p_org_id, p_name).
- create_invite, accept_invite (attempt limiting), revoke_invite, list_shop_members, set_member_role.
- set_member_status: the owner can never be disabled, and admins only by the owner.
- update_member_display_name, update_my_profile, link_shops and unlink_shops.

RLS on the new tables: members and the owner read; writes only through RPCs. app_config.schema_version = 2.

Real-user check, part 2, in the validation: impersonate each real profile and assert that the visible shop set contains the stored pre-state, and that the per-table counts are identical. Also assert that c7587ec2's profiles.role and shopId are byte-identical before and after. Any mismatch raises.

Also add ops/create_org_signup_code.sql, create_org_for_owner.sql, readd_member.sql and suspend_org.sql, and tests/02_tenancy_smoke.sql.

**Migrations:**
- 20261020100000_tenancy.sql - organizations, org_members, shops, shop_members, shop_invites, shop_links, audit_log, private counters and platform settings; membership helpers; legacy_shop_ids/legacy_is_shop_admin/is_shop_member redefined; strict backfill of shop c7587ec2 (unexpected orgs suspended); profile mirrors and BEFORE INSERT trigger with legacy createCashier bridge; shopId FKs swapped to shops; tenancy RPCs incl. update_shop, archive_shop, update_organization; app_info and my_context; real-user check

**Files:** `supabase/migrations/20261020100000_tenancy.sql`, `supabase/tests/02_tenancy_smoke.sql`, `supabase/ops/create_org_signup_code.sql`, `supabase/ops/create_org_for_owner.sql`, `supabase/ops/readd_member.sql`, `supabase/ops/suspend_org.sql`, `supabase/rehearsal/fixtures.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- Run supabase/diagnostics/05_find_users.sql again and paste the result, so the expected counts in the file are current.
- (We confirm first that sql:rehearse is green.)
- Ask devices to sync to 0 pending, run ops/snapshot_public.sql, then run 20261020100000_tenancy.sql during closed hours. Paste back the validation table, including any suspended orgs.
- Choose the org signup mode (code is recommended until onboarding ships in R2) and the default maxShops (proposed: 3).
- Optional: turn off public sign-ups in Supabase Auth until R2. This also blocks the legacy add-cashier sign-up; the shop has no cashiers today.
- Run tests/dist/02_tenancy_smoke.sql and paste the result.
- On the deployed app, confirm the owner can log in, sell, and still sees Settings, Dashboard and Reports.

**Verification:** Validation:
- exactly the expected orgs, shops, owners and cashiers exist;
- every distinct shopId has a shops row;
- the real-user check passes, with c7587ec2's role 'admin' and shopId unchanged;
- all shopId FKs are validated or their orphans listed.

Tests:
- my_context returns owner or cashier as appropriate;
- an invite can be created and accepted, and the member becomes active;
- a disabled member reads 0 rows;
- an expired or revoked code fails;
- org B sees nothing of org A;
- the legacy createCashier insert produces an active membership;
- a new self-signup profile insert becomes 'pending';
- update_shop rejects an invalid timezone and hour 24;
- archive_shop refuses a shop that has stock unless forced.

**Fixes findings:** DB-21

#### ⬜ Step 2.2: Migration 20261020110000_rls_by_role: gate R0, role-aware policies, sales writes revoked

*Effort M · depends on 2.1, 0.7*

Write supabase/migrations/20261020110000_rls_by_role.sql (require_migration('20261020100000')).

The first check enforces gate R0. If private.legacy_rpc_calls has any 'unknown' clientBuild row in the last 7 days, it raises gate_r0_not_met. The owner can override with set local vt.override_gate_r0 = 'on' only after confirming in writing that every device reloaded. Owner confirmation is the other half of the gate.

Snapshot the policies. Then, for every public table, drop all policies in a loop and recreate them TO authenticated, using the InitPlan form shopId = any((select helper())).

Matrix:
- staff read;
- products and bottles writes need admin or manager;
- products and customers deletes need admin (they archive);
- **sales: SELECT for staff only. INSERT, UPDATE and DELETE are revoked from authenticated**, so sales change only through RPCs. The legacy remove-item and edit paths have been hidden since R0, and the gate proves no pre-R0 client remains;
- customers insert and update, credits insert and inventory_logs insert are allowed for staff;
- expenses insert is staff, update and delete need a manager;
- settings writes need admin;
- personal_expenses is admin only (has_shop_role(shop, '{admin}'));
- credits and inventory_logs stay SELECT and INSERT only;
- legacy unused tables stay deny-all.

profiles keeps only the bridge paths, now checked through has_shop_role. Own-row update covers username, email and updatedAt. Managers read the profiles of members of their shops.

private.validate_rls() holds the expected matrix (table x command x roles) and compares it with pg_policies. Every later migration extends it.

The real-user check is repeated. app_config.schema_version = 3.

tests/03_rls_matrix.sql covers owner, admin, manager, cashier and foreign-org cases.

**Migrations:**
- 20261020110000_rls_by_role.sql - gate R0 check; drop-all-and-recreate role-aware policies with InitPlan helper arrays; sales INSERT/UPDATE/DELETE revoked from authenticated; profiles bridge paths via memberships; tenancy-table policies; private.validate_rls(); real-user check

**Files:** `supabase/migrations/20261020110000_rls_by_role.sql`, `supabase/tests/03_rls_matrix.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- Run supabase/ops/gate_r0.sql and paste the result. Confirm in writing that every POS device has been opened since R0.
- (We confirm first that sql:rehearse is green.)
- Run the snapshot, then 20261020110000_rls_by_role.sql in a quiet period. Paste the validation table and the 03_rls_matrix result.
- On the deployed app, make a sale, add a customer, receive a payment, add an expense, edit a product and delete a sale. Report anything blocked.

**Verification:** validate_rls reports every table and command as matching, and the real-user check passes.

The tests show:
- a cashier cannot update products or costPrice, cannot delete customers or expenses, and cannot read personal_expenses;
- an API update or delete of sales by an admin is denied, while process_reversal still works;
- a manager cannot write settings;
- a foreign org sees nothing.

EXPLAIN shows the helper as an InitPlan. Rollback is select private.restore_policies('pre_20261020110000').

**Fixes findings:** SEC-7, DB-18, PERF-7

#### ⬜ Step 2.3: Migration 20261027100000_schema_hardening (+ optional 20261027100100_repair_sale_dates)

*Effort L · depends on 2.2*

Write supabase/migrations/20261027100000_schema_hardening.sql (require_migration('20261020110000')).

Rule for this file: no column that a deployed client writes changes type. The write-site list (Stock.tsx, NewSale payload, AddCreditModal, CustomerModal, Expenses and backup) is in the commit message, and the rehearsal replays the captured payloads.

(1) Stamping and touch triggers.
- Add updatedAt where missing, updatedBy on expenses, and createdBy uuid on sales.
- BEFORE UPDATE private.tg_touch sets updatedAt := now(), keeps createdAt, createdBy and createdAtClient, and rejects shopId changes.
- BEFORE INSERT private.tg_stamp_insert, for API callers, sets createdAt, createdBy, actorName, actorRole, userName and clientBuild on the server.

(2) Timestamps.
- *Client columns and settings.lastBackupDate **stay text**. A BEFORE INSERT/UPDATE trigger normalises new values to ISO-8601 UTC text with private.try_parse_ts (unparseable values are kept and logged).
- Existing rows are normalised: 13,012 Firestore-JSON saleDateClient values, the credits values, and 39 Postgres-text log rows. The originals go to repair_log.
- Conversion to timestamptz happens in 6.2.

(3) Numeric scales.
- numeric(12,2) for money, (14,4) per ml, (12,3) for quantities, but only on columns every client sends as JSON numbers.
- Changed-row counts are reported.
- products.bottleSize stays text. New products.bottleSizeMl numeric(8,2) is maintained by a BEFORE INSERT/UPDATE trigger from private.parse_ml(bottleSize): '30', '30ml' and '30 ML' become 30, and '' or unparseable values become null and are logged.
- All new SQL and client code reads bottleSizeMl. The text column is dropped in 6.2.

(4) Products, customers and bottles.
- stockUnit is trigger-maintained from category ('ml' for e-liquid, else 'piece'; client values ignored).
- Cost canonical rule: for ml products unitCostPerMl is canonical and costPrice = unitCostPerMl x bottleSizeMl; for piece products costPrice is canonical. A trigger keeps the other column in step.
- customers.kind is 'customer' or 'party'.
- 'others' credits are backfilled into party customers per (shopId, lower(btrim(entityName))) with their net balance.
- An AFTER INSERT trigger on credits with creditType 'others' finds or creates the party and applies the signed delta (a direct update here, switched to post_credit_entry in 2.4).
- The base-table customers SELECT hides kind = 'party' permanently. Parties are read through report_udhaar and sync_pull_v2.
- The customers archive trigger now refuses a non-zero balance with customer_has_balance (PT409).

(5) Normalisation instead of rejection, on rows the checkout path touches. BEFORE INSERT/UPDATE triggers:
- trim and lower category (e-liquid variants become 'e-liquid'; unknown values become 'other');
- derive an unknown paymentMethod from splitAmounts;
- derive an unknown bottles.status from remainingMl;
- clamp bottles.remainingMl to [0, bottleSize].
Every change goes to repair_log.

(6) CHECKs: prices >= 0; category in (device, coil, e-liquid, other); bottleSizeMl > 0 for e-liquid; 0 <= remainingMl <= bottleSize; bottle status set; totalAmount >= 0; paymentMethod set; amount > 0 on expenses, credits and personal_expenses; taxRate 0..100; non-blank names.
- Each CHECK is added, with ADD plus VALIDATE in this file, **only when its violator count after normalisation is 0**.
- Otherwise it is not added: its violators are listed and it is added in 6.2 after repair.
- There is no stockQuantity >= 0 check.

(7) Composite keys.
- unique(id, shopId) on products, customers and sales.
- Composite FKs bottles(productId, shopId) -> products and sales/credits(customerId, shopId) -> customers.
- These are safe for queued sales, because products and customers have been archived, never deleted, since 20261012100000.
- Dangling customer ids (14 sales) get tombstone customers (deletedAt set, name from credits.entityName or 'Deleted customer').
- Orphan and cross-shop bottles are copied to app_backup and removed (count from 06).

(8) Legacy RPCs re-created for the new types and keys.
- A customer id not found in the shop gets a tombstone customer created on the fly, flagged missing_customer.
- An unknown product skips its bottles and logs and is recorded as missing_product.
- Only an id that exists in another shop raises PT403.

(9) Uniqueness.
- Duplicate product names per shop (2 groups) are auto-suffixed ' (2)' and logged.
- A unique index covers (shopId, lower(btrim(name)), category, coalesce(bottleSizeMl, 0)) where deletedAt is null.
- Unique customers(shopId, phone) is added only when clean; the 11 duplicate groups are listed otherwise.

(10) Per-shop rates on settings: defaultRefillPricePerMl numeric(14,4), refillPresetsMl jsonb, importMarkupPct numeric(6,2) default 65, cashierBackdateDays int default 0, allowCashierPriceOverride boolean default true, creditWarnThreshold numeric(12,2). lowStockThreshold already exists. Each shop is seeded from today's hard-coded values. create_shop is updated to copy them.

(11) Alerts: stock_alerts becomes the single alerts table (kind, resolvedAt, resolvedBy, member read). The old rows are archived, inventory_alerts (empty) is migrated in and dropped, and raise_stock_alert is redefined.

(12) Indexes for the real query patterns:
- sales(shopId, saleDate desc) and (shopId, customerId);
- expenses(shopId, expenseDate desc);
- credits(shopId, customerId, createdAt desc);
- inventory_logs(shopId, createdAt desc) and (shopId, productId, createdAt desc);
- bottles(shopId, productId, status);
- products and customers (shopId, updatedAt);
- profiles(shopId).

app_config.schema_version = 4.

20261027100100_repair_sale_dates.sql is optional:
- the preview computes saleDate - private.try_parse_ts(saleDateClient) and reports the count of rows over 10 minutes, plus 20 samples;
- about 0 is expected, because the live RPC kept the client date. If the count is 0, the apply section is skipped;
- the apply section logs the old values to repair_log.

**Migrations:**
- 20261027100000_schema_hardening.sql - stamping/touch triggers, *Client normalised to ISO text (type unchanged), numeric scales on JSON-number columns, trigger-maintained bottleSizeMl/stockUnit/cost-canonical columns, normalisation triggers, CHECKs only when clean, composite FKs with tombstones, legacy RPCs re-created with tombstone/skip tolerance, party customers plus 'others' credit trigger, parties hidden from base SELECT, customer_has_balance, per-shop rates on settings, stock_alerts consolidation, indexes
- 20261027100100_repair_sale_dates.sql - optional: preview with try_parse_ts first; apply only if the count is non-zero and approved

**Files:** `supabase/migrations/20261027100000_schema_hardening.sql`, `supabase/migrations/20261027100100_repair_sale_dates.sql`, `supabase/tests/04_hardening_smoke.sql`, `supabase/tests/01_legacy_rpc_smoke.sql`, `supabase/rehearsal/fixtures.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- (We confirm first that sql:rehearse is green, including the replay of old Stock-form payloads.)
- Ask devices to sync, run the snapshot, then run 20261027100000_schema_hardening.sql during closed hours. Paste the validation table, which lists: CHECKs not added and their violators, renamed duplicate products, duplicate customer phones, tombstones created, orphan bottles removed, and unparseable timestamps.
- Decide how duplicate customer phones should be resolved (merge, keep both, or clear one).
- Run only the PREVIEW section of 20261027100100_repair_sale_dates.sql. Approve the apply section only if it reports affected rows.
- Spot-check on the deployed app: edit a device and an e-liquid product, edit a customer and an expense, record an 'others' udhaar entry, and check the dashboard figures.

**Verification:** Validation:
- no column written by a deployed client changed type;
- money columns have scale 2 where converted;
- bottleSizeMl is filled for every e-liquid product with a parseable size;
- every party's creditBalance equals its opening balance plus the sum of its 'others' credits;
- every CHECK and composite FK is either validated or listed with violators;
- inventory_alerts is gone;
- the indexes exist.

Tests:
- an old-shape product update with bottleSize '' and with '30ml' succeeds and sets bottleSizeMl to null and 30;
- a legacy v1 checkout touching a pre-seeded product with category 'E-Liquid ' and a bottle with remainingMl > bottleSize still succeeds, with repair_log rows;
- a v1 checkout for a missing customer creates a tombstone;
- an API insert without an id is stamped by the server;
- a customer with a balance cannot be deleted;
- an 'others' credit updates the party balance;
- parties are hidden from base SELECT;
- the 01 legacy smoke test still passes.

**Fixes findings:** DB-14, DB-15, DB-16, DB-19, DB-22, DB-23, DB-24, DB-25, DB-26, SEC-14, FIN-7, PERF-6, GAP2-9

#### ⬜ Step 2.4: Migration 20261103100000_ledgers_and_documents

*Effort L · depends on 2.3*

Write supabase/migrations/20261103100000_ledgers_and_documents.sql (require_migration('20261027100000')).

Idempotency: private.processed_mutations (mutationId uuid pk, shopId, userId, command, deviceId, clientBuild, result, createdAt), with begin_mutation and finish_mutation.

Append-only ledgers (camelCase columns). **Every reference to a sale, product, customer or bottle is text.**
- stock_movements: kind, reasonCode, qtyDelta, unit, qtyBefore, qtyAfter (CHECK qtyAfter = qtyBefore + qtyDelta), unitCost, refType, refId text, refLineNo, actor, occurredAt, businessDate, mutationId, clientBuild, and a composite FK (productId text, shopId) to products.
- bottle_movements (bottleId text).
- credit_ledger (customerId text, signed amount, balanceAfter, paymentChannel).

Sale documents:
- sale_items: saleId text, lineNo, productId text with no FK (history contains hard-deleted products), productName, saleType, quantity, refillMl, bottleSizeMl, stockQtyDelta, listPrice, unitPrice, discountAmount, lineTotal, unitCost, lineCost, lineProfit, returnedQty.
- sale_returns and sale_return_items.

New columns:
- sales: status, voidedAt/By, voidReason, replacesSaleId and replacedBySaleId (text), payCash, payOnline, payCredit, businessDate, receivedAt, invoiceNo, source, deviceId, clientBuild, flags.
- expenses: businessDate, paymentChannel and soft-delete columns.

private.business_date(shop, ts) uses shops.timezone and businessDayStartHour; triggers fill businessDate.

Posting functions post_stock_movement, post_bottle_movement and post_credit_entry lock the row and are the only writers of the cached columns, under app.ledger_write.

Capture mode:
- UPDATE guards on stockQuantity, remainingMl, status and creditBalance apply a direct API write and record it as a direct_write row with actor and clientBuild.
- AFTER INSERT and AFTER DELETE capture triggers on products and bottles post direct_write movements for inserted initial stock, inserted bottles' ml, and any removal.
- The flags enforce_* stay off.
- The 'others' credits trigger is switched to post_credit_entry.

Opening snapshot (idempotent): one opening movement per product and one opening_balance per customer with a non-zero balance. It sets flags.ledger_started_at.

Backfill:
- sale_items and the pay* columns from sales.items and splitAmounts;
- **bottle_movements from items[].bottleChanges as delta rows** (refType 'sale', refLineNo), so sale_void_v2 can reverse historic e-liquid sales;
- businessDate on sales and expenses.

Append-only triggers on the ledgers, sale_items, sale_returns, sale_return_items and audit_log. A generic audit trigger covers settings, shops, shop_members, product price, cost and identity fields and archives, customer identity fields and archives, and expense updates and deletes. The counters are in private, so checkouts add no audit noise.

RLS for each new table, extending validate_rls:
- stock_movements, bottle_movements, credit_ledger, sale_items, sale_returns and sale_return_items: SELECT for admin or manager of the shop only. No INSERT, UPDATE or DELETE for authenticated.
- sync_dead_letters: SELECT for admin; writes through RPCs.
- The base-table sales SELECT hides status 'voided'.

Views (definer, security_barrier, filtered by user_shop_ids(), with explicit revoke and grant):
- v_products, v_sales and v_sale_items, with cost and profit masked for non-managers;
- v_stock_history;
- v_stock_reconciliation, v_credit_reconciliation and v_bottle_reconciliation.

The real-user check is repeated: the owner sees every non-voided sale. app_config.schema_version = 5.

Between this file and 2.5, legacy checkouts are captured as direct_write rows, so apply 2.5 in the same session.

**Migrations:**
- 20261103100000_ledgers_and_documents.sql - processed_mutations, stock/bottle/credit ledgers and sale documents with text references, sales/expenses columns incl. businessDate and pay*, posting functions, capture-mode UPDATE guards plus INSERT/DELETE capture on products and bottles, opening snapshot, sale_items and bottle_movements backfills, append-only and audit triggers, per-table RLS (mgr+ read), sync_dead_letters, masking and reconciliation views, real-user check

**Files:** `supabase/migrations/20261103100000_ledgers_and_documents.sql`, `supabase/tests/05_ledger_smoke.sql`, `supabase/ops/credit_adjustment.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- (We confirm first that sql:rehearse is green.)
- Ask devices to sync to 0 pending, run the snapshot, then run this file during closed hours, immediately followed by 2.5 and 2.6 in the same session. Paste the validation table and the 05_ledger_smoke result.
- Review the credit reconciliation list (stored balance versus derived history) and say which mismatches need an explained adjustment entry (ops/credit_adjustment.sql).

**Verification:** Validation:
- v_stock_reconciliation and v_credit_reconciliation report zero differences (the bottle view reaches zero after 2.6);
- the sale_items count equals the number of JSONB lines;
- pay* sums equal totalAmount, with exceptions listed;
- every ledger rejects UPDATE and DELETE;
- the real-user check passes.

Tests:
- a direct API update of stockQuantity creates exactly one direct_write with the correct before and after values;
- an old-client bottle insert creates a direct_write bottle movement;
- a product inserted with initial stock creates a direct_write;
- a cashier selecting sale_items or stock_movements gets 0 rows, and v_sale_items returns null cost;
- a historic e-liquid sale with bottleChanges has bottle_movements rows.

**Fixes findings:** DB-12, DB-20, GAP2-1, GAP2-2, GAP2-3, GAP2-10

#### ⬜ Step 2.5: Migration 20261103110000_sale_commands: checkout, void, edit, return; legacy translators

*Effort L · depends on 2.4*

Write supabase/migrations/20261103110000_sale_commands.sql (require_migration('20261103100000')), following the command conventions.

**Mutation ids.**
- For v2, the client's p_mutation_id (= the uuid saleId) is used.
- For v1, the server derives it: saleId::uuid when saleId is a uuid, otherwise extensions.uuid_generate_v5('<fixed VapeTrax namespace uuid>', saleId). p_mutation_id is ignored for v1.
- sales.id stays text, and the duplicate check is on sales.id in the shop.

**checkout_core** (shared by checkout and edit):
- Locks products once, sorted by id. The invoice number comes from private.shop_counters, locked last.
- Stock deltas: regular is qty; refill is refillMl x qty; full_bottle is bottleSizeMl x qty.
- FIFO bottle allocation under lock: opened bottles by oldest openedDate, then closed by oldest createdAt; full bottles become sold. A shortfall is flagged bottle_shortfall, and bottles are never fabricated.
- lineTotal = round(unitPrice x qty, 2). listPrice comes from the product, and a price override is recorded with its discountAmount. unitCost is the canonical locked cost. Totals, COGS and profit are computed here.
- Per-shop rates are read from settings:
  - allowCashierPriceOverride: when false, a cashier override is PT403 online, and flagged price_override_unauthorized for offline-originated sales;
  - cashierBackdateDays;
  - defaultRefillPricePerMl as the refill fallback.
- Payment validation: non-negative parts summing to the total within 0.01. For legacy payloads up to 0.05 is absorbed into cash. Credit needs a customer of this shop.
- Writes a credit_ledger sale_credit entry.
- sales.items is regenerated as the legacy-shaped receipt snapshot.
- **Backdating** compares saleDate with the client enqueue time (p_sale_data.createdAt for v1, queuedAt for v2), never with receivedAt.
  - A future time more than 10 minutes ahead is clamped and flagged clock_skew.
  - An explicit backdate is allowed for mgr+, or for cashiers within cashierBackdateDays; beyond that it is flagged for offline-originated sales and rejected online.
  - Offline-originated sales never have saleDate rewritten.
- Accept facts for offline-originated sales: negative stock, overrides, missing_product (the line is stored with productId text and no movement) and missing_customer (a tombstone customer) produce flags and stock_alerts, not rejection. An id that exists in another shop raises PT403.

**Commands:**
- sale_checkout_v2 handles v2 and v1 ({v:1, legacy}) payloads. An existing sale id in the shop returns duplicate; in another shop it raises PT409 sale_id_conflict.
- sale_void_v2 (manager): single sale or array, with a savepoint and result per sale. It reverses stock from sale_items minus returnedQty, bottles from bottle_movements (including the backfilled historic rows) and credit from credit_ledger.
- sale_edit_v2 (manager): void plus a new sale with a new id in one transaction; the original saleDate and businessDate are kept; replaces and replacedBy are linked.
- sale_return_v2 (manager): qty at most sold minus returned, checked under lock; the refund is computed on the server; refund via cash, online or reduce_credit; optional restock.

**Legacy wrappers:**
- process_checkout becomes a thin translator into sale_checkout_v2 {v:1}. It keeps its argument names and still counts calls. Client arrays and totals are ignored, so phantom bottle creation stops for every client.
- process_reversal with delete = true becomes sale_void_v2.
- process_reversal with delete = false raises PT426 app_update_required before any side effect.
- A BEFORE DELETE trigger on sales rejects API hard deletes with use_void (defence in depth; authenticated has had no DELETE since 2.2).

app_config.schema_version = 6.

**Migrations:**
- 20261103110000_sale_commands.sql - checkout_core with server-side money, FIFO bottle allocation, ledgers, private invoice counter, per-shop override/backdate rules, enqueue-time backdate detection and accept-facts flags (missing product/customer); sale_checkout_v2 (v2 + v1 with v5 mutation ids), sale_void_v2, sale_edit_v2, sale_return_v2; process_checkout as translator, process_reversal as void / edit refused; sales hard-delete blocked

**Files:** `supabase/migrations/20261103110000_sale_commands.sql`, `supabase/tests/06_sale_commands_smoke.sql`, `supabase/tests/01_legacy_rpc_smoke.sql`, `supabase/rehearsal/fixtures.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- Run this file in the same closed-hours session, right after 2.4 validates. Paste the validation table and the 06 and 01 results.
- Decide the cashier price-override policy (default: allowed, with the list price recorded) and whether cashiers may backdate (default: 0 days). Both are per-shop settings.
- On the deployed app, using only the designated test product: an offline sale syncs; deleting a sale makes it disappear; trying to edit a bill shows an 'update required' error (Edit is hidden since R0).

**Verification:** Tests:
- regular, refill and full_bottle lines deduct correctly and allocate bottles FIFO;
- a replay returns duplicate with an identical envelope;
- the same v1 payload sent via process_checkout and via sale_checkout_v2 yields one sale;
- a Firestore-style sale id ('aB3dE5fG7hJ9kL1mN3pQ') works through process_checkout, sale_checkout_v2 {v:1} and sale_void_v2;
- an offline v1 sale synced 3 days late keeps its saleDate and gets no backdate flag;
- voiding twice restores once;
- voiding a historic e-liquid sale restores its bottles by delta;
- a v1 sale naming a missing product or customer is stored and flagged;
- a cashier override in a shop with allowCashierPriceOverride = false is PT403 online and flagged offline;
- a return beyond the sold quantity gives PT422;
- a cashier calling sale_void_v2 gets PT403;
- an edit with an invalid new cart leaves the original intact.

Stock and credit reconciliation stay at zero.

**Fixes findings:** SEC-8, FIN-6, SYNC-9, DB-11, GAP2-6, GAP2-7, GAP2-13, GAP4-6

#### ⬜ Step 2.6: Migration 20261103120000_reconcile_bottles (required)

*Effort M · depends on 2.5*

Write supabase/migrations/20261103120000_reconcile_bottles.sql (require_migration('20261103110000')) with a PREVIEW section and an APPLY section.

It runs after 2.5, because from then on no client writes bottle state through checkout (the server allocates), so the reconciliation holds.

For each e-liquid product it makes active bottle ml equal stockQuantity:
- it materialises closed bottles plus an opened remainder when bottle ml is short;
- it drains opened bottles, then the newest closed ones, when bottle ml is in excess;
- every change writes a 'reconcile' bottle_movement.

The preview lists each product with stock ml, bottle ml, the planned change, and how many repair_log 'bottle_created_at_checkout' rows explain the difference.

The file is re-runnable: until R3c, old Stock-page edits can reintroduce mismatches. v_bottle_reconciliation shows them, and the apply section can be run again.

It is a prerequisite of the transfer migration (5.1). app_config.schema_version = 7.

**Migrations:**
- 20261103120000_reconcile_bottles.sql - required, previewed and re-runnable reconciliation of active bottle ml to products.stockQuantity with 'reconcile' bottle_movements

**Files:** `supabase/migrations/20261103120000_reconcile_bottles.sql`, `supabase/tests/06b_reconcile_smoke.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- Run the PREVIEW section, review the planned changes, then run the APPLY section in the same session as 2.4 and 2.5. Paste the validation table.

**Verification:** v_bottle_reconciliation reads zero after the apply. A second apply changes nothing. In the test, a seeded product with 120 ml of stock and 90 ml of bottles gains a reconcile movement of +30, and one with excess bottles is drained, opened bottles first.

**Fixes findings:** GAP2-8

#### ⬜ Step 2.7: Migration 20261110100000_stock_party_commands: products, stock, bottles, import, customers, udhaar, expenses

*Effort L · depends on 2.6*

Write supabase/migrations/20261110100000_stock_party_commands.sql (require_migration('20261103120000')), using the same command conventions.

Product and stock commands:
- product_upsert_v2 (manager): non-stock fields only. expectedUpdatedAt gives PT409 stale. Cost changes are admin only, and price and cost changes are audited as price history. Opening stock on create is posted as a receive movement, with bottles created server-side.
- product_archive_v2 (admin): takes an array; writes off remaining stock; sets bottles.archivedAt, which act as tombstones for sync.
- stock_receive_v2 (manager): weighted-average cost computed against greatest(stock, 0), on unitCostPerMl for ml products and costPrice for pieces. Whole bottles are created closed; loose ml tops up an opened bottle.
- stock_adjust_v2 (manager): a signed delta. Removals need a reason code: damaged, expired, leaked, lost_or_stolen, tester, personal_use, count_correction, supplier_return or other. Never drives stock negative.
- stock_count_v2 (manager): delta = counted minus current, under lock, posted as count_variance.
- bottle_open_v2 and bottle_reconcile_v2 (admin).
- product_import_v2 (manager): at most 2000 rows in one transaction, with per-row validation codes. In-file duplicates are summed. Rows matching an existing product (by the bottleSizeMl key) get receive semantics; new rows get create plus an opening receive. A missing selling price uses settings.importMarkupPct. Movements are kind import with refId = importId.

Party commands:
- customer_upsert_v2 (staff): trims fields and normalises phones to +92. A duplicate phone gives PT409 with the existing id. creditBalance is never accepted; an opening balance is manager-only and goes through the ledger.
- customer_archive_v2 (admin): refuses a non-zero balance unless written off.
- credit_record_v2: payment and charge for staff; adjustment and write_off for managers; customer or party; paymentChannel. An overpayment from an offline item is accepted as an advance with a flag.
- expense_upsert_v2 (create for staff, update for managers) and expense_delete_v2 (manager; soft delete with a reason).

app_config.schema_version = 8.

**Migrations:**
- 20261110100000_stock_party_commands.sql - product_upsert/archive (bottle archivedAt tombstones), stock_receive/adjust/count with canonical cost columns, bottle_open/reconcile, product_import using per-shop markup, customer_upsert/archive, credit_record, expense_upsert/delete commands with reason codes and ledger postings

**Files:** `supabase/migrations/20261110100000_stock_party_commands.sql`, `supabase/tests/07_stock_party_smoke.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- (We confirm first that sql:rehearse is green.)
- Run 20261110100000_stock_party_commands.sql and paste the validation table and the 07 result.
- Decide whether a udhaar payment above the balance is kept as an advance (default: yes, with a warning and a flag).

**Verification:** Tests:
- two concurrent receives both apply;
- a count of 7 against stock 10 writes -3;
- 3 import rows with one in-file duplicate yield 2 products;
- two shops with different importMarkupPct price the same import row differently;
- a stale expectedUpdatedAt gives PT409;
- a cashier adjustment gives PT403;
- an adjustment without a reason gives PT422;
- customer_upsert ignores creditBalance;
- archiving a customer with a balance gives PT409;
- product_archive_v2 archives its bottles.

The reconciliation views stay at zero.

**Fixes findings:** FIN-16, GAP2-12, GAP2-15

#### ⬜ Step 2.8: Migration 20261110110000_sync_support: delta pull, sync signals, dead letters, devices, health

*Effort M · depends on 2.7*

Write supabase/migrations/20261110110000_sync_support.sql (require_migration('20261110100000')).

sync_pull_v2(p_shop_id, p_table, p_since, p_after_id, p_limit):
- tables products, customers (including parties, marked kind), bottles and settings;
- keyset paging on (updatedAt, id);
- tombstones (archived products and customers, archived or inactive bottles);
- exposes bottleSizeMl and strips cost columns for cashiers;
- limit at most 1000.

sync_signals:
- public.sync_signals(shopId, table, changedAt), primary key (shopId, table);
- SELECT for staff of the shop; no writes;
- in the supabase_realtime publication;
- bumped by statement-level AFTER triggers (REFERENCING NEW TABLE and OLD TABLE) on products, bottles, customers and settings, upserting one row per shop and table, so no pruning is needed.
Business tables are removed from supabase_realtime, guarded by pg_publication_tables. No client uses realtime on them today, and their events carry row data and cost.

Dead letters:
- report_sync_failure_v2 (staff);
- discard_sync_item_v2 (admin, needs a reason, audited);
- list_dead_letters;
- resubmit_dead_letter_v2 (admin), which replays under the original mutation id and keeps rungBy.

Devices and health:
- private.client_devices and client_heartbeat(p_shop_id, p_device_id, p_build, p_pending, p_failed, p_oldest_pending_at).
- sync_health(p_shop_id) (admin) returns per-device build, lastSeen, pending and failed; legacy_rpc_calls per day and build, including 'unknown'; and direct_write counts per day and build.

Alerts: alert_list and alert_resolve.

Client builds: private.require_client_build() gets its real body: it raises PT426 when the x-client-build header is below app_config.min_client_build.

ops/gate_contract.sql and ops/gate_retire_legacy.sql implement gates A and B, including the 'unknown' build rule.

app_config.schema_version = 9.

**Migrations:**
- 20261110110000_sync_support.sql - sync_pull_v2 keyset delta with tombstones and cost stripping, sync_signals table with statement-level triggers and realtime publication (business tables removed), dead-letter RPCs, client devices and heartbeat, sync_health telemetry incl. unknown builds, alert list/resolve, real require_client_build body

**Files:** `supabase/migrations/20261110110000_sync_support.sql`, `supabase/tests/08_sync_smoke.sql`, `supabase/ops/gate_contract.sql`, `supabase/ops/gate_retire_legacy.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- (We confirm first that sql:rehearse is green.)
- Run 20261110110000_sync_support.sql and paste the validation table and the 08 result.

**Verification:** Tests:
- a pull of 2500 products returns 3 pages with no duplicates;
- a cashier's pull lacks costPrice;
- an archived customer appears as a tombstone;
- a product update in shop A makes sync_signals visible to A's cashier but not to shop B's staff;
- a heartbeat upserts one device row;
- resubmitting a dead checkout applies once;
- sync_health reports 'unknown' builds separately.

#### ⬜ Step 2.9: Migration 20261110120000_reports: business-day reports, history search, cross-tenant test

*Effort M · depends on 2.8*

Write supabase/migrations/20261110120000_reports.sql (require_migration('20261110110000')).

Every report:
- is SECURITY DEFINER and starts with assert_shop_role;
- takes local business dates;
- uses businessDate and occurredAt with indexes;
- has no 1000-row cap;
- returns cost and profit only to mgr+.

Reports:
- report_dashboard: revenue and count; cash, online and credit; returns; voids excluded; expenses; udhaar recovered by channel; net; a daily trend; top products; open alerts.
- report_sales_page: keyset paging, bound filters, escaped search, filtered totals.
- report_expenses.
- search_stock_history: parameterised ilike via private.escape_like.
- report_udhaar: balances, ageing, per-customer and per-party statements.
- report_detailed_export: Cash, Online and Credit columns, plus a daily summary.
- report_product_sales.
- report_stock_valuation (managers).

Extra indexes on sale_items, credit_ledger, stock_movements and (shopId, businessDate).

Add tests/99_cross_tenant.sql. It loops over every public function matching '%\_v2' plus the report RPCs, calls each with another org's shop id, and asserts PT403. 5.1 extends it.

app_config.schema_version = 10.

**Migrations:**
- 20261110120000_reports.sql - report_dashboard, report_sales_page, report_expenses, search_stock_history, report_udhaar, report_detailed_export, report_product_sales, report_stock_valuation over businessDate with supporting indexes

**Files:** `supabase/migrations/20261110120000_reports.sql`, `supabase/tests/09_reports_smoke.sql`, `supabase/tests/99_cross_tenant.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- (We confirm first that sql:rehearse is green.)
- Run 20261110120000_reports.sql and paste the validation table and the 09 and 99 results.
- Compare one past day's report_dashboard totals with your paper or Excel record and report any difference.
- Confirm that 03:00 Asia/Karachi is the right business-day start.

**Verification:** Tests:
- a sale at 02:30 PKT counts on the previous business day;
- 1500 fixture sales sum exactly;
- voided sales are excluded and returns are subtracted;
- a search containing '%,().' matches literally;
- a cashier gets null profit;
- 99_cross_tenant reports PT403 for every function.

**Fixes findings:** DB-13

### Phase 3: Sync redesign (client release R2)

**Goal:** Replace the React-effect SyncEngine and the clear-and-replace cache with:
- a standalone outbox worker running versioned commands;
- keyset delta pull with an overlay of pending effects;
- refresh triggered by sync_signals;
- offline-authenticated sessions backed by memberships;
- membership-based onboarding and invites.
No queued v1 item may be lost, whatever its status.

**Done when:** R2 is deployed only after app_info().schemaVersion >= 10. The Playwright offline suite is green:
- queued v1 items of every status migrate and sync exactly once;
- an offline reload keeps deductions;
- two tabs never double-send.
sync_health shows every device on R2 within a week, and new cashiers join by invite.

#### ⬜ Step 3.1: Command client, contracts and server handshake

*Effort M · depends on 2.9, 1.11*

src/commands:
- types.ts holds payload and envelope types with zod schemas.
- registry.ts maps each command to its RPC, payload version, offline-capable flag and required role.
- client.ts provides execute(): online-only commands require connectivity; offline-capable commands go to the outbox with their local effects, are awaited for up to 8 s, and then return {queued: true}.

src/lib/errors.ts gains PTxyz classification (offline, auth, retryable, needs_update, permanent) and messages for every snake_case code. src/lib/version.ts exposes __APP_BUILD__.

src/data/appInfo.ts calls app_info() at start. When schemaVersion < REQUIRED_SCHEMA_VERSION (10), the app does **not** stop selling:
- offline-capable commands keep going into the outbox;
- the worker pauses draining;
- online-only admin commands are blocked;
- a 'Server update pending' banner is shown.
An early deploy or a rolled-back migration therefore never stops the POS.

src/types/db.ts gains overrides for every Phase 2 object, using bottleSizeMl.

**Files:** `src/commands/types.ts`, `src/commands/registry.ts`, `src/commands/client.ts`, `src/lib/errors.ts`, `src/lib/version.ts`, `src/data/appInfo.ts`, `src/types/db.ts`, `src/commands/__tests__/classify.test.ts`, `vite.config.ts`

**Verification:** classify maps PT422 to permanent, 503 to retryable, TypeError to offline, and PGRST202 and PT426 to needs_update. With REQUIRED_SCHEMA_VERSION above the server's version, e2e shows that a sale still enters the outbox, nothing drains, an admin void is blocked, and the banner shows.

#### ⬜ Step 3.2: Dexie v2 outbox, standalone sync worker and Sync Center (replaces SyncEngine)

*Effort L · depends on 3.1*

src/offline/db.ts version(2) stores:
- products '&id, shopId, [shopId+updatedAt], name';
- bottles '&id, shopId, [shopId+productId], status';
- customers '&id, shopId, [shopId+name], phone';
- salesLocal '&id, shopId, status, [shopId+businessDate]';
- outbox '++seq, &id, shopId, userId, status, [shopId+status], [status+nextAttemptAt], createdAt';
- meta '&key' and authCache '&userId'.

upgrade() runs inside Dexie's atomic upgrade transaction and copies **every** syncQueue row, whatever its status:
- process_checkout items become {command: 'sale.checkout', v: 1, id: saleId, mutationId, shopId: p_shop_id, userId: null, payload: {legacy}, status: pending or failed, retryCount, nextAttemptAt, error, queuedAt: createdAt}.
- mutationId is derived with the synchronous uuid package: saleId when it is a uuid, otherwise v5 with the same fixed namespace the server uses.
- userId is null, so any member of p_shop_id may submit the item.
- effects are computed for the overlay from p_product_updates[].deduction, p_bottle_updates, and p_customer_id with the credit increment.
- Any other type (process_stock_adjustment, process_sale, insert_customer, update_product) becomes status 'needs_review' and is shown in Sync Center.
- The number of outbox rows added must equal the syncQueue count. Otherwise upgrade() throws: Dexie stays at v1, and AppErrorBoundary offers Export.
- A JSON backup of the old queue goes into meta, and a full re-pull is flagged.
- syncQueue stays declared until v3. version(2).stores and this upgrade() are never removed.

src/offline/worker.ts is a plain module started from main.tsx:
- the per-shop Web Lock 'vapetrax-sync:<shopId>', with a lease fallback;
- wakes on online, visibilitychange, a BroadcastChannel enqueue and the earliest nextAttemptAt;
- a connectivity probe and ensureFreshSession before draining;
- sends in seq order, honouring dependsOn;
- classifies errors: offline stops (attempt not counted); auth refreshes once; retryable backs off min(5 min, 2 s x 2^n) with jitter and becomes failed after 20 attempts; needs_update parks the item; permanent marks it dead and calls report_sync_failure_v2;
- duplicate counts as success;
- envelope effects are applied in the same Dexie transaction that marks the item done;
- client_heartbeat after each drain;
- draining pauses when the server is too old (3.1).

Handlers: sale.checkout v1 and v2, customer.create, credit.record and expense.create.

NewSale enqueues a v2 checkout built by domain/checkout.buildCheckoutV2, with queuedAt, and writes a salesLocal row.

src/offline/connectivity.ts replaces the three separate listeners.

The Sync Center page at /sync (src/features/sync/SyncCenterPage.tsx) is visible to all roles: items, Retry and Export for every role; an admin-only, online-only Discard through discard_sync_item_v2 with a reason, removed locally only after the server acknowledges; needs_review items; and server dead letters with 'Re-submit as me'.

SyncStatusBadge replaces SyncEngine.tsx and ConnectivityBadge. Add the uuid dependency.

**Files:** `src/offline/db.ts`, `src/lib/db.ts`, `src/offline/outbox.ts`, `src/offline/worker.ts`, `src/offline/locks.ts`, `src/offline/connectivity.ts`, `src/offline/handlers/index.ts`, `src/offline/__tests__/db.upgrade.test.ts`, `src/offline/__tests__/worker.test.ts`, `src/domain/checkout.ts`, `src/pages/NewSale.tsx`, `src/features/sync/SyncCenterPage.tsx`, `src/features/sync/SyncStatusBadge.tsx`, `src/components/sync/SyncEngine.tsx`, `src/components/ui/ConnectivityBadge.tsx`, `src/hooks/useConnectivity.ts`, `src/App.tsx`, `src/main.tsx`, `e2e/pos-retry.spec.ts`, `e2e/outbox-upgrade.spec.ts`, `package.json`

**Verification:** fake-indexeddb tests:
- v1 fixtures with a pending item, a failed item with nextAttemptAt, a process_stock_adjustment item and a Firestore-style sale id all upgrade with the counts preserved;
- a forced count mismatch aborts the upgrade and keeps v1;
- an upgraded item's effects keep the deduction visible.

Playwright:
- 2 queued v1 sales reach the server exactly once, with none duplicated even if one was already applied;
- two tabs: only one sends;
- a forced PT422 makes the item dead and visible in the server dead letters;
- no UI path deletes a pending item;
- an offline v2 sale syncs once.

**Fixes findings:** SYNC-11, SYNC-18, SYNC-20, GAP1-9

#### ⬜ Step 3.3: Delta pull, pending-effects overlay, realtime via sync_signals, local sales history

*Effort L · depends on 3.2*

src/offline/pull.ts:
- keyset pulls through sync_pull_v2 per table, with a 2-minute overlap;
- one Dexie transaction per page;
- tombstones delete;
- a row is put only when the incoming updatedAt is at least the stored one;
- per-shop and per-table cursors in meta;
- on error it aborts without clearing anything;
- the full re-pull flagged by the Dexie upgrade runs first.

src/offline/overlay.ts: screens read the snapshot plus the summed stock and credit effects of outbox items that are not done or discarded.

src/offline/realtime.ts subscribes to **sync_signals** for the active shop only, never to base tables. A signal schedules a debounced pull of that table, and a resubscribe triggers a full delta pull. This keeps working for cashiers after the contract migration restricts base-table SELECT.

Pulls also run on login, shop switch, online, visibilitychange, after each drain and every 5 minutes while the app is visible.

src/offline/persist.ts requests navigator.storage.persist() after login. When IndexedDB is unavailable but the device is online, checkout calls sale_checkout_v2 directly and shows a banner.

src/offline/localStore.ts provides memoized hooks that read bottleSizeMl and replace DataContext. Delete src/lib/sync.ts (including the R0 interim pager) and src/contexts/DataContext.tsx.

Sales History merges pending and failed salesLocal rows, with badges.

**Files:** `src/offline/pull.ts`, `src/offline/overlay.ts`, `src/offline/realtime.ts`, `src/offline/persist.ts`, `src/offline/localStore.ts`, `src/offline/__tests__/overlay.test.ts`, `src/lib/sync.ts`, `src/contexts/DataContext.tsx`, `src/pages/Sales.tsx`, `src/pages/NewSale.tsx`, `src/pages/Stock.tsx`, `src/pages/Customers.tsx`, `src/App.tsx`

**Verification:** Overlay unit test: a pending -3 on stock 10 shows 7, and after the acknowledgement it still shows 7 with no flicker.

Playwright:
- an offline sale survives a reload, and the sale shows as Pending;
- a sync_signals event from device B triggers a pull on device A within seconds (mocked realtime);
- a fixture with 2500 products and 1500 bottles loads every row.

**Fixes findings:** SYNC-6, SYNC-7, SYNC-14, SYNC-19, FE-3, PERF-4, PERF-15, UX-1

#### ⬜ Step 3.4: Tenancy-aware auth: membership cache, onboarding, invites, team, logout rules

*Effort L · depends on 3.3, 2.1*

src/auth/session.ts generalises the R0 offline session. resolveSession() returns online, offline-authenticated (a persisted session plus a membership cache entry), unverified or signed_out. Caches are cleared only on an explicit SIGNED_OUT. ensureFreshSession runs on reconnect.

src/auth/membershipCache.ts is written only from successful my_context() responses.

AuthContext is rewritten:
- session plus my_context();
- activeShopId persisted per user and validated against memberships;
- the role comes from the active shop's membership;
- the value is memoized, and duplicate auth events are ignored;
- no profile self-provisioning and no admin fallback;
- createCashier and deleteCashier are removed.

Onboarding offers 'Create your business' (with a signup code) or 'Join with invite code', also reachable at /join/:code.

The Team tab can create invites, list members, change roles, disable or enable members, revoke invites and rename members. 'My name' uses update_my_profile.

ProtectedRoute: offline-authenticated users get the POS and offline-capable commands; online-only pages show 'Needs internet'.

Logout:
- warns about pending items;
- keeps the outbox, which any member of that shop submits later, never another shop's session;
- clears that shop's caches, the user's authCache entry and the cart keys.

Login drops the dead 'Remember me'.

**Files:** `src/auth/session.ts`, `src/auth/membershipCache.ts`, `src/contexts/AuthContext.tsx`, `src/components/layout/ProtectedRoute.tsx`, `src/components/layout/Sidebar.tsx`, `src/pages/Onboarding.tsx`, `src/pages/Login.tsx`, `src/pages/Settings.tsx`, `src/features/team/TeamTab.tsx`, `src/App.tsx`, `e2e/offline-auth.spec.ts`, `e2e/invite.spec.ts`

**Owner actions:**
- Approve the R2 deploy (steps 3.1-3.4) only after every Phase 2 migration is applied (schemaVersion 10). Otherwise the app pauses syncing behind a banner.
- Create one invite for a test cashier account and confirm joining works end to end.
- Tell staff that new cashiers join by invite code.
- After a week, check Sync Center > Sync health and confirm every POS device shows the R2 build.

**Verification:** Playwright:
- an offline reload 2 hours later opens the POS with the correct role;
- reconnecting drains the queue;
- a my_context error never changes the role;
- a user with zero memberships lands on Onboarding;
- a disabled cashier loses access on the next request;
- logout with pending items warns and keeps them;
- an item queued in shop X is never sent under a shop Y session.

**Fixes findings:** SEC-11, SEC-13, SYNC-13, FE-27, UX-31

### Phase 4: Frontend refactor, bug and UX fixes (client releases R3a-R3d)

**Goal:** Split the god pages into feature folders built on a shared accessible UI kit and a TanStack Query data layer. Move every remaining direct write onto the server commands. Wire per-shop rates into the POS and Settings. Fix the POS, receipt, sales, stock, udhaar, reports, settings and auth findings.

**Done when:** src/pages holds no business page. check-supabase-writes finds no direct table writes except settings (admin). Receipts print correctly on the shop printer. Report figures equal SQL sums over more than 1000 rows. All e2e specs are green. R3d is deployed. Releases: R3a = 4.1-4.4, R3b = 4.5-4.7, R3c = 4.8-4.9, R3d = 4.10-4.13.

#### ⬜ Step 4.1: Shared accessible UI kit and accessibility migration

*Effort L · depends on 3.4*

Create src/ui:
- Modal on native <dialog>;
- ConfirmDialog;
- IconButton with a required label;
- Field and MoneyInput (labels linked with useId, error text shown);
- RowActions, always visible below lg;
- Badge and badges.ts;
- KpiCard;
- EmptyState, ErrorState, OfflineState and Skeleton;
- DataTable (sticky header, optional virtualization);
- DateRangePicker.

Hooks: useBulkSelection, useConfirmAction and useDateRangePresets.

Migrate the roughly 12 hand-rolled overlays and the row actions, and delete ConfirmBulkDeleteModal. The Sidebar toggle gets aria-expanded, Login labels are linked, text is at least 12px, and status cues use icon plus text.

jsx-a11y becomes an error for src/ui and migrated files. Add the axe e2e spec.

**Files:** `src/ui/Modal.tsx`, `src/ui/ConfirmDialog.tsx`, `src/ui/IconButton.tsx`, `src/ui/Field.tsx`, `src/ui/MoneyInput.tsx`, `src/ui/RowActions.tsx`, `src/ui/Badge.tsx`, `src/ui/badges.ts`, `src/ui/KpiCard.tsx`, `src/ui/EmptyState.tsx`, `src/ui/ErrorState.tsx`, `src/ui/OfflineState.tsx`, `src/ui/Skeleton.tsx`, `src/ui/DataTable.tsx`, `src/ui/DateRangePicker.tsx`, `src/hooks/useBulkSelection.ts`, `src/hooks/useConfirmAction.ts`, `src/hooks/useDateRangePresets.ts`, `src/components/layout/Sidebar.tsx`, `src/pages/Login.tsx`, `src/pages/Stock.tsx`, `src/pages/Sales.tsx`, `src/pages/NewSale.tsx`, `src/pages/Customers.tsx`, `src/pages/Expenses.tsx`, `src/pages/Settings.tsx`, `src/components/ui/ConfirmBulkDeleteModal.tsx`, `src/index.css`, `e2e/a11y.spec.ts`, `eslint.config.js`

**Verification:** axe on POS, Sales, Products and an open modal finds no serious or critical violations. With the keyboard only, Tab reaches row actions, Esc closes modals and focus returns to the opener. At 375px the row actions are visible.

**Fixes findings:** UX-16, UX-17, UX-18, GAP3-13

#### ⬜ Step 4.2: App shell: lazy routes, layout route, role guards, code splitting, responsive layout, busy guard

*Effort M · depends on 4.1*

Routing:
- src/app/App.tsx and router.tsx define one layout route: AppLayout with the Sidebar, top bar, SyncStatusBadge and a RouteErrorBoundary keyed by pathname.
- Every page except the POS is lazy-loaded.
- RequireRole and useCan are driven by src/config/permissions.ts and the active membership role.

Bundling:
- manualChunks for react, supabase and data.
- recharts and SheetJS only in lazy chunks.
- Self-hosted Inter, with Google Fonts removed.

Layout:
- a top app bar below lg;
- the main margin follows the collapsed sidebar;
- safe-area padding;
- a two-pane POS from lg, and from md in landscape.

Remove the non-functional dark-mode toggle.

useBusy is a global counter, and useBeforeUnload is wired to it.

Tighten the bundle thresholds.

**Files:** `src/app/App.tsx`, `src/app/router.tsx`, `src/app/layouts/AppLayout.tsx`, `src/app/RequireRole.tsx`, `src/config/permissions.ts`, `src/App.tsx`, `src/main.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/ProtectedRoute.tsx`, `src/hooks/useBusy.ts`, `src/hooks/useBeforeUnload.ts`, `vite.config.ts`, `index.html`, `src/index.css`, `scripts/check-bundle-size.mjs`, `package.json`

**Verification:** The build shows separate route chunks, and POS entry plus vendor JS stays within the gzip budget. The smoke and roles specs are green. No Google Fonts requests are made. Navigating away during a bulk action shows the unload guard.

**Fixes findings:** PERF-8, HYG-21, UX-15, UX-29, GAP1-7

#### ⬜ Step 4.3: PWA and deployment hardening: icons, manifest, install prompt, idle updates, Vercel headers

*Effort M · depends on 4.2*

Icons and manifest:
- public/logo.svg plus pwa-assets.config.ts generate pwa-64/192/512, maskable-512, apple-touch-180 and the favicon.
- The manifest sets id, start_url and scope '/', orientation 'any', and lists any and maskable icons separately.

src/app/pwa/installPrompt.ts captures beforeinstallprompt at module load.

src/app/pwa/UpdatePrompt.tsx replaces PwaUpdatePrompt:
- it auto-applies only when idle: empty cart, useBusy at 0, no in-flight outbox item;
- it takes the sync Web Lock before updateServiceWorker(true);
- registration.update() runs every 30 minutes;
- a needs_update outbox item prompts the update.

Set workbox maximumFileSizeToCacheInBytes.

vercel.json:
- immutable caching for /assets;
- no-cache for sw.js, workbox files, registerSW, the manifest and index.html;
- Content-Security-Policy-Report-Only (self, the project's supabase.co https and wss, optional Sentry), with frame-ancestors none. No CAPTCHA origins: CAPTCHA is in the backlog;
- nosniff, X-Frame-Options DENY, Referrer-Policy and Permissions-Policy;
- a rewrite that excludes /assets and paths with a file extension.

**Files:** `public/logo.svg`, `pwa-assets.config.ts`, `vite.config.ts`, `index.html`, `src/app/pwa/installPrompt.ts`, `src/app/pwa/UpdatePrompt.tsx`, `src/hooks/usePWA.ts`, `src/components/ui/PwaUpdatePrompt.tsx`, `src/main.tsx`, `vercel.json`, `package.json`

**Owner actions:**
- Provide the real shop or brand logo (square SVG or 512x512 PNG), or approve the generated wordmark.
- After the deploy, check the preview response headers and the console for CSP report-only violations for one release.

**Verification:** The manifest is installable with no icon errors. curl -I shows the headers. /missing.png returns 404. A new build shows the update toast and does not reload while the cart has items. pos-offline-reload is green.

**Fixes findings:** SYNC-17, HYG-10, HYG-19, PERF-9, UX-26, SEC-18

#### ⬜ Step 4.4: Query layer (TanStack Query), repositories, QueryState and shared shop settings

*Effort L · depends on 4.2*

Install @tanstack/react-query, with devtools in DEV only.

src/data:
- supabase.ts;
- queryClient.ts (staleTime 30s, retry through isRetryable, networkMode online);
- keys.ts (['shop', shopId, ...]);
- paging.ts (fetchAllPages, replacing the R0 interim helper);
- pgrst.ts (quote, escapeLike);
- repos for sales, expenses, inventoryLogs, settings, credits, customers, products, profiles and reports. They read the v_* views, select explicit columns (bottleSizeMl, not bottleSize), filter on businessDate or saleDate, and wrap every call in must().

src/ui/QueryState.tsx: ErrorState with Retry, OfflineState, a Skeleton on first load only, and KPI dashes on error.

ShopSettingsProvider and useShopSettings replace the three settings fetches and expose the per-shop rates with businessRules fallbacks.

Migrate the read sites to useQuery or useInfiniteQuery with keepPreviousData, plus 'Showing N of M' and Load more.

Delete src/hooks/useSupabaseOnce.ts and src/lib/fetchAllPages.ts, and tighten no-restricted-imports.

**Files:** `src/data/supabase.ts`, `src/data/queryClient.ts`, `src/data/keys.ts`, `src/data/paging.ts`, `src/data/pgrst.ts`, `src/data/repos/sales.ts`, `src/data/repos/expenses.ts`, `src/data/repos/inventoryLogs.ts`, `src/data/repos/settings.ts`, `src/data/repos/credits.ts`, `src/data/repos/customers.ts`, `src/data/repos/products.ts`, `src/data/repos/profiles.ts`, `src/data/repos/reports.ts`, `src/ui/QueryState.tsx`, `src/app/providers/QueryProvider.tsx`, `src/features/settings/ShopSettingsProvider.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Sales.tsx`, `src/pages/Expenses.tsx`, `src/pages/InventoryLogs.tsx`, `src/pages/DetailedReports.tsx`, `src/pages/Settings.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/credits/CustomerCreditHistoryModal.tsx`, `src/hooks/useSupabaseOnce.ts`, `src/lib/fetchAllPages.ts`, `src/lib/supabase.ts`, `eslint.config.js`, `package.json`

**Owner actions:**
- Approve deploying R3a (steps 4.1-4.4) after the preview checklist.

**Verification:** Unit tests cover fetchAllPages over 2500 rows and pgrst.quote.

In e2e:
- typing in a filter keeps focus;
- a mocked 500 shows ErrorState and KPI dashes, not Rs 0;
- offline shows OfflineState;
- a backdated or offline sale lands on the same business day on Sales, Dashboard and Reports.

**Fixes findings:** GAP3-11, FE-11, FE-18, FE-19, UX-24

#### ⬜ Step 4.5: POS feature split, checkout v2 builder, replace mode, per-shop rates in the POS

*Effort L · depends on 4.4, 4.1*

Create src/features/pos:
- PosPage;
- ProductSearch (autofocus; Enter adds the exact or top match);
- ProductGrid and ProductCard (memoized, deferred search);
- CartPanel and CartLine;
- PaymentMethodSelector;
- SplitPaymentFields (auto-fill the remainder);
- CashTenderedField (change due);
- CustomerPicker: shows phone and udhaar balance, and warns above settings.creditWarnThreshold;
- RefillModal: presets from settings.refillPresetsMl, and price from the product's pricePerMl, else settings.defaultRefillPricePerMl, else an explicit entry. No silent Rs 100/ml fallback;
- a price override control that honours settings.allowCashierPriceOverride;
- SaleDateOverride, shown when can('sales.backdate'), limited to cashierBackdateDays for cashiers;
- EditingBanner;
- CheckoutSuccessPanel.

useCart is a reducer keyed vt:cart:{shopId}:{userId}. It is not persisted in replace mode.

useCheckout builds the v2 command (lines with listPrice and unitPrice, client time, queuedAt) and calls execute('sale.checkout').

Replace mode: Edit, started from Sales History, loads a separate edit cart. Submit is online-only and calls sale_edit_v2.

Shortcuts: F2, F4, F9 and Esc. Below md the cart is a bottom sheet.

Delete src/pages/NewSale.tsx.

GAP4-5: the balance display and warning are delivered here. A server-enforced credit limit is in the backlog.

**Files:** `src/features/pos/PosPage.tsx`, `src/features/pos/components/ProductSearch.tsx`, `src/features/pos/components/ProductGrid.tsx`, `src/features/pos/components/CartPanel.tsx`, `src/features/pos/components/SplitPaymentFields.tsx`, `src/features/pos/components/CashTenderedField.tsx`, `src/features/pos/components/CustomerPicker.tsx`, `src/features/pos/components/RefillModal.tsx`, `src/features/pos/components/EditingBanner.tsx`, `src/features/pos/components/CheckoutSuccessPanel.tsx`, `src/features/pos/hooks/useCart.ts`, `src/features/pos/hooks/useCheckout.ts`, `src/domain/checkout.ts`, `src/domain/checkout.test.ts`, `src/pages/NewSale.tsx`, `tsconfig.strict.json`, `e2e/pos-online.spec.ts`, `e2e/pos-offline.spec.ts`, `e2e/replace-sale.spec.ts`, `e2e/shop-rates.spec.ts`

**Verification:** e2e:
- online and offline sales;
- split auto-fill and change due;
- Enter-to-add;
- a cashier cannot backdate beyond the shop setting;
- the v2 payload has no actorName, cost or bottle state;
- two shops with different defaultRefillPricePerMl and presets price the same refill differently;
- a shop with overrides disabled hides the control for cashiers;
- an invalid edit leaves the original sale intact;
- typing latency stays under 50 ms with 800 products.

**Fixes findings:** FIN-2, FE-2, FE-17, SYNC-12, UX-8, UX-12, UX-13, UX-14, PERF-12

#### ⬜ Step 4.6: Receipt printing (58/80 mm thermal) and correct invoices

*Effort M · depends on 4.5*

Create src/features/receipt:
- Receipt shows:
  - shop details per the show toggles;
  - invoicePrefix plus invoiceNo once synced ('Pending sync' plus a short id offline);
  - Karachi date and time, cashier and customer;
  - lines with list versus sold price;
  - totals and the payment breakdown;
  - the status (Paid, Udhaar or Partially paid) and the udhaar balance after the sale;
  - the footer: invoiceFooter, falling back to footerMessage.
- PrintPortal into #print-root.
- print.css (48 or 72 mm widths).
- useReceiptPrint, which injects an @page size.

Paper width and auto-print are per-device settings.

CheckoutSuccessPanel gets 'Print receipt' (P) and 'New sale' (Enter). Sales detail reprints. src/domain/receipt.ts is unit-tested.

**Files:** `src/features/receipt/Receipt.tsx`, `src/features/receipt/PrintPortal.tsx`, `src/features/receipt/print.css`, `src/features/receipt/useReceiptPrint.ts`, `src/domain/receipt.ts`, `src/domain/receipt.test.ts`, `index.html`, `src/features/pos/components/CheckoutSuccessPanel.tsx`, `e2e/receipt-print.spec.ts`

**Owner actions:**
- Tell us the receipt printer model, the paper width, and whether printing is from Android or Windows. Then test-print one receipt.

**Verification:** The emulateMedia print test shows only #print-root, at the configured width. A credit sale prints Udhaar with the balance. An offline sale prints 'Pending sync', and its reprint after sync shows the invoice number.

**Fixes findings:** UX-3, UX-9, GAP4-8

#### ⬜ Step 4.7: Sales history split: void, return, bulk void, cashier attribution

*Effort L · depends on 4.6*

Create src/features/sales:
- SalesHistoryPage;
- SalesFilters (business-day presets, cashier filter);
- SalesKpis from report_dashboard;
- SalesTable (report_sales_page paging, merged pending outbox sales, voided, returned and edited badges);
- SaleDetailModal (receipt, reprint, Edit opens replace mode);
- VoidSaleDialog (reason; execute('sale.void'));
- ReturnItemsModal (execute('sale.return'), replacing remove-item);
- BulkVoidDialog (one array call with per-id results).

Rows are removed optimistically, with a refetch in finally and a per-row busy lock.

Delete src/lib/salesReversal.ts, src/lib/actor.ts and src/pages/Sales.tsx.

**Files:** `src/features/sales/SalesHistoryPage.tsx`, `src/features/sales/components/SalesFilters.tsx`, `src/features/sales/components/SalesTable.tsx`, `src/features/sales/components/SaleDetailModal.tsx`, `src/features/sales/components/VoidSaleDialog.tsx`, `src/features/sales/components/ReturnItemsModal.tsx`, `src/features/sales/components/BulkVoidDialog.tsx`, `src/features/sales/hooks/useSalesPages.ts`, `src/features/sales/hooks/useVoidSale.ts`, `src/features/sales/hooks/useReturnItems.ts`, `src/data/repos/sales.ts`, `src/lib/salesReversal.ts`, `src/lib/actor.ts`, `src/pages/Sales.tsx`, `e2e/void-sale.spec.ts`, `e2e/return-items.spec.ts`

**Owner actions:**
- Approve deploying R3b (steps 4.5-4.7). Then show staff the new Void, Return and Edit flows and the receipt button.

**Verification:** e2e:
- a second void is impossible (button disabled; a server duplicate shows 'already voided');
- returning 1 of 3 units restores 1;
- returns from two rows of one invoice never bring an item back;
- a bulk void of 5 makes one request;
- a pending offline sale is listed;
- 1500 sales page correctly.

**Fixes findings:** FIN-4, FE-7, UX-11, GAP1-8, GAP3-4, PERF-13, GAP4-7

#### ⬜ Step 4.8: Products and stock on commands: metadata form, delta adjustments with reasons, counts, archive, import wizard

*Effort L · depends on 4.4, 4.1*

Create src/features/products:
- ProductsPage, ProductTable and ProductFilters.
- ProductFormModal (zod plus react-hook-form): metadata only. bottleSizeMl is a numeric input. The minStockLevel default comes from settings.lowStockThreshold. Calls product.upsert with expectedUpdatedAt.
- StockAdjustModal: Receive, Adjust (signed qty plus a required reason code) and Count.
- BottleModal: open and reconcile.
- ArchiveProductDialog.
- ImportWizard: a Web Worker running parseProductSheet with lazy SheetJS; a preview with an invalid-only filter and a rejected-rows CSV; one product.import call. Missing prices use the shop's importMarkupPct.

Remove the five bottle-creation copies, the client weighted-cost maths, every absolute stock write, and the R1 compare-and-set path. Every write goes through commands.execute, and the effects refresh Dexie.

Delete src/pages/Stock.tsx.

**Files:** `src/features/products/ProductsPage.tsx`, `src/features/products/components/ProductTable.tsx`, `src/features/products/components/ProductFormModal.tsx`, `src/features/products/components/StockAdjustModal.tsx`, `src/features/products/components/BottleModal.tsx`, `src/features/products/components/ArchiveProductDialog.tsx`, `src/features/products/import/ImportWizard.tsx`, `src/features/products/import/parse.worker.ts`, `src/features/products/hooks/useProductCommands.ts`, `src/domain/stockAdjustment.ts`, `src/domain/stockAdjustment.test.ts`, `src/data/repos/products.ts`, `src/pages/Stock.tsx`, `e2e/stock-adjust.spec.ts`, `e2e/import.spec.ts`

**Verification:** e2e:
- two devices each receive 5, for a final +10;
- a removal without a reason is blocked;
- a 300-row import with a duplicate makes one call;
- an archived product disappears from the POS after the next pull;
- the form rejects a selling price of 0 and a negative cost;
- a count of 7 on stock 10 shows a -3 movement.

**Fixes findings:** SYNC-8, FE-4, GAP1-5, GAP1-10, GAP3-2, GAP4-10, GAP4-13

#### ⬜ Step 4.9: Customers, udhaar, parties and expenses on commands

*Effort M · depends on 4.4, 4.1*

Create src/features/customers:
- CustomersPage: the active-customers KPI comes from the last 30 days; Archive replaces delete and is admin only; an 'Other parties' tab is read through report_udhaar.
- CustomerModal: zod, +92 phone normalisation, read-only balance, an opening balance for admins only, works offline via customer.create.
- AddCreditModal: balance before and after; overpayment labelled 'advance' with confirmation; entityContact saved; payment channel; credit.record online or offline.
- CreditHistoryModal: report_udhaar statements.

Create src/features/expenses:
- ExpensesPage: server paging plus a summary from report_expenses, with a Total Expenses amount, correct period labels, top category by amount, and 'Owner drawings' shown separately and excluded from net profit.
- ExpenseModal: date defaults to todayKarachi; payment channel; expense.upsert, offline-capable for create. Delete calls expense.delete with a reason.

Remove the R1 compare-and-set credit path. Delete the legacy pages and components.

**Files:** `src/features/customers/CustomersPage.tsx`, `src/features/customers/components/CustomerModal.tsx`, `src/features/customers/components/AddCreditModal.tsx`, `src/features/customers/components/CreditHistoryModal.tsx`, `src/features/customers/components/PartiesTab.tsx`, `src/features/expenses/ExpensesPage.tsx`, `src/features/expenses/components/ExpenseModal.tsx`, `src/data/repos/customers.ts`, `src/data/repos/credits.ts`, `src/data/repos/expenses.ts`, `src/pages/Customers.tsx`, `src/pages/Expenses.tsx`, `src/components/customers/CustomerModal.tsx`, `src/components/credits/AddCreditModal.tsx`, `src/components/credits/CustomerCreditHistoryModal.tsx`, `src/lib/credits.ts`, `e2e/udhaar.spec.ts`, `e2e/expenses.spec.ts`

**Owner actions:**
- Approve deploying R3c (steps 4.8-4.9).

**Verification:** e2e:
- Rs 600 received on a Rs 500 balance warns and records an advance;
- an offline payment lowers the shown balance immediately;
- editing a customer never changes the balance;
- archiving a customer with a balance is blocked;
- the parties tab shows the migrated balances;
- expense totals match the summary.

**Fixes findings:** UX-25, UX-20, FE-23, PERF-10, GAP2-11, GAP4-2, GAP4-4

#### ⬜ Step 4.10: Dashboard and alerts on report RPCs

*Effort M · depends on 4.4*

src/features/reports/DashboardPage:
- periods labelled TODAY'S, THIS WEEK'S, THIS MONTH'S or SELECTED;
- Karachi business-day bounds using the shop's start hour, with 'today' recomputed when the window regains focus;
- data from report_dashboard.

Cards:
- 'Cash sales', with udhaar recovered shown separately and broken down by payment channel;
- revenue, profit (managers only), expenses and net.

The low-stock list uses minStockLevel and lowStockThreshold.

AlertsPanel shows negative stock, bottle mismatches, clock skew, payment mismatches and flagged sales (including missing_product and missing_customer), with resolve.

The chart is lazy-loaded recharts.

Delete useDashboardAggregations.ts and src/pages/Dashboard.tsx.

GAP4-3: the payment-channel split is delivered here. Cash sessions and the Z-report are in the backlog.

**Files:** `src/features/reports/DashboardPage.tsx`, `src/features/reports/components/KpiGrid.tsx`, `src/features/reports/components/SalesTrendChart.tsx`, `src/features/alerts/AlertsPanel.tsx`, `src/data/repos/reports.ts`, `src/hooks/useDashboardAggregations.ts`, `src/pages/Dashboard.tsx`, `e2e/dashboard.spec.ts`

**Owner actions:**
- Compare one day's Dashboard totals with your cash count for that day and report any difference.

**Verification:** On a 1500-sale fixture:
- revenue equals the SQL sum;
- a 01:30 PKT sale counts on the previous business day everywhere;
- the weekly tab is labelled correctly;
- a negative-stock alert shows and can be resolved;
- offline shows OfflineState.

**Fixes findings:** FE-12, FIN-18, FIN-19, PERF-2, PERF-14, UX-19

#### ⬜ Step 4.11: Detailed Reports and Inventory Logs on report RPCs

*Effort M · depends on 4.4*

DetailedReportsPage:
- covers the exact selected range through report_detailed_export pages;
- item names come from productName;
- payment labels are correct;
- Print uses an A4 stylesheet;
- the Excel export runs in a worker with Cash, Online and Credit columns plus a 'Daily summary' sheet (Date, Day, Cash, Online, Credit, Udhaar recovered, Expenses, Total).

InventoryLogsPage:
- search_stock_history with a bound search term;
- filter options from stock_movements kinds plus the legacy types;
- ml or pcs units;
- manual removals highlighted with reason codes;
- a missing role shows 'Unknown';
- a per-product running qtyAfter view;
- keyset paging, with no full-page spinner on refetch.

Delete the legacy pages.

**Files:** `src/features/reports/DetailedReportsPage.tsx`, `src/features/reports/print-a4.css`, `src/workers/xlsxExport.worker.ts`, `src/features/inventory-logs/InventoryLogsPage.tsx`, `src/data/repos/reports.ts`, `src/data/repos/inventoryLogs.ts`, `src/pages/DetailedReports.tsx`, `src/pages/InventoryLogs.tsx`, `e2e/reports.spec.ts`, `e2e/inventory-logs.spec.ts`

**Verification:** A 120-day range over 2000 sales returns every row. Print shows only the A4 report. The export has the split columns and the Daily summary sheet. The 'deduction' filter matches. A search with a comma, parenthesis and dot matches literally. Focus is kept while typing.

**Fixes findings:** FIN-23, FE-20, FE-21, PERF-11, UX-21, UX-22, UX-23, GAP2-14, GAP4-11, SEC-21

#### ⬜ Step 4.12: Settings split: every field wired or removed, per-shop rates tab, complete backup export

*Effort M · depends on 4.6, 4.4*

src/features/settings, with routed tabs:
- ShopProfileTab: name, address, phone, email and logoUrl, plus the shop timezone and business-day start for the owner (via update_shop).
- ReceiptTab: paper width, auto-print, invoiceFooter, invoicePrefix and the show toggles.
- InventoryRulesTab: lowStockThreshold.
- **RatesTab** (admin): defaultRefillPricePerMl, refillPresetsMl, importMarkupPct, allowCashierPriceOverride, cashierBackdateDays and creditWarnThreshold.
- BackupTab: export.
- AccountTab.
- AppTab: version, install, persistent-storage status, clear local data.

Remove themeColor, accentColor, currency, taxRate and showTaxDetails.

useUpdateShopSettings upserts only the changed fields. Save stays disabled when the load failed.

The backup export covers every shop table, including sale_items, sale_returns, credit_ledger, stock_movements and bottle_movements, with schemaVersion, counts cross-checked against head counts, and a SHA-256 checksum. Restore stays disabled.

Delete src/pages/Settings.tsx, BackupRestoreTab.tsx and src/lib/backup.ts.

**Files:** `src/features/settings/SettingsPage.tsx`, `src/features/settings/tabs/ShopProfileTab.tsx`, `src/features/settings/tabs/ReceiptTab.tsx`, `src/features/settings/tabs/InventoryRulesTab.tsx`, `src/features/settings/tabs/RatesTab.tsx`, `src/features/settings/tabs/BackupTab.tsx`, `src/features/settings/tabs/AccountTab.tsx`, `src/features/settings/tabs/AppTab.tsx`, `src/features/settings/useUpdateShopSettings.ts`, `src/features/settings/backup/exportShop.ts`, `src/pages/Settings.tsx`, `src/components/settings/BackupRestoreTab.tsx`, `src/lib/backup.ts`, `e2e/settings.spec.ts`

**Owner actions:**
- Review the per-shop rates in Settings > Rates and correct them.
- Download a fresh backup after this release and keep it off the device.

**Verification:** e2e:
- a failed load disables Save;
- saving only shopPhone sends only shopPhone;
- changing defaultRefillPricePerMl changes the next refill price in the POS;
- an export of 2500 sales passes the count and checksum checks;
- no removed control remains.

**Fixes findings:** FE-22, UX-10

#### ⬜ Step 4.13: Auth hardening: password policy, recovery flow, server-enforced sensitive actions

*Effort S · depends on 3.4, 4.1*

Owner Supabase Auth settings: minimum password length 10, leaked-password protection, email confirmation, and the correct Site URL and redirect URLs.

CAPTCHA is deliberately **not** enabled. Turning it on without a client widget would lock every client out of login, so it is in the backlog.

Client:
- login and signup enforce the same minimum, with password confirmation;
- a /reset-password route handles PASSWORD_RECOVERY with auth.updateUser, and resetPasswordForEmail passes redirectTo;
- secureAction is replaced by useConfirmAction, because the server enforces roles;
- network failures are no longer reported as 'Incorrect password'.

**Files:** `src/features/auth/LoginPage.tsx`, `src/features/auth/ResetPasswordPage.tsx`, `src/pages/Login.tsx`, `src/app/router.tsx`, `src/contexts/AuthContext.tsx`, `src/lib/secureAction.ts`, `src/hooks/useConfirmAction.ts`, `e2e/auth.spec.ts`

**Owner actions:**
- Apply the listed Auth settings in the Supabase dashboard. Do not enable CAPTCHA.
- Approve deploying R3d (steps 4.10-4.13).

**Verification:** A reset-password link lands on /reset-password and changes the password. A 7-character password is rejected. A Google-login admin can void a sale without a password prompt, while a cashier gets the server's 403 message. A network failure shows the offline message.

**Fixes findings:** SEC-17, SEC-23

### Phase 5: Multi-shop UI and shop-to-shop stock transfers (release R4)

**Goal:** Let one owner run several shops, each with its own inventory, prices and rates. Owners can create, update, archive, link and clone shops, and move stock between linked shops atomically: one server transaction deducts at the sender and adds at the receiver, replacing today's two manual adjustments.

**Done when:** 20261124100000_catalog_and_transfers is rehearsed green, applied, and its transfer and cross-tenant tests pass. The owner can create, switch, update, link and clone shops. One real transfer reconciles with physical counts in both shops. The reconciliation views still read zero.

#### ⬜ Step 5.1: Migration 20261124100000_catalog_and_transfers

*Effort L · depends on 2.9, 2.6*

Write supabase/migrations/20261124100000_catalog_and_transfers.sql (require_migration('20261110120000', '20261103120000')). The reconciliation file is a hard prerequisite.

Catalog:
- catalog_items (orgId, name, category, brand, stockUnit, bottleSizeMl, archivedAt), unique on (orgId, lower(btrim(name)), category, coalesce(bottleSizeMl, 0)) where archivedAt is null.
- products.catalogItemId is backfilled, with unique(shopId, catalogItemId) where deletedAt is null.
- New product flags: catalogLinkedManually and priceReviewNeeded, both boolean default false.
- A BEFORE INSERT or UPDATE trigger finds or creates the catalog item with INSERT ... ON CONFLICT DO NOTHING, then re-selects. On a change of name, category or bottleSizeMl it re-resolves, unless catalogLinkedManually is set.
- link_product_to_catalog_v2 (manager) requires catalog_items.orgId to equal the org of the product's shop, plus has_shop_role(product shop, mgr). A unit or size mismatch is refused. It sets catalogLinkedManually.

Tables:
- stock_transfers: orgId, transferNo (from private.org_counters), fromShopId and toShopId with same-org composite FKs and a from <> to check, status, note, totalCost, created and reversed fields, reversesTransferId, mutationId unique per org, clientBuild. Unique index on reversesTransferId where it is not null.
- stock_transfer_items: product ids as text with composite FKs, unit, qty, bottleCount, bottleSizeMl, looseMl, unitCost, lineCost, sourceBottleIds, createdDestProduct.

RLS (extends validate_rls):
- catalog_items: SELECT for org members.
- stock_transfers and stock_transfer_items: SELECT for mgr+ of either shop, or the org owner. No writes.

Helpers:
- unit_cost: the canonical cost column.
- find_or_create_counterpart: ON CONFLICT DO NOTHING plus a re-select FOR UPDATE. Copies the sender's selling prices with priceReviewNeeded = true and stock 0.
- lock_transfer_products: (shopId, id) order.
- transfer_bottles_out: sealed bottles FIFO get status 'transferred' and remainingMl = 0, with before and after kept in bottle_movements; loose ml is drained from opened bottles. Too few sealed rows raises PT409 insufficient_bottles.
- transfer_bottles_in: closed bottles with sourceBottleId, plus one opened bottle for loose ml.

The base-table bottles SELECT hides 'transferred'.

Commands:
- stock_transfer_create_v2: owner, or admin or manager in both shops; both shops usable, same org and linked; 0 <= looseMl < bottleSizeMl; the sender never goes negative; transfer_out and transfer_in with the same refId; weighted cost; no revenue; idempotent and audited; sync_signals bumped for both shops.
- stock_transfer_reverse_v2: first runs select ... from stock_transfers where id = $1 and orgId = (caller's org) for update, then checks status = 'completed', then locks products in (shopId, id) order. Allowed only if the receiver still holds the quantity. Posts transfer_reverse on both sides.
- list_stock_transfers and get_stock_transfer: staff of either shop and the owner, with unitCost, lineCost and totalCost null for non-managers.
- clone_catalog_to_shop(p_from_shop, p_to_shop, p_copy_prices): requires from.orgId = to.orgId, is_org_owner, and both shops usable, otherwise PT403. Copies products at zero stock and copies the per-shop rates.
- create_shop gains an optional catalog clone.

Also:
- the kind and status checks gain transfer_reverse and transferred;
- v_stock_history shows transfers;
- statement triggers on stock_transfers bump sync_signals.

Extend 99_cross_tenant.sql to cover the new RPCs.

**Migrations:**
- 20261124100000_catalog_and_transfers.sql - org catalog_items with re-resolving products.catalogItemId backfill, catalogLinkedManually/priceReviewNeeded, stock_transfers and items with per-table RLS and masked cost, atomic stock_transfer_create_v2 and locked stock_transfer_reverse_v2 with bottle handling (transferred bottles zeroed and hidden, insufficient_bottles) and weighted cost, same-org clone_catalog_to_shop and link_product_to_catalog_v2, sync_signals triggers

**Files:** `supabase/migrations/20261124100000_catalog_and_transfers.sql`, `supabase/tests/10_transfer_smoke.sql`, `supabase/tests/99_cross_tenant.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- (We confirm first that sql:rehearse is green.)
- Ask devices to sync to 0 pending and run the snapshot. Run the file during closed hours: the catalogItemId backfill updates every product row. Paste the validation table and the 10 and 99 results.
- Confirm the transfer rules:
- one-step atomic transfer;
- allowed for the owner or a user who is admin or manager in both shops;
- the shops must be linked;
- stock moves at the sender's average cost;
- the receiver keeps its own prices;
- new receiver products copy the sender's price for review;
- the sender never goes negative.

**Verification:** Tests:
- transferring 5 pieces, and 2 sealed bottles plus 15 ml, moves identical amounts with matching refIds;
- the receiver's cost is the weighted average;
- a missing receiver product is auto-created and flagged for price review;
- each of these is rejected with nothing changed: unlinked shops, another org, a cashier caller, **admin in A only** (PT403), insufficient stock, too few sealed bottles, looseMl >= bottle size;
- clone_catalog_to_shop and link_product_to_catalog_v2 with a foreign org give PT403;
- the same mutation id twice creates one transfer;
- two concurrent reverses post exactly one reversal;
- concurrent A-to-B and B-to-A transfers do not deadlock;
- a cashier gets null costs from get_stock_transfer;
- transferred bottles are hidden from base SELECT.

The reconciliation views stay at zero.

#### ⬜ Step 5.2: Multi-shop management UI: shop switcher, shops, links, catalog cloning

*Effort M · depends on 5.1, 4.12*

ShopSwitcher in the sidebar header:
- lists memberships with role badges;
- switching is blocked while busy;
- the cart is kept per shop;
- a delta pull runs for the new shop;
- the outbox drains every shop's items under their own shopId.

/shops (owner only, src/features/shops):
- lists owned shops with member counts;
- 'Create shop' calls create_shop, optionally cloning the catalog with or without prices; the rates are copied;
- rename, timezone and business-day start go through update_shop;
- 'Archive shop' calls archive_shop and shows its refusal reasons;
- 'Linked shops' connects or disconnects pairs through link_shops and unlink_shops, offering same-org shops only.

The permission matrix drives menus per active shop. R4 requires app_info().migrations to include catalog_and_transfers.

**Files:** `src/features/shops/ShopSwitcher.tsx`, `src/features/shops/ShopsPage.tsx`, `src/features/shops/LinkedShopsPanel.tsx`, `src/features/shops/CreateShopDialog.tsx`, `src/features/shops/EditShopDialog.tsx`, `src/data/repos/shops.ts`, `src/contexts/AuthContext.tsx`, `src/config/permissions.ts`, `src/app/router.tsx`, `src/types/db.ts`, `e2e/multishop.spec.ts`

**Owner actions:**
- Deploy only after 20261124100000 is validated.
- Create the second shop (or have its owner sign up with a code from ops/create_org_signup_code.sql), clone the catalog, set its prices and rates, and link the two shops.

**Verification:** e2e:
- an owner with two shops sees each shop's own products, prices and rates;
- the cart differs per shop;
- renaming a shop and changing its timezone work, and an invalid timezone is rejected;
- archiving a shop that still has stock is refused;
- a cashier sees no switcher and cannot open /shops or /transfers;
- cross-org linking is impossible.

#### ⬜ Step 5.3: Shop-to-shop transfer screens

*Effort L · depends on 5.2, 4.8*

Create src/features/transfers.

/transfers:
- Outgoing, Incoming and All tabs;
- filters;
- columns: number, from, to, lines, cost (managers only), user, time, status;
- export.

/transfers/new is a wizard:
1. Shops: linked shops only.
2. Items: server search of the source shop's products, showing available stock. Devices and coils take a unit quantity; e-liquid takes sealed bottles plus loose ml (less than the bottle size).
   - A warning appears when this device has unsynced sales.
   - Per-device pending counts and last-seen times for the sending shop come from sync_health. When any device reports pending > 0, or has not been seen for over 1 hour, the user must confirm.
   - Offline sales arriving later are accepted and raise negative_stock alerts.
3. Mapping: always shown. Auto-matches by catalogItemId. Otherwise pick an existing destination product (link_product_to_catalog_v2) or 'create in destination' with a price. The destination's existing prices are never overwritten.
4. Review: 'Deduct from A, add to B', then execute('transfer.create') with a client mutation id. Online only.

/transfers/:id shows the lines and linked movements, a printable transfer note, and 'Reverse transfer' with a reason.

src/domain/transfer.ts validates the transfer and is unit-tested. After success, both shops' queries are invalidated and the active shop is pulled.

**Files:** `src/features/transfers/TransfersPage.tsx`, `src/features/transfers/NewTransferWizard.tsx`, `src/features/transfers/TransferDetailPage.tsx`, `src/features/transfers/TransferNote.tsx`, `src/domain/transfer.ts`, `src/domain/transfer.test.ts`, `src/data/repos/transfers.ts`, `src/commands/registry.ts`, `src/app/router.tsx`, `src/components/layout/Sidebar.tsx`, `e2e/transfer.spec.ts`

**Owner actions:**
- Approve deploying R4 (steps 5.2-5.3).
- Do one small real transfer, then compare both shops' stock and stock history with a physical count.

**Verification:** e2e:
- 2 devices and 3 sealed bottles move from A to B, an existing destination price is unchanged, and a new product gets the entered price;
- a retry after a dropped response creates one transfer;
- the insufficient_stock and insufficient_bottles messages show;
- a device with pending sales triggers the confirmation;
- reverse restores both shops;
- offline disables submit;
- a cashier cannot open the page.

### Phase 6: Contract, legacy removal and documentation

**Goal:** Once telemetry proves old clients are gone:
- enforce command-only writes and cost masking;
- convert the shadowed columns and add the remaining constraints;
- drop dead tables, duplicate columns, legacy helpers and the legacy RPC bodies;
- finish strict typing and CSP enforcement;
- document the system and the backlog.

**Done when:** Gates A and B are passed and recorded. The contract, cleanup and retire-legacy migrations are rehearsed, applied and validated. Strict TypeScript and zero-any lint pass in CI. The CSP is enforced. README, ARCHITECTURE and BACKLOG are published.

#### ⬜ Step 6.1: Migration 20261215100000_contract_lockdown (gate A)

*Effort M · depends on 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13*

Gate A, checked with ops/gate_contract.sql (the owner pastes the result; continue only if it passes):
- zero direct_write rows in stock_movements, bottle_movements and credit_ledger for 7 days;
- no 'unknown' clientBuild in legacy_rpc_calls or in direct_write rows for 14 days;
- sync_health shows every device seen in the last 14 days on R3d or later;
- the owner confirms every POS device was opened after R3d.
This gate does not depend on the transfer release.

Then write 20261215100000_contract_lockdown.sql (require_migration('20261110120000')). If the transfer migration has not been applied yet, this file is authored first and gets the earlier timestamp.
- Set the flags enforce_stock_ledger, enforce_credit_ledger and enforce_bottle_ledger to on.
- Revoke INSERT, UPDATE and DELETE on products, bottles, sale_items, customers, credits, inventory_logs, expenses and stock_alerts from authenticated. Sales writes were already revoked in 2.2; settings writes stay for admins.
- Drop the legacy profiles insert path and the createCashier bridge. update_my_profile remains.
- Restrict base-table SELECT on products, sales and sale_items to managers. Cashiers then read only v_products, v_sales, v_sale_items and sync_pull_v2, and realtime keeps working through sync_signals.
- Stop the 'others' credits trigger, because credits is now write-revoked.

The real-user check is repeated. The validation confirms that no authenticated write privilege remains on the guarded tables and that cashiers cannot see cost columns.

**Migrations:**
- 20261215100000_contract_lockdown.sql - gate A satisfied; enforce ledger guards; revoke direct table writes; remove legacy profile insert/bridge paths; cashier reads only through masking views and sync_pull_v2; real-user check

**Files:** `supabase/migrations/20261215100000_contract_lockdown.sql`, `supabase/tests/11_contract_smoke.sql`, `supabase/ops/gate_contract.sql`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- Run ops/gate_contract.sql and paste the result. Continue only if it passes.
- Ask all staff to confirm the app shows the current version.
- (We confirm first that sql:rehearse is green.) Run the snapshot, then this file, and paste the validation table and the 11_contract_smoke result.

**Verification:** Validation passes, including the real-user check.

The tests show:
- a direct API update of stockQuantity raises stock_changes_must_use_rpc;
- a cashier selecting costPrice from products gets no rows, while v_products returns a null cost;
- a cashier still receives the sync_signals row after a transfer or receive into their shop.

A normal trading day on R3d works unchanged.

#### ⬜ Step 6.2: Migration 20261215110000_legacy_cleanup: type conversions, remaining constraints, drops

*Effort M · depends on 6.1*

Write 20261215110000_legacy_cleanup.sql (require_migration('20261215100000')). It snapshots first. Before every DROP COLUMN it queries pg_depend and greps pg_proc.prosrc for the column name, aborting with the list of dependents if any are found. Views are recreated first, and CASCADE is never used.

- Convert the *Client text columns and settings.lastBackupDate to timestamptz, using try_parse_ts. They are ISO text since 2.3, and after gate A only server code writes them.
- Drop products.bottleSize (text) after confirming no dependent remains. bottleSizeMl is the only size column.
- Add the CHECK constraints skipped in 2.3, now that their violators are repaired.
- Validate the remaining NOT VALID FKs.
- Archive into app_backup and drop finance_accounts, finance_transactions, users, daily_summaries and the archived old stock_alerts copy.
- Drop purchases and suppliers only if empty; otherwise keep them admin-only.
- Keep personal_expenses as admin-only.
- Merge duplicate columns (shopLogo into logoUrl, footerMessage into invoiceFooter, lowStockAlert into minStockLevel, userName into actorName) and drop the merged-away columns after archiving.
- Drop the saleDateClient compatibility index.

supabase/README.md gains the final data dictionary.

**Migrations:**
- 20261215110000_legacy_cleanup.sql - dependency-checked drops; *Client to timestamptz; products.bottleSize text dropped; deferred CHECKs added; NOT VALID FKs validated; archive-then-drop unused legacy tables; duplicate columns merged

**Files:** `supabase/migrations/20261215110000_legacy_cleanup.sql`, `supabase/tests/12_cleanup_smoke.sql`, `supabase/README.md`, `supabase/MIGRATIONS_LOG.md`

**Owner actions:**
- Confirm the keep-or-drop decision for every legacy table that still has rows.
- (We confirm first that sql:rehearse is green.) Run the snapshot, then this file, and paste the validation table.

**Verification:** Dropped tables exist only in app_backup, with matching counts. No column was dropped while it had a dependent. *Client columns are timestamptz. No NOT VALID constraint remains unless documented. The app runs with the merged columns.

**Fixes findings:** DB-28

#### ⬜ Step 6.3: Migration 20270115100000_retire_legacy_rpcs and removal of client legacy paths (gate B)

*Effort S · depends on 6.2*

Gate B, checked with ops/gate_retire_legacy.sql:
- legacy_rpc_calls has had no rows for 14 consecutive days;
- at least 30 days have passed since R2;
- every device seen in 14 days is on R2 or later with pending = 0 **and failed = 0**;
- **no open sync_dead_letters**;
- no 'unknown' builds;
- the owner confirms.

Then write 20270115100000_retire_legacy_rpcs.sql (require_migration('20261215110000')):
- Replace the process_checkout and process_reversal bodies with stubs raising PT426, keeping the signatures.
- Explicitly drop private.is_shop_member, private.legacy_shop_ids and private.legacy_is_shop_admin, each after a pg_depend check and never with CASCADE.
- Drop the profiles.role and profiles.shopId mirrors and their triggers, after a dependency check.

Client:
- Dexie version(3) drops syncQueue and keeps the meta backup. version(2).stores and its upgrade() stay declared, so a v1 device jumping straight to this build still migrates its queue.
- Remove the legacy v1 checkout builder. The v1 outbox handler stays permanently.

**Migrations:**
- 20270115100000_retire_legacy_rpcs.sql - process_checkout/process_reversal replaced by PT426 stubs; private.is_shop_member, legacy_shop_ids, legacy_is_shop_admin and the profile mirror columns dropped after dependency checks

**Files:** `supabase/migrations/20270115100000_retire_legacy_rpcs.sql`, `supabase/ops/gate_retire_legacy.sql`, `supabase/MIGRATIONS_LOG.md`, `src/offline/db.ts`, `src/offline/__tests__/db.upgrade.test.ts`, `src/domain/checkout.ts`, `src/offline/handlers/index.ts`

**Owner actions:**
- Run ops/gate_retire_legacy.sql and paste the result. Continue only if it passes.
- (We confirm first that sql:rehearse is green.) Run this file, paste the validation table, then approve deploying the client change.

**Verification:** Both legacy functions raise PT426. A fake-indexeddb test going from v1 straight to v3 keeps every queued item. A v1 queue fixture on the updated client syncs through sale_checkout_v2. sync_health shows zero legacy calls. The e2e suite is green.

#### ⬜ Step 6.4: Strict TypeScript completion, zero-any lint ratchet, CSP enforcement

*Effort M · depends on 4.13, 5.3*

Once src/pages holds no business page:
- flip tsconfig.app.json to strict plus noUncheckedIndexedAccess, and delete tsconfig.strict.json;
- fix the residual errors;
- set no-explicit-any and jsx-a11y to error everywhere, with a lint budget of 0;
- make the npm audit job blocking.

After one release with no reported CSP violations, switch vercel.json from Content-Security-Policy-Report-Only to Content-Security-Policy.

**Files:** `tsconfig.app.json`, `tsconfig.strict.json`, `eslint.config.js`, `scripts/lint-budget.json`, `.github/workflows/ci.yml`, `vercel.json`, `src/`

**Owner actions:**
- Confirm that no CSP violations were reported on the previous release, then approve the deploy.

**Verification:** npm run typecheck reports 0 strict errors. grep -rn ': any' src returns 0. CI is fully green, including the blocking audit. The enforced CSP header is present and the e2e smoke spec is green on the preview.

#### ⬜ Step 6.5: Documentation: README, architecture, AI-assistant guide, ADRs, release checklist, backlog

*Effort M · depends on 6.4*

README.md is rewritten:
- what the app is, the stack, Node 22 and env vars;
- scripts and offline behaviour;
- deployment on Vercel (the canonical remote);
- how migrations are applied: rehearse with npm run sql:rehearse, paste the timestamped files in MIGRATIONS_LOG order, read the validation output, check app_info();
- the release checklist and encoding rules;
- troubleshooting, including thermal printing.

Other documents:
- docs/ARCHITECTURE.md: baseline, tenancy, the private schema helpers, commands, ledgers, transfers, outbox and pull, sync_signals, frontend layers, testing. It replaces memory.md.
- CLAUDE.md: rules for AI assistants — the private schema only; no Supabase client outside repos and commands; must(); no absolute stock or credit writes; idempotent, rehearsed migrations; no in-place type change before contract; UTF-8 only; no PowerShell redirection.
- CONTRIBUTING.md.
- docs/RELEASE_CHECKLIST.md.
- docs/adr/ADR-006 to ADR-010.
- docs/BACKLOG.md: every deferred item with its source finding ids, including the GAP4-1, GAP4-3, GAP4-5 and GAP4-9 remainders.

ObsidianVault: move the Firebase-era notes to an archive folder, mark ADR-001 and ADR-002 superseded, and point the index at docs/ARCHITECTURE.md.

Documented-but-missing features (Analytics, Personal Expenses, suppliers, barcode) are moved to docs/BACKLOG.md with their source finding ids. They are not built.

**Files:** `README.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/RELEASE_CHECKLIST.md`, `docs/adr/ADR-006-sql-editor-migrations.md`, `docs/adr/ADR-007-offline-outbox.md`, `docs/adr/ADR-008-multi-tenant-orgs-shops.md`, `docs/adr/ADR-009-query-layer.md`, `docs/adr/ADR-010-stock-transfers.md`, `docs/BACKLOG.md`, `ObsidianVault/00 - Index.md`

**Owner actions:**
- Review docs/BACKLOG.md and set priorities for the next round.

**Verification:** A fresh clone following the README reaches a running dev server and a green sql:rehearse. check-encoding passes on docs. No document mentions Firestore except the archive folder. Every backlog entry cites its source finding or suggestion.

**Fixes findings:** HYG-11, UX-27

## Key decisions

- **Baseline already on the branch and in the live database.** Treat bbfa2df (migration 20261011120000, applied and verified), 62148ab (test shop and 3 accounts deleted), 1c186d6 (backup, restore, queue and createCashier safeguards) and c65dde5 (pushed to zain_repo/main and redeployed) as a fixed baseline, recorded in step 0.0. Every new migration is a delta on it. *Why:* The live database already has the private schema, secured legacy RPCs and locked profiles, and the deployed client is the 1c186d6 code. Rewriting those as if they did not exist would create parallel helper sets, clash on filenames and drop functions the live policies depend on.
- **Internal schema name.** Use the existing private schema for every internal table and helper. Do not create app_private. Redefine private.is_shop_member(p) as p = any(private.legacy_shop_ids()) so there is one membership source, and drop it explicitly in the retire-legacy migration. *Why:* private already has USAGE for authenticated only and is not exposed by the Data API. The applied RPCs and the inventory_alerts policy depend on is_shop_member. A second schema would duplicate helpers and leave hidden dependencies.
- **Migration file naming and ledger.** Keep the existing YYYYMMDDHHMMSS_name.sql convention. The first new file (20261012100000_lockdown_followup) creates private.schema_migrations and seeds 20261011120000 as applied when private.is_shop_member(uuid) exists. require_migration takes the list of true prerequisites, not just the previous file. *Why:* NNNN names would sort before the applied timestamp file. A seeded ledger makes require_migration work from day one. Prerequisite lists allow the contract migration and the transfer migration to land in either order.
- **Verification before production.** Commit the PGlite replica harness in step 0.2 as supabase/rehearsal. npm run sql:rehearse applies every migration twice and runs every SQL test, in CI from 1.8. A green rehearsal is a precondition for every migration step. Production smoke tests are a second check: one designated test product, with test sales cleaned up afterwards. *Why:* Nobody can access the database, so this harness is the only way to test migrations without touching live data. It already verified the applied lockdown with 42 checks, and rollback of type or backfill changes in production would effectively mean a full restore.
- **Tenancy hierarchy.** organizations -> shops -> shop_members (admin, manager, cashier; active or disabled). org_members(owner) gives implicit admin on every shop of the org. Same-org shop_links are required for transfers. Shops are managed with create_shop, update_shop, archive_shop and update_organization. *Why:* An organization is the natural boundary for one owner with many shops. Composite FKs on (orgId, shopId) make cross-owner links and transfers impossible by construction. Without the update and archive RPCs, the shops UI could not be implemented, because tenancy tables are written only through RPCs.
- **Preserving legacy shop ids.** Backfill organizations.id = shops.id = c7587ec2 (the only live shop). Every shopId column only gains an FK to shops(id). The backfill must match the expected counts taken from a fresh 05_find_users.sql run, or the migration raises. Unexpected self-admin signups become suspended orgs listed for approval. *Why:* No business row is rewritten and queued payloads keep valid shop ids. Strict expected counts and a real-user check turn the lockout risk into an automatic rollback instead of a silent outage.
- **Role set and profile mirrors.** Org owner plus shop roles admin, manager and cashier. Mirrors into profiles.role/shopId: owner -> 'admin' with the oldest owned shop; members follow their oldest active membership; no membership -> 'pending' with a null shopId. A BEFORE INSERT trigger on profiles forces role and shopId from memberships, except for the legacy createCashier bridge. *Why:* Deployed clients gate admin screens on profiles.role = 'admin', so the owner must mirror as 'admin'. Forcing values in a trigger makes new signups truly inert even while old clients still self-provision 'admin' profiles.
- **Scope of the first new migration.** 20261012100000_lockdown_followup is a delta on 20261011120000. It adds: the ledger and snapshot helpers; settings readable by members; credits and inventory_logs append-only; deny-all unused tables; admin-only personal_expenses; id defaults; archive-on-delete plus the mass-delete guard; fresh-user-only cashier inserts; and legacy RPCs recreated with an explicit DROP and returning jsonb. The jsonb versions add legacy_rpc_calls telemetry, products locked by id, a future saleDate clamp, derived credit, server-stamped logs, and delta bottle restores in reversal. *Why:* These close the remaining SEC-16, DB-7, DB-17, FIN-3 and GAP2-4 exposure and add the telemetry the gates need. Full server recomputation of totals and bottles waits for the sale commands.
- **Delete safety from the first new migration.** SECURITY DEFINER BEFORE DELETE triggers archive products, customers and bottles (deletedAt or archivedAt) and return NULL for API callers. Every other API delete is copied into private.deleted_rows. More than 25 deletes in one API transaction raise mass_delete_blocked. *Why:* Adding the inventory_logs id default makes the deployed single-product delete reach products.delete() for the first time. Later composite FKs would then permanently reject queued sales that reference deleted rows. Archiving keeps every referenced row, and definer RPCs still see archived rows.
- **Type changes on columns written by deployed clients.** Never change the type of a client-written column before contract. products.bottleSize stays text, and a trigger maintains products.bottleSizeMl numeric(8,2) from parse_ml. *Client text values are normalised to ISO-8601 text in place. Both are converted or dropped in the cleanup migration after gate A. Numeric scale changes apply only to columns every client sends as JSON numbers. *Why:* PostgREST casts input before any trigger runs. The deployed Stock form sends '' and '30ml' as bottleSize, so a numeric column would silently break product edits for weeks.
- **CHECK and FK policy during expand.** Add a CHECK, with ADD plus VALIDATE in the same file, only when its violator count is 0 after normalisation. Otherwise list the violators and add the CHECK in the cleanup migration after repair. On rows the checkout path touches, triggers normalise instead of reject (clamp remainingMl, canonicalise category and paymentMethod, derive status). *Why:* NOT VALID constraints are still enforced on every new insert and on any update of a violating row. A legacy checkout touching a dirty row would otherwise fail on every retry and become a permanently failed queue item.
- **Column naming.** Client-facing public tables, including new ones, use quoted camelCase columns. Internals in private use snake_case. *Why:* The existing tables and all TypeScript use camelCase. Mixing conventions in the same queries and generated types is a constant source of bugs.
- **Command signature, naming and errors.** Use public.<name>_v2(p_mutation_id uuid, p_shop_id uuid, p_payload jsonb) returning a jsonb envelope with effects. Errors use PTxyz SQLSTATEs with stable snake_case codes. Tenancy and admin RPCs use named parameters. require_client_build() exists as a pass-through from the first new migration and gets its real body in the sync migration. *Why:* One stable signature survives payload evolution. PTxyz gives correct HTTP statuses for client error classification. Creating require_client_build early avoids re-creating every command later.
- **Idempotency and non-uuid legacy ids.** Insert first into private.processed_mutations ... ON CONFLICT DO NOTHING. For v1 checkouts the server derives the mutation id: saleId::uuid when saleId is a uuid, otherwise extensions.uuid_generate_v5(fixed namespace, saleId). The client uses the same v5 via the synchronous uuid package. sales.id stays text, and every new reference column is text. *Why:* 13,012 migrated sales keep 20-character Firestore ids, and the deployed edit flow re-rings under the original id. A uuid cast would make those queue items fail forever, and a deterministic v5 keeps replays idempotent.
- **Sale document structure.** Use sale_items (typed lines) plus payCash/payOnline/payCredit on sales, and sale_returns/sale_return_items. Bottle allocations are recorded in bottle_movements (refType sale, refLineNo). Historic allocations are backfilled from items[].bottleChanges as delta rows. *Why:* Pay columns are simple and fast for reports. bottle_movements already carries before and after ml. The backfill lets sale_void_v2 reverse pre-ledger e-liquid sales correctly.
- **Stock and udhaar source of truth.** Append-only stock_movements, bottle_movements and credit_ledger, written only by posting functions. Guarded caches run in capture mode during expand: UPDATE guards plus AFTER INSERT and DELETE capture triggers on products and bottles. Enforce mode starts at contract. The bottle reconciliation migration is required and runs right after the sale commands. *Why:* Old clients insert bottles and products with initial stock, which an UPDATE-only guard would miss. Reconciling after the server takes over bottle allocation (the sale commands) is the first point where the result stays at zero.
- **Legacy RPC lifecycle.** Lockdown follow-up: jsonb returns. Reversal always deletes, returns {status:'duplicate'} when the sale is already gone, and restores from the stored row with delta bottles. Schema hardening: re-created for composite FKs (tombstone customer created on the fly). Sale commands: translators, with the old edit flow raising PT426. Retire-legacy, after gate B: stubs with the signatures kept. v1 translation stays in sale_checkout_v2 permanently. *Why:* Queued sales are real money. A duplicate status instead of an error adds no new failure path for old clients, delta restores fix FIN-6 at once, and stubs let straggler devices keep their queue until they update.
- **Gate R0 and sales write revocation.** Before the role-aware RLS migration, require 7 days of legacy_rpc_calls with no 'unknown' clientBuild (headerless means pre-R0), plus owner confirmation. The migration itself checks the first condition. That migration then revokes INSERT, UPDATE and DELETE on sales from authenticated. *Why:* The deployed remove-item and edit flows write sales directly and would double-restore stock on a later void. R0 hides them, and the gate proves no pre-R0 client remains before the ledger relies on sale_items.
- **Interim fixes for production-damaging findings.** R0: paged, non-clearing syncCloudToLocal that preserves rows referenced by pending items; temporary fetchAllPages for Dashboard, Sales and Detailed Reports (90-day window removed); a minimal offline-authenticated session. R1: compare-and-set writes for Stock and udhaar balances. The final fixes still land in R2 and R3. *Why:* Live sales (13,352) and bottles (about 3,000) exceed the 1,000-row cap today. Truncated reports, phantom bottles, lost updates and offline logouts would otherwise continue for weeks before R2 or R3.
- **Offline-capable commands and business-rule policy.** Offline-capable: sale.checkout, customer.create, credit.record, expense.create. Offline-originated facts are accepted and violations are flagged, including missing_product and missing_customer. Online admin commands are strict. *Why:* Rejecting a sale that already happened makes the books wrong and jams the queue. Udhaar collection and new credit customers at the counter are common offline actions.
- **Business day, timestamps and backdating.** An indexed businessDate is stored on fact rows and computed from shops.timezone and businessDayStartHour. Backdating is detected against the client enqueue time (p_sale_data.createdAt, or queuedAt), never against the server receive time. Offline sales never have saleDate rewritten. The 2.3b sale-date repair compares against try_parse_ts(saleDateClient) and is skipped when its preview count is about 0. *Why:* The live checkout always kept the client date, so the original overwrite premise does not hold live. Comparing with receive time would wrongly re-date or flag real offline sales and reintroduce FIN-7 and SYNC-10.
- **Client and server version gating.** app_info() returns schemaVersion, the list of applied migrations and minClientBuild. When the server is too old, the client keeps queueing offline-capable commands, pauses draining, blocks online-only admin commands and shows a banner. v2 commands raise PT426 below min_client_build. *Why:* Blocking all writes would stop the shop selling if a release went out early or a migration was rolled back. Pausing the drain keeps every sale safe.
- **Per-shop rates.** Store defaultRefillPricePerMl, refillPresetsMl, importMarkupPct, cashierBackdateDays, allowCashierPriceOverride and creditWarnThreshold on settings (lowStockThreshold already exists). checkout_core, product_import_v2 and the POS read them. businessRules.ts holds only fallbacks. The Rates tab edits them, and create_shop and clone_catalog_to_shop copy them. *Why:* The requirement is that each shop has its own pricing and rates. Global constants and an unstored backdate or override policy cannot express that.
- **Counters for invoice and transfer numbers.** Keep nextInvoiceNo in private.shop_counters and nextTransferNo in private.org_counters, locked last in each command. *Why:* Counters on shops or organizations would fire the audit and touch triggers on every sale (one audit row and an updatedAt bump per checkout). Separate rows keep the audit log meaningful.
- **Realtime.** Clients subscribe only to public.sync_signals(shopId, table, changedAt). Statement-level triggers bump it for products, bottles, customers, settings and stock_transfers. Business tables leave the supabase_realtime publication. *Why:* Realtime is filtered by base-table RLS and cannot use views. After contract, cashiers lose base-table SELECT on products and would stop receiving events. A cost-free signal table also stops row data and cost leaking over realtime.
- **RLS and cost masking for new tables.** Ledgers and sale documents: SELECT for mgr+ only, with no writes for authenticated. catalog_items: org members. Transfer tables: mgr+ of either shop or the owner. Cashiers read transfers through RPCs that null costs. validate_rls() is extended by every migration, and tests check cashier cost visibility. *Why:* rls_auto_enable makes new tables deny-all by default, and ad-hoc staff SELECT policies would expose unitCost, lineCost and lineProfit to cashiers, contradicting the masking design.
- **Stock unit and cost columns.** stockUnit and bottleSizeMl are trigger-maintained columns. unitCostPerMl is canonical for ml products and costPrice for piece products, with a trigger keeping the other in step. bottles.archivedAt and the 'transferred' status are used for tombstones. *Why:* Generated columns reject explicit values from old clients that write whole rows. Two independent cost columns let weighted-cost maths and transfers disagree.
- **Shop-to-shop transfer workflow.** One-step atomic stock_transfer_create_v2 plus stock_transfer_reverse_v2. Reverse locks the transfer row first, re-checks its status, and a unique index on reversesTransferId blocks a second reversal. Online-only and idempotent, and the sender can never go negative. Two-step send and receive goes to the backlog. *Why:* This matches the owner's requirement exactly. Without the row lock, two concurrent reverse calls could both post transfer_reverse.
- **Cross-shop product matching.** Use org-level catalog_items with products.catalogItemId, unique per shop. clone_catalog_to_shop and link_product_to_catalog_v2 require same-org shops and catalog items. The link is re-resolved on a name, category or size change unless it was set manually. The wizard always shows the mapping for confirmation. *Why:* Exact matching keeps each shop's own products row. The explicit same-org checks close a cross-tenant leak in the multi-owner SaaS.
- **E-liquid in transfers.** Sealed bottles plus optional loose ml, with 0 <= looseMl < bottleSizeMl and matching sizes. Too few sealed bottle rows raises PT409 insufficient_bottles. Transferred bottles get remainingMl = 0, status 'transferred' and are hidden from base SELECT. They are recreated closed at the receiver with sourceBottleId. Lines carry the sender's weighted-average cost. *Why:* Live stock and bottle data disagree, and pre-R2 clients count every non-sold bottle in refills. Zeroing and hiding transferred bottles prevents double use, and the strict error keeps the transfer honest.
- **Pull model and local reads.** Keyset delta pull (sync_pull_v2) with a 2-minute overlap and tombstones. Dexie stores server snapshots only, and screens read the snapshot plus pending outbox effects. sync_signals only schedules pulls. *Why:* No row cap and no clear-and-replace, so unsynced deductions survive any refresh by construction.
- **Dexie upgrade of the old queue.** version(2).upgrade copies every syncQueue row, whatever its status, keeping retry metadata. Overlay effects are computed from the v1 payload, userId is null, and unknown types become 'needs_review'. The copied count is asserted, and the upgrade throws on a mismatch. A JSON backup goes into meta, and a full re-pull is forced. version(2) and its upgrade are never removed. *Why:* The upgrade runs once per device on real unsynced sales. Copying only pending checkout items, or dropping version(2) later, would lose failed items, R0 metadata or a v1 device's whole queue.
- **Server-state data layer.** TanStack Query v5 with repositories in src/data/repos. Keys start with ['shop', shopId]. Aggregates come from report RPCs. must() is used for every call; mustAffect() for updates only, never for deletes that archive. *Why:* This replaces three ad-hoc data-access styles and fixes swallowed errors. Archive-on-delete reports 0 rows, which mustAffect would misreport as a stale write.
- **Backup and restore.** Restore stays disabled (since 1c186d6). R0 adds a per-table count cross-check against a head count. The final export in 4.12 covers ledgers and documents with a checksum. A safe server-side restore into an empty shop goes to the backlog. *Why:* A client cannot make a multi-table wipe-and-reload atomic, and RLS can hide a table silently. A count check makes that visible.
- **Telemetry headers and gates.** Send x-client-build and x-device-id from R0, with the build also carried in the checkout payload as a CORS fallback. Calls without a build are recorded as 'unknown', and any 'unknown' call in the window fails gate R0, A or B. *Why:* Pre-R0 builds send no headers and would otherwise be invisible to device-based gates.
- **Edit and remove-item during the transition.** Hide Edit and Remove item in R0. They return in R3b as sale_edit_v2 (POS replace mode) and sale_return_v2. *Why:* Both are non-atomic multi-request flows that can lose a sale or double-restore stock.
- **Customers and parties.** Customers and udhaar stay per shop. 'others' credits become customers with kind = 'party'. A trigger keeps party balances in step with new 'others' credits until contract. Parties are always hidden from base-table customers SELECT and are read through report_udhaar and sync_pull_v2. *Why:* Pre-R3c clients keep inserting 'others' credits without touching any balance, and party rows must not appear in the old POS customer picker.
- **Negative stock policy.** Sales may drive stock negative, which raises a stock_alerts row. Manual removals, adjustments and transfers may never drive stock negative. *Why:* A sale records a physical event that already happened. Removals and transfers are deliberate online actions that the user can correct immediately.
- **Receipt printing.** Browser printing of a #print-root portal with an injected @page size for 58 or 80 mm, with paper width and auto-print set per device, and reprint from Sales History. ESC/POS printing goes to the backlog. *Why:* This works today with OS thermal drivers, including for offline sales. UX-3 requires receipt printing.
- **History purge timing.** The key is already revoked. The commits that contain emails (62148ab) are already on zain_repo, so step 0.1 redacts the script in HEAD, and the history purge in 0.8 (git filter-repo plus a force-push to both remotes) runs only on explicit written owner confirmation. *Why:* Revocation removed the live risk. The purge removes personal data and the dead key from every clone, but it rewrites shared history, which only the owner can approve.
- **CSP rollout and CAPTCHA.** Ship Content-Security-Policy-Report-Only with the other headers in 4.3, and enforce it in 6.4 after one release with no violations. Defer Auth CAPTCHA to the backlog. *Why:* Turning on Supabase CAPTCHA without a client widget and CSP origins would lock every client out of login, including devices still on older builds.
- **Contract decoupled from the multi-shop feature.** 6.1 (contract) depends on R3d (4.10-4.13 plus 4.7-4.9) and gate A, not on the transfer release. The two tracks can proceed in either order. *Why:* Security hardening (cashier cost masking, revoking direct writes) should not wait for a product feature, and the transfer commands are RPC-only already.
- **Owner dashboard across shops.** Defer the consolidated cross-shop dashboard to the backlog. An owner switches shops to see each shop's dashboard. *Why:* The requirement is separate inventory and prices per shop plus transfers. A rollup dashboard is new product scope.
- **Invoice numbers.** Assign a per-shop sequential invoiceNo server-side in checkout_core from private.shop_counters. Receipts show invoicePrefix plus invoiceNo once synced, and 'Pending sync' offline. *Why:* This closes GAP4-8 and makes invoicePrefix meaningful. Offline devices cannot allocate gap-free numbers.

## Risks and mitigations

- 20261012100000 replaces the live checkout RPC again (DROP plus CREATE). If the new body mishandles a real payload, queued sales could jam. Mitigations:
  - the PGlite rehearsal replays captured payloads, including Firestore ids;
  - the file is all-or-nothing, with function snapshots and restore_functions;
  - it runs in closed hours after the devices drain;
  - data-quality cases are recorded, never raised.
- The PGlite replica is not Supabase. It has no PostgREST, Auth service or realtime, and its extensions schema is stubbed. Behaviour that depends on PostgREST casting, headers or CORS is checked only by the production smoke tests (designated test product) or by the optional staging project.
- Unforeseen client write shapes could still hit a constraint or a type. Mitigations:
  - no in-place type change before contract;
  - CHECKs added only when clean;
  - normalisation triggers;
  - the write-site list is reviewed per migration and replayed in the rehearsal.
- The 2.1 backfill decides who keeps access. The strict expected counts and the real-user check roll the migration back on any mismatch. Self-signups made before 2.1 become suspended orgs, which the owner must review.
- Gate R0 depends on devices actually opening the app and on the x-client-build header passing CORS (with a payload fallback). A device that never sells is invisible to legacy_rpc_calls, so the owner's confirmation is required. The documented override exists for when that confirmation is given.
- The mixed-client period between 2.1 and contract (6.1) can last weeks. Capture mode must keep reconciliation at zero, and v_bottle_reconciliation may need the 2.6 apply re-run until R3c. Gate A must not be bypassed under time pressure.
- The Dexie v2 upgrade runs once per device on real unsynced sales. Mitigations:
  - fake-indexeddb fixtures for every status and type, plus non-uuid ids;
  - an asserted copy count that aborts the upgrade;
  - a JSON backup in meta;
  - syncQueue kept until v3, and version(2) kept forever.
- Archive-on-delete changes what deployed clients see. Deleted products and customers vanish from lists but stay in the database, and names stay reserved only among non-archived rows. Owners must be told that 'delete' now archives.
- On the Free plan there is no PITR, and app_backup snapshots count toward the 500 MB limit. Use ops/prune_snapshots.sql and off-database CSV exports. Consider Pro during the migration window.
- The owner applies migrations by hand. Mitigations: require_migration prerequisite lists, the schema_migrations ledger (seeded with 20261011120000), MIGRATIONS_LOG.md, and the client-side schemaVersion handshake, which keeps the POS selling and pauses syncing.
- Edit and Remove item are hidden from R0 until R3b, so staff must delete and re-ring for several weeks. Communicate this with R0.
- Supabase's linter flags the definer views (v_products, v_sales, v_sale_items). This is intentional; they must always filter by user_shop_ids(), which a review checklist and the RLS matrix tests guard.
- The lock order (products sorted by shopId and id, counters last) must be kept in every command, or transfers and checkouts can deadlock.
- The history purge (0.8) rewrites shared history on two remotes, and the commit with emails (62148ab) is already on zain_repo. Collaborators who do not re-clone could re-push it. Mitigations: an owner-confirmed, coordinated purge, then secret scanning with push protection.
- Production smoke tests and Vercel previews write to the live database. They must use the designated test product and record and void their test sales.
- The scope is large: 54 steps across 7 phases, for a small team running a live shop. Release trains keep each production change small, and every phase leaves a deployable, consistent state.

## Deferred backlog (after this plan, if the owner wants them)

- **Cash sessions, day close (Z-report) and shift report.** Opening float, expected versus counted cash, variance and closedBy per session, computed on the server from the pay columns, cash udhaar receipts, cash expenses and refunds (GAP4-3 remainder).
- **Purchases, goods receipt and supplier payables.** Supplier master, purchase bills, goods receipt posting stock_receive movements, and payables with payments (GAP4-1). Includes re-importing supplier and purchase data from Firestore if the 0.2 comparison shows it was lost (DB-22).
- **Custom categories and product variants.** A per-shop category table driving stockUnit, plus flavour and nicotine variants (GAP4-9).
- **Party ledger beyond kind = party.** Owner loans, capital, petty cash and wallet accounts with a balances dashboard (GAP4-4 strategic part), and a server-side double-entry journal replacing the deleted finance module (GAP4-12 strategic part).
- **Owner drawings and personal expenses.** A Personal Expenses page on the admin-only personal_expenses table, with drawings excluded from P&L (GAP4-2 remainder, UX-27).
- **Server-enforced credit limits and udhaar collections.** Per-customer credit limits checked in checkout (flagged offline, blocked online), ageing reminders and a collections workspace (GAP4-5 remainder).
- **Discount model and per-role discount limits.** Discount reports from sale_items.listPrice and discountAmount, and server-enforced per-role limits beyond the per-shop override switch (GAP4-6, UX-14 remainder).
- **Reorder suggestions.** Sales-velocity-based reorder suggestions grouped by supplier (GAP4-13 remainder).
- **Slow movers, discount and write-off reports.** Reports over sale_items and stock_movements reason codes: slow-moving stock, discounts given, and wastage and write-offs by reason.
- **One-time opening-balance import from the workbook.** Import opening stock and udhaar balances from the owner's spreadsheet through product_import_v2 and credit_record_v2, with a preview and per-row results.
- **Two-step transfers.** An in-transit state with receive, partial receive and discrepancy reporting for stock_transfers.
- **Consolidated owner dashboard.** A cross-shop rollup (an owner_overview RPC) of revenue, profit, udhaar, stock value and transfers for owners with several shops.
- **Shared customers across an owner's shops.** An org-level customer list with per-shop or org-level udhaar balance semantics.
- **Co-owners, ownership transfer and platform billing.** Additional org_members roles, an ownership transfer flow, and subscription billing per org or shop.
- **Safe restore into an empty shop.** A staged, server-side, single-transaction restore of a backup file into a shop with zero business rows, never overwriting data.
- **Scheduled backups.** Automated off-site exports, or reliance on Supabase Pro PITR, with a documented restore runbook.
- **Auth CAPTCHA.** Turnstile or hCaptcha widget on Login, Onboarding and Reset password, captcha origins added to the CSP, and the dashboard setting turned on only after gate A shows every device on a build that sends captchaToken.
- **WhatsApp receipts and udhaar reminders.** wa.me share links for receipts and balance reminders.
- **ESC/POS printing over Bluetooth or USB.** Direct thermal printing (Web Bluetooth, WebUSB or RawBT) for Android Bluetooth printers, if browser printing is not enough.
- **Barcode column, scanning by code and label printing.** products.barcode, exact-match scanning in ProductSearch, and label printing.
- **Urdu and Roman-Urdu localisation, and a dark theme.** i18n of all UI strings, and a tokenised dark theme replacing the removed toggle.
- **E-liquid batches, expiry and opened-bottle age alerts.** Batch and expiry tracking on receive, with freshness alerts.
- **Held sales, quick picks and loyalty.** Parked carts, favourite products and simple refill loyalty.
- **MFA for destructive actions and an audit hash chain.** Require aal2 for void, archive and staff changes, and add a tamper-evident hash chain to audit_log.
- **Edge Function for cashier accounts with passwords.** An optional admin-created cashier account (auth.admin.createUser and ban), in addition to invite codes.
- **FBR POS integration and tax.** Tax configuration (taxRate removed from Settings in 4.12) and FBR invoice reporting, if required.
- **Finer payment channels.** JazzCash, EasyPaisa and bank as distinct payment methods in checkout and reports.

## Findings made moot (superseded)

- **GAP4-1** (The spreadsheet's 'Vendors GL' (supplier payables and purchase bills) has no place in the app, and restocking records no supplier, bill or amount owed): Purchases, goods receipt and supplier payables (the spreadsheet's Vendors GL) are a new product module outside the audit fixes and the multi-shop requirement. They are recorded in docs/BACKLOG.md, together with any supplier or purchase re-import from Firestore flagged in 0.2. The live suppliers and purchases tables are deny-all from 20261012100000, and are kept admin-only (or dropped if empty) in 6.2. Restocking is recorded through stock_receive_v2 with unit cost and a note. *(covered by step 6.5)*
- **GAP4-9** (Product categories are fixed to device, coil and e-liquid, so pods, disposables and accessories are filed under the wrong category and category reports would mislead): Custom per-shop categories (pods, disposables, accessories) and variants are a product feature, recorded in docs/BACKLOG.md. 2.3 lays the groundwork: a trigger-maintained stockUnit decoupled from category, and an 'other' category value. *(covered by step 6.5)*
- **GAP4-3** (The app cannot show how much cash should be in the drawer: expenses and udhaar receipts have no payment channel, there is no opening float, and the Dashboard 'CASH' card adds in every recovered credit): Partly fixed: 4.10 shows cash sales separately from udhaar recovered and splits them by payment channel, and 2.4 and 2.7 add paymentChannel to expenses and udhaar receipts. The remainder — expected drawer cash, opening float, cash sessions and the Z-report — is new product scope and goes to docs/BACKLOG.md (step 6.5). *(covered by step 4.10)*
- **GAP4-5** (Udhaar has no credit limit, and the POS does not show a customer's outstanding balance before a credit sale): Partly fixed: the 4.5 CustomerPicker shows the udhaar balance before a credit sale and warns above the per-shop creditWarnThreshold. The remainder — customers.creditLimit with server enforcement in checkout, and collections — goes to docs/BACKLOG.md (step 6.5). *(covered by step 4.5)*

## Appendix A: Target architecture

### VapeTrax target architecture and remediation strategy (revision 2)

#### 0. Starting point (what already exists)

This plan starts from branch `fix/audit-remediation` at `c65dde5` and from the live database as it is today. It does not start from `schema.sql`, which has drifted from the live database.

**Already done (step 0.0, no new commit):**

- **`bbfa2df`** added `supabase/migrations/20261011120000_emergency_security_lockdown.sql`. The owner applied it, and `verify_20261011120000.sql` reported every check passed. It:
  - created schema `private` (USAGE for authenticated, not exposed by the Data API) with `private.is_shop_member(uuid)`;
  - revoked all anon access, including default privileges;
  - re-enabled profiles RLS, with policies and column grants that make `role` and `shopId` unchangeable through the API;
  - replaced the allow-all `inventory_alerts` policies with `inventory_alerts_shop`, which depends on `private.is_shop_member`;
  - added `updatedAt` to profiles and expenses;
  - made `process_checkout`, `process_reversal` and `process_stock_adjustment` check membership, scope every write to the caller's shop and use `search_path = ''`. Checkout is replay-safe, and the uuid overload of the adjustment RPC was dropped. Both legacy RPCs still `return void`.
- **`62148ab`** deleted the test shop `158a7adf` and three accounts. Live data is now **one shop (`c7587ec2-753c-4767-a9f3-8bcf6b30e685`), one account and no cashiers**. That commit's script still contains four email addresses.
- **`1c186d6`**:
  - Backup export is complete: paged, ordered, every shop table, with `_meta` counts.
  - Restore is disabled.
  - The sync queue backs off from 5 s to 5 min and runs once at a time.
  - Clear queue is admin-only, needs a typed DELETE and downloads a copy first.
  - `createCashier` restores the admin session before linking the profile.
  - `migrate.js` reads its key from the environment.
- **`c65dde5`** (empty commit) pushed all of the above to `zain_repo/main` to trigger a Vercel redeploy. So **the deployed client is most likely the `1c186d6` code**, and the history containing the delete script is already on `zain_repo`. `origin/main` is still at `8f4c809`.
- The owner revoked the leaked `sb_secret_` key.
- A PGlite replica harness (`scratchpad/pgcheck`: `live_before.sql`, `test_lockdown.mjs`) verified the applied lockdown with 42 checks. Step 0.2 commits it.

**Live facts that shape the design** (from `live-snapshot-2026-10-11.md`):

- Sales (13,352) and bottles (about 3,000) are both above the 1,000-row PostgREST cap.
- 13,012 Firebase-migrated sales, and their products, customers and bottles, keep 20-character Firestore ids (not uuids).
- `saleDateClient` holds Firestore JSON on 13,012 rows. The live checkout always kept the client sale date.
- `products.bottleSize` is free text.
- 14 sales point at missing customers.
- There are no FKs between business tables. Every `shopId` references `auth.users`.

**Deployed-client behaviour every migration must tolerate:**

- The Stock form sends free-text `bottleSize`: `''` for devices and coils, and sometimes `'30ml'`. It also ignores update errors.
- The single-product delete log has no id. Once ids get defaults, that delete starts working.
- The edit flow re-rings a sale under its original id.
- `AddCreditModal` inserts 'others' credits without touching any balance.
- `syncCloudToLocal` reads bottles unpaged, so checkout fabricates phantom bottles.
- The service worker force-reloads on every update. R0 is therefore picked up automatically; later releases are not.

#### 1. Principles

- **Server-authoritative writes.** Every change to stock, money, udhaar, sales, memberships or the audit trail runs inside one Postgres transaction in a `SECURITY DEFINER` command. The client sends intents. It never sends absolute balances, totals, COGS, actor names or bottle states.
- **Expand, release, contract.** Changes are additive first. Clients move over next. Revokes and drops come last, only after telemetry gates (R0, A, B) prove old clients are gone.
- **Never lose, or permanently reject, a queued sale.**
  - `process_checkout` and `process_reversal` keep their names and argument names until gate B. After that they become stubs that keep the signature.
  - Data-quality problems in a queued sale never raise; they are stored and flagged. Examples: a missing product or customer, a dirty bottle row, a non-uuid id, a non-canonical category.
  - Only security failures raise.
- **No in-place type change on a column a deployed client writes, until contract.** Instead, trigger-maintained shadow columns are added (`products.bottleSizeMl`), or values are normalised in place within the same type (`*Client` text normalised to ISO-8601). Real type conversion happens in the cleanup migration after gate A.
- **CHECKs and FKs only when clean.** A constraint is added only when it has zero violators, after normalisation triggers have run. Rows that the checkout path touches are normalised, not rejected.
- **Preserve live data.**
  - Every existing `shopId` becomes `shops.id = organizations.id`.
  - From the first new migration, products, customers and bottles are archived instead of hard-deleted.
  - Sales are never hard-deleted after the commands land (they are voided instead).
  - A snapshot is taken before every risky file.
- **Rehearse, then paste.** Every migration runs twice (idempotency) plus all SQL tests on the PGlite replica in CI before the owner sees it. Production smoke tests use one designated test product and clean up after themselves.
- **One commit per step** on `fix/audit-remediation`. Nothing is pushed, force-pushed or deployed without the owner's permission. A client release is deployed only after the migrations it needs, and the client also enforces this through `app_info()`.

#### 2. Tenancy and roles

**Hierarchy.** `organizations` (one owner's business) contain `shops`, which contain `shop_members`. An `org_members` row with role `owner` makes that user an implicit admin of every shop in the org.

| Table | Key columns |
|---|---|
| organizations | id uuid, name, ownerId, status (trial, active, suspended, closed), maxShops |
| org_members | (orgId, userId), role 'owner' |
| shops | id uuid, orgId, name, timezone default 'Asia/Karachi', businessDayStartHour default 3, currency 'PKR', status (active, archived), unique (orgId, id) |
| shop_members | (shopId, userId), role (admin, manager, cashier), status (active, disabled), invitedBy, disabledAt/By |
| shop_invites | sha256 codeHash, role, optional email, maxUses, usedCount, expiresAt, revokedAt |
| shop_links | (shopA < shopB), orgId; composite FKs (orgId, shopX) → shops(orgId, id), so a link can never cross owners |
| private.shop_counters / private.org_counters | nextInvoiceNo per shop and nextTransferNo per org. They live outside shops and organizations so that a checkout fires neither the audit trigger nor the touch trigger. |
| private.platform_settings, org_signup_codes, flags, invite_attempts | Operator-only: signup mode (open, code, closed), hashed signup codes, feature flags, invite brute-force counter |

**Status semantics.**
- Helpers treat `trial` and `active` as usable.
- Backfilled orgs and shops are inserted with status `active` explicitly.
- An org created by an unexpected signup between the first new migration and the tenancy migration is created `suspended` and listed for the owner.

**Legacy mapping (tenancy migration).**
- The live shop `c7587ec2` gets an organization and a shop whose ids equal it, plus an owner membership.
- The expected counts (1 org, 1 shop, 1 owner, 0 cashiers) are filled in from a fresh `05_find_users.sql` run when the file is authored. The migration raises if the main shop's backfill differs from them.

**Profiles.**
- `profiles.role` and `profiles."shopId"` become server-maintained mirrors, so deployed clients keep working.
  - An org owner is mirrored as role `admin`, with shopId = the oldest owned active shop.
  - Otherwise the mirror follows the oldest active membership: admin and manager become `admin`, cashier stays `cashier`.
  - A user with no membership becomes `pending`, with a null shopId.
- A BEFORE INSERT trigger on profiles forces role and shopId from memberships and ignores client values. One exception is the legacy bridge: an admin inserting a cashier profile for a fresh auth user (created less than an hour ago, no profile) into their own shop creates the cashier membership.
- Deleting a profile disables the membership.
- There is deliberately no `auth.users` trigger: it could block signups.
- Profiles are created lazily by `my_context()`, `accept_invite()` and `create_organization()`.
- The mirrors are dropped in the retire-legacy migration.

**Capabilities.** `staff` = admin, manager, cashier. `mgr` = admin, manager. The org owner passes every check in every shop of the org.

| Capability | owner | admin | manager | cashier |
|---|---|---|---|---|
| Create, update or archive shops; link shops; invite admins; clone catalog | yes | – | – | – |
| Invite, disable or re-role managers and cashiers; shop settings and rates; audit log; discard dead letters; archive products and customers | yes | yes | – | – |
| Product and price edits, receive, adjust, count, import, void, return, edit sale, expense edit or delete, credit adjustment or write-off | yes | yes | yes | – |
| Stock transfer create or reverse | yes | admin or manager in **both** shops | (same) | – |
| Checkout (online or offline), create customer, receive udhaar, add expense, read stock, sales and history | yes | yes | yes | yes |
| See cost, COGS and profit | yes | yes | yes | masked |

**Onboarding.**
- A new signup is inert (`pending`).
- An owner calls `create_organization(p_org_name, p_shop_name, p_signup_code)`, gated by `platform_settings.orgSignupMode` (default `code`): one org per user, and `maxShops` applies.
- Staff join with `accept_invite(code)`. Codes are hashed, expiring and use-limited, with 10 failed attempts allowed per hour. Only the owner can invite admins.
- Removal is `set_member_status(..., 'disabled')`. It takes effect on the next request, because RLS checks membership live.
- The owner manages shops with `create_shop`, `update_shop` (name, timezone validated against `pg_timezone_names`, day-start hour 0–23, with no retroactive recomputation), `archive_shop` (refused while stock, udhaar or pending transfers exist unless forced) and `update_organization`.
- Platform operations are SQL snippets in `supabase/ops/`.

#### 3. Authorization: the `private` schema, helpers and policies

**Schema.** All internal tables and helpers live in the existing `private` schema. It already has USAGE for authenticated only, and it is never exposed through the Data API. No second helper schema is created.

**Helpers** are `SECURITY DEFINER STABLE` with `search_path = ''`, return `uuid[]`, and are executable by `authenticated` only:
- `user_shop_ids()`, `shops_with_role(text[])`, `has_shop_role(shop, roles)`.
- `assert_shop_role(shop, roles)`: raises `PT401 not_authenticated` when `auth.uid()` is null, otherwise `PT403 forbidden`.
- `is_org_owner(org)`, `user_org_ids()`, `effective_role(shop)`, `actor_name()`.
- `client_build()`: the `x-client-build` header, else `'unknown'`. `device_id()`.
- `business_date(shop, ts)`.

**Legacy bridge helpers.**
- The first new migration adds `private.legacy_shop_ids()`, which returns `[auth.uid(), the caller's profiles.shopId]`.
- It also redefines `private.is_shop_member(p)` as `p = any(private.legacy_shop_ids())`, leaving exactly one membership source.
- The tenancy migration redefines `legacy_shop_ids()` as `user_shop_ids()`. In one statement, that moves every earlier policy and both legacy RPCs onto memberships.
- `is_shop_member`, `legacy_shop_ids` and `legacy_is_shop_admin` are dropped explicitly (never with CASCADE) in the retire-legacy migration.

**Policy template.** Each policy calls the helper once per statement, as an InitPlan:

```sql
create policy products_select on public.products for select to authenticated
  using (\"shopId\" = any ((select private.user_shop_ids())) and \"deletedAt\" is null);
create policy products_update on public.products for update to authenticated
  using (\"shopId\" = any ((select private.shops_with_role('{admin,manager}'))))
  with check (\"shopId\" = any ((select private.shops_with_role('{admin,manager}'))));
```

**Grants and rules.**
- `anon` has no privilege anywhere. Every RPC runs `revoke all ... from public, anon; grant execute ... to authenticated`.
- Policies are always `TO authenticated` and never `using (true)`.
- `public.rls_auto_enable()` is Supabase's event-trigger helper. It is excluded by name and return type from every revoke loop and search_path check.

**RLS matrix for new tables** (held in `private.validate_rls()`, which every migration extends):

| Table | Policy |
|---|---|
| stock_movements, bottle_movements, credit_ledger, sale_items, sale_returns, sale_return_items | SELECT for mgr+ of the shop; no INSERT, UPDATE or DELETE for authenticated (writes only through definer functions) |
| sync_dead_letters | SELECT for admin. Writes go through RPCs. |
| sync_signals | SELECT for staff. No writes. |
| catalog_items | SELECT for org members |
| stock_transfers, stock_transfer_items | SELECT for mgr+ of either shop, or the owner. Cashiers read through `list_stock_transfers` and `get_stock_transfer`, which return null costs. |
| tenancy tables | Members and the owner read. Writes go through RPCs. |

**Base-table visibility rules.**
- `sales` hides `status = 'voided'`.
- `customers` hides `kind = 'party'` (permanently).
- `products` and `customers` hide archived rows.
- `bottles` hides archived and `transferred` rows.

**Append-only tables.**
- From the first new migration: `credits`, `inventory_logs`.
- From the ledgers migration: `stock_movements`, `bottle_movements`, `credit_ledger`, `sale_items`, `sale_returns`, `sale_return_items`, `audit_log`.
- UPDATE, DELETE and TRUNCATE raise on all of them.

**Guarded caches.** `products.stockQuantity`, `customers.creditBalance` and `bottles.remainingMl/status` change only inside posting functions, which run under the transaction-local `app.ledger_write = 'on'`.
- Until contract, the guards run in **capture mode**:
  - a direct UPDATE by an old client is applied and recorded as a `direct_write` ledger row with its actor and clientBuild;
  - AFTER INSERT and AFTER DELETE capture triggers on products and bottles record inserted initial stock and inserted bottles in the same way.
- From the contract migration (`private.flags.enforce_* = 'on'`), such writes raise.

**Cost masking.** `v_products`, `v_sales` and `v_sale_items` are definer views with `security_barrier`. They filter by `user_shop_ids()` and return cost, COGS and profit only to mgr+. `sync_pull_v2` and the transfer RPCs strip cost for cashiers. From contract, base-table SELECT on products, sales and sale_items is mgr-only.

**Realtime.**
- Postgres-changes events are filtered by the subscriber's RLS and cannot use views. So clients subscribe only to `public.sync_signals(shopId, table, changedAt)`, which statement-level triggers on products, bottles, customers, settings and stock_transfers bump.
- No row data or cost travels over realtime.
- Business tables are removed from the `supabase_realtime` publication.

#### 4. Data model

**Conventions.**
- Client-facing tables use quoted camelCase columns. Internals in `private` use snake_case.
- Existing text PKs stay text, with default `gen_random_uuid()::text` from the first new migration. New tables use uuid PKs.
- **Every new column that references a sale, product, customer or bottle is `text`**, because legacy ids are Firestore strings. This covers `sale_items.saleId` and `productId`, `stock_movements.productId` and `refId`, `replacesSaleId`, `stock_transfer_items.fromProductId` and `toProductId`, and bottle ids.

**Money and quantities.**
- `numeric(12,2)` for money, `numeric(14,4)` for per-ml price and cost, `numeric(12,3)` for quantities and ml.
- Scale changes apply only to columns that every client write sends as a JSON number.
- Cost has one canonical column per unit: `unitCostPerMl` for ml products and `costPrice` for piece products. A trigger keeps the other column in step.

**Bottle size and stock unit.**
- `products.bottleSize` stays free text until the cleanup migration.
- `products.bottleSizeMl numeric(8,2)` is maintained by a BEFORE INSERT/UPDATE trigger from `private.parse_ml(bottleSize)`. `'30'`, `'30ml'` and `'30 ML'` all become 30. `''` and unparseable values become null and are logged.
- `products.stockUnit` (`ml` for e-liquid, otherwise `piece`) is trigger-maintained, never a generated column, so old clients writing whole rows keep working.
- All new SQL and client code reads `bottleSizeMl`.

**Time.**
- Canonical business times are `saleDate`, `expenseDate`, `createdAt`, `stock_movements.occurredAt` and `credit_ledger.occurredAt`, all timestamptz.
- `*Client` text columns are normalised to ISO-8601 UTC text: a trigger handles new writes, and a backfill handles existing rows using `private.try_parse_ts`. The parser is exception-safe and accepts ISO, Postgres text, Firestore `{_seconds}` JSON and epoch milliseconds.
- The `*Client` columns are converted to timestamptz in the cleanup migration.
- Fact rows carry a stored, indexed `businessDate` = `((ts at time zone shops.timezone) - businessDayStartHour hours)::date`. The default is Asia/Karachi (no DST) with the day starting at 03:00.

**Normalisation triggers** (on rows the checkout path touches):
- trim and lower `category`, with e-liquid variants becoming `e-liquid` and unknown values becoming `other`;
- derive `paymentMethod` from `splitAmounts` when the value is unknown;
- clamp `bottles.remainingMl` to [0, bottleSize];
- derive an unknown bottle `status` from remainingMl.
Every change is written to `private.repair_log`.

**Archives.**
- `products` and `customers` have `deletedAt`, `deletedBy` and `deleteReason`. `bottles` has `archivedAt`. All are added in the first new migration.
- A `SECURITY DEFINER` BEFORE DELETE trigger turns an API delete into an archive and returns NULL. PostgREST reports 0 rows and no error.
- From schema hardening, customers with a non-zero balance raise `customer_has_balance`.
- Other API deletes copy the old row into `private.deleted_rows`.
- A mass-delete guard raises `mass_delete_blocked` when one API transaction deletes more than 25 rows.

**Parties.**
- `customers.kind = 'party'` holds the old 'others' udhaar, backfilled per (shopId, lower(btrim(entityName))).
- Until contract, an AFTER INSERT trigger on `credits` with creditType 'others' keeps party balances in step: a direct update in schema hardening, and `post_credit_entry` from the ledgers migration.

**Per-shop rates** (on `settings`, editable by admin):

| Column | Meaning |
|---|---|
| defaultRefillPricePerMl numeric(14,4) | Refill price per ml when the product has none |
| refillPresetsMl jsonb | Refill size presets for the POS |
| importMarkupPct numeric(6,2) | Markup used when an imported row has no selling price |
| cashierBackdateDays int default 0 | How far back a cashier may backdate a sale |
| allowCashierPriceOverride boolean default true | Whether cashiers may change a unit price |
| creditWarnThreshold numeric(12,2) | Udhaar balance above which the POS warns |
| lowStockThreshold | Already exists |

`src/config/businessRules.ts` holds only fallback defaults. `create_shop` and `clone_catalog_to_shop` copy these rates.

**Ledgers.**
- `stock_movements` is the source of truth for stock.
  - kind: opening, sale, sale_void, return, receive, adjustment_in, adjustment_out, count_variance, write_off, transfer_out, transfer_in, transfer_reverse, import, direct_write, reconcile.
  - Other columns: reasonCode, qtyDelta, unit, qtyBefore, qtyAfter (CHECK qtyAfter = qtyBefore + qtyDelta), unitCost, refType/refId/refLineNo, server-stamped actor, occurredAt, businessDate, mutationId, clientBuild.
- `bottle_movements` has one row per bottle touched.
- `credit_ledger` holds a signed amount, balanceAfter, paymentChannel and refs.
- At ledger start there is one `opening` row per product and one per customer with a non-zero balance. Historic e-liquid sales get delta `bottle_movements` backfilled from `items[].bottleChanges`.
- The reconciliation views `v_stock_reconciliation`, `v_credit_reconciliation` and `v_bottle_reconciliation` must read zero. The bottle view reaches zero through the required reconciliation migration after the sale commands.

**Sale documents.**
- `sales` gains: status (completed, voided), voidedAt/By/Reason, replacesSaleId/replacedBySaleId, payCash/payOnline/payCredit, businessDate, receivedAt, invoiceNo, createdBy uuid, source, deviceId, clientBuild, flags text[].
- `sale_items` holds typed lines: listPrice, unitPrice, discountAmount, lineTotal, unitCost, lineCost, lineProfit, stockQtyDelta, returnedQty.
- `sale_returns` and `sale_return_items` hold returns.
- `sales.items` JSONB is kept as a server-generated receipt snapshot.

**Other tables.**
- `stock_alerts` is the single alerts table.
- `audit_log` is append-only.
- `sync_dead_letters` holds failed queue items.
- `private.processed_mutations` records applied commands.
- `catalog_items` (org level) plus `products.catalogItemId`, unique per shop, match the same product across one owner's shops. `catalogLinkedManually` and `priceReviewNeeded` are flags on products.

#### 5. Command layer

**Signature.**

```sql
public.<name>_v2(p_mutation_id uuid, p_shop_id uuid, p_payload jsonb) returns jsonb
-- SECURITY DEFINER, SET search_path = '', schema-qualified names (extensions.uuid_generate_v5 etc.),
-- EXECUTE revoked from public/anon and granted to authenticated, require_client_build() first
```

- The payload carries its own version `v`.
- Tenancy and admin RPCs use ordinary named parameters.
- `private.app_config` (schema_version, min_client_build) and a pass-through `private.require_client_build()` exist from the first new migration. The sync migration gives the function its real PT426 body.

**Envelope.** `{ok, status: 'applied'|'duplicate', mutationId, serverTime, result, effects: {products:[{id, stockQuantity, updatedAt}], customers:[...], bottles:[...]}, flags:[...]}`. The client writes `effects` straight into Dexie.

**Errors.** PostgREST `PTxyz` SQLSTATEs map to HTTP status: PT401, PT403, PT404, PT409, PT410, PT422 and PT426. Each carries a stable snake_case `message` code, such as `insufficient_stock`, `mass_delete_blocked`, `customer_has_balance`, `use_void` or `app_update_required`.

**Rules every command follows.**
1. The first statements are `require_client_build()` and `assert_shop_role(p_shop_id, roles)`. Any shopId inside the payload is ignored.
2. Products are locked `FOR UPDATE` in `(shopId, id)` order. Counter rows (`private.shop_counters`, `private.org_counters`) are locked last.
3. Every statement is shop-scoped and checks `FOUND`.
4. Actor, timestamps, totals, COGS, bottle allocation and log rows are computed on the server.
5. **Idempotency.** `private.begin_mutation(id, shop, command, payload)` inserts into `processed_mutations ... on conflict do nothing`.
   - A concurrent duplicate blocks on the unique index, then receives the stored envelope.
   - A reused id with a different command or shop raises PT409.
   - A failed command rolls back its own row, so a retry is allowed.
   - **Checkout ids:** for v2, mutationId = the client's uuid saleId. For v1, the server derives it: `saleId::uuid` when saleId is a uuid, otherwise `extensions.uuid_generate_v5('<fixed VapeTrax namespace>', saleId)`. The duplicate check is always on `sales.id` (text) in the shop.
6. **Accept facts, flag violations.** Offline-originated commands (checkout, customer create, credit payment, expense create) are rejected only for security or malformed input.
   - These are flagged in `sales.flags` and `stock_alerts`: negative stock, an unauthorised price override (per `allowCashierPriceOverride`), backdating, clock skew, overpayment, payment mismatch, `missing_product` and `missing_customer`.
   - An unknown product id stores the line without stock or bottle movement.
   - An unknown customer gets a tombstone customer created on the fly.
   - Only an id that exists in **another** shop raises PT403.
   - Online-only admin commands are strict.
7. **Backdate detection** compares saleDate with the client **enqueue** time (`p_sale_data.createdAt` for v1, `queuedAt` for v2), never with server receive time.
   - An offline sale synced days late keeps its saleDate and is not flagged.
   - A future saleDate more than 10 minutes ahead is clamped to now() and flagged `clock_skew`.
   - An explicit backdate is allowed for mgr+, or for cashiers within `cashierBackdateDays`. Beyond that it is flagged offline and rejected online.
8. **Money.** `lineTotal = round(unitPrice × qty, 2)`. Payment parts are non-negative and sum to the total within 0.01, or within 0.05 for legacy payloads, with the difference absorbed into cash.

**Commands.**

| Area | Commands (all `_v2` unless noted) |
|---|---|
| Sales | `sale_checkout_v2` (v2 payload, or v1 `{v:1, legacy}` translated in SQL), `sale_void_v2` (single or array, a savepoint per sale), `sale_edit_v2` (void plus new sale in one transaction; original saleDate kept), `sale_return_v2` |
| Stock | `product_upsert_v2` (no stock fields; `expectedUpdatedAt`), `product_archive_v2`, `stock_receive_v2`, `stock_adjust_v2` (delta plus reason code), `stock_count_v2`, `bottle_open_v2`, `bottle_reconcile_v2`, `product_import_v2` (≤2000 rows) |
| Parties | `customer_upsert_v2`, `customer_archive_v2`, `credit_record_v2`, `expense_upsert_v2`, `expense_delete_v2` |
| Sync | `sync_pull_v2`, `report_sync_failure_v2`, `discard_sync_item_v2`, `resubmit_dead_letter_v2`, `client_heartbeat`, `sync_health`, `alert_list`, `alert_resolve` |
| Reports | `report_dashboard`, `report_sales_page`, `report_expenses`, `search_stock_history`, `report_udhaar`, `report_detailed_export`, `report_product_sales`, `report_stock_valuation` |
| Transfers | `stock_transfer_create_v2`, `stock_transfer_reverse_v2`, `list_stock_transfers`, `get_stock_transfer`, `link_product_to_catalog_v2`, `clone_catalog_to_shop` |
| Tenancy | `app_info`, `my_context`, `create_organization`, `create_shop`, `update_shop`, `archive_shop`, `update_organization`, `create_invite`, `accept_invite`, `revoke_invite`, `list_shop_members`, `set_member_role`, `set_member_status`, `update_member_display_name`, `update_my_profile`, `link_shops`, `unlink_shops` |

**Legacy RPC lifecycle (constraint 3).**

| Migration | `process_checkout` | `process_reversal` |
|---|---|---|
| 20261011120000 (applied) | Membership check, shop-scoped writes, a replay returns early; `void` | Membership check, shop-scoped; delete = true is safe against a double delete; restores from client arrays |
| 20261012100000 (0.3) | Explicit DROP plus CREATE returning jsonb `{status}`; counted in `legacy_rpc_calls` by build; products locked by id; saleDate from the payload with a future clamp; credit derived from payment fields and capped; logs stamped by the server; a missing product or customer is recorded, never raised | Admin only; always deletes; a missing sale returns `{status:'duplicate'}`; restores computed from the stored row, with bottles restored by delta (never the absolute 'before' value) |
| 20261027100000 (2.3) | Re-created for composite FKs and new types: a tombstone customer is created on the fly and an unknown product is skipped | Re-created |
| 20261103110000 (2.5) | Thin translator into `sale_checkout_v2 {v:1}`, with the mutation id derived (v5 for non-uuid ids); client arrays and totals are ignored | delete = true becomes `sale_void_v2`; delete = false (the old edit flow) raises `PT426 app_update_required` before any side effect |
| 20270115100000 (6.3) | After gate B: stub raising PT426; signature kept | Stub raising PT426 |

`process_stock_adjustment` becomes a PT410 stub in 0.3, because nothing enqueues it.

#### 6. Shop-to-shop transfer flow

`stock_transfer_create_v2(p_mutation_id, p_shop_id = sending shop, {toShopId, lines:[{fromProductId, qty} | {fromProductId, bottles, looseMl}, toProductId?], note, createMissing})` runs as one transaction:

1. **Authorize.** The caller must be the org owner, or admin or manager in **both** shops. Both shops must be usable and in the same org (composite FKs), and an active `shop_links` row must exist. Otherwise PT403.
2. **Idempotency.** Through `processed_mutations`, plus `unique(orgId, mutationId)` on `stock_transfers`.
3. **Allocate.** `transferNo` comes from `private.org_counters`. All involved products in both shops are locked `FOR UPDATE` in `(shopId, id)` order. The counter is locked last.
4. **Process each line.**
   - Resolve the source within the sending shop.
   - The destination is the explicit `toProductId`, else the same `catalogItemId`. Otherwise, with `createMissing`, a counterpart is created by `INSERT ... ON CONFLICT DO NOTHING` followed by a re-select `FOR UPDATE`: same name, category, brand and size, stock 0, the sender's selling prices copied, and `priceReviewNeeded = true`. The destination's existing prices are never changed.
   - Quantity is pieces, or for e-liquid `bottles × bottleSizeMl + looseMl`, with `0 ≤ looseMl < bottleSizeMl`. Bottle sizes must match.
   - The sender can never go negative: PT409 `insufficient_stock`. If there are too few sealed bottle rows, it raises PT409 `insufficient_bottles`.
   - The line moves at the sender's weighted-average unit cost. The receiver's cost becomes a weighted average.
   - `post_stock_movement` writes `transfer_out` and `transfer_in` with the same refType 'transfer' and refId.
   - Sealed bottles at the sender become `transferred` with `remainingMl = 0`, keeping before and after in `bottle_movements`. They are recreated `closed` at the receiver with `sourceBottleId`. Loose ml is drained from opened bottles and becomes one opened bottle at the receiver.
   - No revenue, COGS or profit is recorded.
5. **Finish.** `stock_transfer_items` keeps both product ids (text), unit, qty, bottle count, loose ml, unitCost and lineCost. One `audit_log` row is written. The envelope returns the post-state of both shops' products. `sync_signals` are bumped for both shops.
6. **Reverse.** `stock_transfer_reverse_v2` takes these steps:
   - It first locks the transfer row with `select ... where id = $1 and orgId = <caller org> for update`.
   - It re-checks `status = 'completed'` under that lock.
   - It locks products in `(shopId, id)` order.
   - It is allowed only if the receiver still holds the quantity.
   - It posts `transfer_reverse` on both sides. `unique(reversesTransferId) where not null` blocks a second reversal.
7. **Catalog RPCs.**
   - `clone_catalog_to_shop` requires both shops to be in the same org, the caller to be its owner and both shops to be usable.
   - `link_product_to_catalog_v2` requires `catalog_items.orgId` = the org of the product's shop, plus mgr+ in that shop.
   - The catalog item is re-resolved on a name, category or size change unless it was linked manually. The wizard always shows the mapping.

Transfers are online-only. The wizard shows the sending shop's per-device pending counts (heartbeats) and asks for confirmation when any device has unsynced sales or has not been seen for over an hour. Offline sales arriving later are accepted and raise negative_stock alerts. Two-step send and receive is in the backlog.

#### 7. Offline sync

**Interim (R0, step 0.5).** `syncCloudToLocal` pages with `.order('id').range()`. It never clears tables, deletes only ids missing from a complete fetch, and keeps rows referenced by pending queue items. Reports use a temporary `fetchAllPages`.

**Dexie v2** uses the same database name `VapeTraxDB`.
- Stores:
  - `products`, `bottles`, `customers`: server snapshots, shop-indexed. The customers index is fixed to `name`.
  - `salesLocal`.
  - `outbox`: `++seq, &id, shopId, userId, status, [status+nextAttemptAt]`.
  - `meta`.
  - `authCache`.
- `upgrade()` copies **every** `syncQueue` row, whatever its status, inside Dexie's atomic upgrade transaction:
  - checkout items become `sale.checkout v1`, keeping status (pending or failed), retryCount, nextAttemptAt and error;
  - the mutation id is derived with the synchronous `uuid` v5 for non-uuid sale ids;
  - `userId` is null, so any member of that shop may submit the item;
  - overlay `effects` are computed from `p_product_updates[].deduction`, `p_bottle_updates`, `p_customer_id` and the credit increment;
  - other types become `needs_review`.
- The copied count is asserted. On a mismatch the upgrade throws, and the database stays at v1.
- A JSON backup goes into `meta`, and a full re-pull is forced.
- `syncQueue` stays declared until v3.
- `version(2).stores` and its `upgrade()` are **never** removed, so a v1 device can jump straight to the latest build.
- From R0, `db.on('versionchange')` shows a blocking 'Reload required' banner in old tabs.

**Worker.** `src/offline/worker.ts` is a plain module.
- It holds the per-shop Web Lock `vapetrax-sync:<shopId>`, with a localStorage lease fallback.
- It wakes on online, visibilitychange, a BroadcastChannel enqueue, and a timer for the earliest `nextAttemptAt`.
- It probes connectivity, then refreshes the session.
- It sends items in `seq` order, honouring `dependsOn`.
- Errors are classified as offline, auth, retryable, needs_update or permanent. Retries back off as `min(5 min, 2 s × 2^n)` with jitter, and an item is marked failed after 20 attempts.
- `duplicate` counts as success.
- Effects are applied in the same Dexie transaction that marks the item done.
- No UI can bulk-clear the queue.
- When the server is older than the client requires, offline-capable commands keep going into the outbox, draining pauses, and only online-only admin commands are blocked.

**Pull and overlay.**
- `sync_pull_v2` uses keyset paging on `(updatedAt, id)`, with a 2-minute overlap, tombstones and cost stripped for cashiers.
- Each page is written in one Dexie transaction, with no `clear()`.
- Screens read the snapshot plus the effects of pending outbox items.
- Realtime `sync_signals` events schedule a debounced pull.
- Pulls also run on login, shop switch, online, focus, after each drain and every 5 minutes.

**Offline auth.**
- From R0, a network failure with a persisted session and a matching cached profile keeps the user `offline-authenticated` (POS and queue only).
- R2 generalises this to a membership cache written only from successful `my_context()` responses.
- Caches are cleared only on an explicit `SIGNED_OUT`.

**PWA updates.**
- R0 stops forced reloads and auto-applies only when idle.
- R3a applies an update only when idle (empty cart, busy counter 0, no in-flight outbox item), after taking the sync lock.
- `min_client_build` (PT426) can force an update.

#### 8. Frontend structure

```
src/app       main.tsx, App.tsx, router (lazy routes), layouts, providers (Query, Auth, Shop, ShopSettings), errors, pwa
src/auth      session.ts, membershipCache.ts
src/commands  registry.ts, client.ts (execute), types.ts
src/config    env.ts (zod), businessRules.ts (fallback defaults only), permissions.ts
src/data      supabase.ts (createClient<Database>), queryClient.ts, keys.ts (['shop', shopId, ...]), paging.ts, pgrst.ts, appInfo.ts, repos/*
src/domain    PURE: money (paisa), dates, payments, product, bottles, cart, checkout, inventoryLog, receipt, transfer, import/parseProductSheet
src/offline   db.ts (Dexie v2), outbox.ts, worker.ts, handlers/, pull.ts, overlay.ts, realtime.ts (sync_signals), connectivity.ts, persist.ts, localStore.ts
src/features  pos, receipt, sales, products, customers, expenses, reports, inventory-logs, settings (incl. RatesTab), team, onboarding, shops, transfers, sync
src/ui        Modal, ConfirmDialog, IconButton, Field, MoneyInput, RowActions, Badge, KpiCard, QueryState, Empty/Error/OfflineState, DataTable, DateRangePicker
src/lib       errors.ts (AppError, must, mustAffect, classify, toUserMessage), log.ts, monitoring.ts
src/types     supabase.generated.ts, db.ts (MergeDeep overrides), domain.ts
```

**Layer rules** are enforced by ESLint `no-restricted-imports`:
- `domain` imports nothing from the app.
- Only `data`, `offline` and `commands` import the Supabase client.

**Data access.**
- Every Supabase call goes through `must()`.
- `mustAffect()` is used for updates only. Deletes on products, customers and sales use `must()` followed by a refetch, because archive-on-delete reports 0 rows.
- The query layer is TanStack Query v5, with repositories.

**Tests.**
- Vitest for the domain, offline and errors modules.
- Playwright against a hermetic `page.route` Supabase mock.
- SQL tests built on a `pg_temp` prelude. They run in the PGlite rehearsal in CI and are pasted into production as a second check.

#### 9. Migration delivery and verification

**File names** follow the existing convention `supabase/migrations/YYYYMMDDHHMMSS_name.sql`. The timestamps below are the planned order; the real prefix is set at authoring time and must keep this order.

**Each file:**
- runs as one transaction with `lock_timeout 5s` and `statement_timeout 5min`;
- starts with `require_migration(<list of prerequisite versions>)`;
- snapshots policies and functions;
- uses only idempotent DDL: IF [NOT] EXISTS, CREATE OR REPLACE, explicit DROP plus CREATE when a return type changes, drop-all-policies loops over `pg_policies`, CHECKs added only when clean, ON CONFLICT DO NOTHING;
- checks dependents in `pg_depend` and `pg_proc.prosrc` before any DROP COLUMN, and never uses CASCADE;
- ends with `mark_migration`, `notify pgrst, 'reload schema'` and a validation query `(check, ok, detail)`.

**Real-user check.** Files that touch access (0.3, 2.1, 2.2, 2.4, 6.1) include one in the validation. Every real profile is impersonated through `set local role authenticated` and `request.jwt.claims`, and its visible row counts are compared with what `postgres` sees for its shop. Any mismatch raises, which rolls the whole file back.

**The first new file** creates `private.schema_migrations` and seeds `20261011120000` as applied, because `private.is_shop_member(uuid)` already exists.

**Before each file reaches the owner,** `npm run sql:rehearse` must be green: the PGlite replica built from `live_before.sql` plus synthetic edge-case fixtures, every migration applied twice, every SQL test run. Before each risky file the owner runs `ops/snapshot_public.sql` and drains every device to 0 pending.

| File | Step | schemaVersion | Content |
|---|---|---|---|
| 20261011120000_emergency_security_lockdown | 0.0 | 0 | Applied 2026-10-11 |
| 20261012100000_lockdown_followup | 0.3 | 1 | Ledger and helpers, settings readable by members, append-only credits and logs, deny-all unused tables, admin-only personal_expenses, id defaults, archive-on-delete and mass-delete guard, jsonb legacy RPCs |
| 20261020100000_tenancy | 2.1 | 2 | Orgs, shops, memberships, invites, links, counters, helpers, backfill, mirrors, tenancy RPCs incl. update_shop and archive_shop |
| 20261020110000_rls_by_role | 2.2 | 3 | Gate R0 check, role-aware policies, sales writes revoked, validate_rls |
| 20261027100000_schema_hardening (+20261027100100_repair_sale_dates, optional) | 2.3 | 4 | Stamping, ISO normalisation, bottleSizeMl, normalisation triggers, CHECKs only when clean, composite FKs with tombstones, parties, per-shop rates, indexes |
| 20261103100000_ledgers_and_documents | 2.4 | 5 | Ledgers, sale documents, posting functions, capture guards incl. INSERT/DELETE, bottle backfill, RLS, views |
| 20261103110000_sale_commands | 2.5 | 6 | Checkout, void, edit and return; legacy translators |
| 20261103120000_reconcile_bottles (required) | 2.6 | 7 | Bottle ml made to match stock |
| 20261110100000_stock_party_commands | 2.7 | 8 | Product, stock, import, customer, credit and expense commands |
| 20261110110000_sync_support | 2.8 | 9 | sync_pull_v2, sync_signals, dead letters, heartbeat, sync_health, require_client_build |
| 20261110120000_reports | 2.9 | 10 | Report RPCs, cross-tenant test |
| 20261124100000_catalog_and_transfers | 5.1 | – | Catalog and transfers. R4 checks `app_info().migrations`, not the number. |
| 20261215100000_contract_lockdown | 6.1 | – | Gate A, then enforce guards, revoke direct writes, mask cost |
| 20261215110000_legacy_cleanup | 6.2 | – | Type conversions, remaining CHECKs, drops |
| 20270115100000_retire_legacy_rpcs | 6.3 | – | Gate B, then stubs, drop legacy helpers and mirrors |

**`app_info()`** returns `{schemaVersion, migrations[], minClientBuild, serverTime}`. R2 requires schemaVersion ≥ 10, and R4 requires `catalog_and_transfers` in `migrations`.

**Production smoke-test hygiene.** Use one designated test product with a noted stock level. Delete the test sales afterwards and record their ids in `MIGRATIONS_LOG.md`. Vercel previews write to the same production database.

#### 10. Cutover sequence and gates

1. **0.0, 0.1 and 0.2.**
   - Confirm the baseline.
   - Remove the remaining secrets, emails and dangerous SQL from HEAD.
   - Commit the probe and the rehearsal harness.
   - The owner names the Vercel remote, probably `zain_repo/main`.
2. **0.3 (`20261012100000`)** is applied during closed hours after the devices drain.
3. **R0 (0.4–0.7)** is pushed as a fast-forward of the Vercel remote. The old service worker force-reloads every device onto R0, and R0 itself stops forced reloads. **0.8** (history purge with force-push) runs whenever the owner confirms it in writing.
4. **R1 (Phase 1)** needs no database change.
5. **2.1 (tenancy).** Then **gate R0**: 7 days of `legacy_rpc_calls` with no `'unknown'` build, plus owner confirmation. Then 2.2, then 2.3 (and the 2.3b preview). 2.4, 2.5 and 2.6 run in one closed-hours session. Then 2.7, 2.8 and 2.9. R1 keeps working throughout, thanks to capture mode, translators, mirrors and archive-on-delete.
6. **R2 (Phase 3)** is deployed when schemaVersion ≥ 10. Queued v1 items migrate into the outbox.
7. **R3a–R3d (Phase 4)** in order. After R3d, no client writes tables directly except settings.
8. **5.1, then R4 (5.2–5.3).** This track is independent of gate A.
9. **Gate A** has four conditions:
   - 7 days with zero `direct_write` rows;
   - 14 days with no `'unknown'` build in `legacy_rpc_calls` or in `direct_write` rows;
   - every device seen in the last 14 days on R3d or later;
   - the owner's confirmation.
   Then 6.1, then 6.2.
10. **Gate B** has five conditions:
   - 14 days with zero `legacy_rpc_calls`;
   - at least 30 days since R2;
   - every device on R2 or later with pending = 0 and failed = 0;
   - no open `sync_dead_letters`;
   - no `'unknown'` builds.
   Then 6.3, both the migration and the Dexie v3 client.
11. **6.4** (strict TypeScript, enforced CSP), then **6.5** (documentation and backlog).


## Appendix B: Every finding → the step that fixes it

| Finding | Severity | Title | Step |
|---|---|---|---|
| DB-1 | critical | Supabase secret (service-role) key is hard-coded in migrate.js and committed to git | 0.1 |
| DB-2 | critical | fix-rls.sql disables RLS on profiles and settings, and grants.sql gives the anon role full table access | 0.0 |
| DB-3 | critical | Profile RLS lets any user set their own role and shopId, so anyone can join any shop as admin | 0.0 |
| DB-4 | critical | SECURITY DEFINER RPCs have no effective tenant scoping (no check, an anon-bypassable check, and id-only writes) | 0.0 |
| FIN-1 | critical | Checkout/reversal/adjustment RPCs lack working shop authorization and act on rows by id only, so callers can corrupt other shops' sales, stock and credit | 0.0 |
| FIN-2 | critical | Edit-sale flow reverses and deletes the old sale online before validating the new one against a stale local cache, so the sale can vanish and retries inflate stock | 4.5 |
| HYG-1 | critical | Supabase secret (service-role level) API key hardcoded in migrate.js and pushed to two GitHub remotes | 0.1 |
| HYG-2 | critical | SQL files saved as UTF-16 (treated as binary by git) turn off RLS on profiles/settings and grant ALL to anon | 0.1 |
| SEC-1 | critical | Supabase secret (service-role) API key hard-coded in migrate.js and pushed to two GitHub remotes | 0.1 |
| SEC-2 | critical | Any authenticated user can set their own profiles.role and profiles.shopId and so join any shop as admin | 0.0 |
| SEC-3 | critical | fix-rls.sql disables RLS on profiles and settings while grants.sql grants ALL to anon: unauthenticated read/write of every user and every shop's settings | 0.0 |
| SEC-4 | critical | process_checkout (fix/upgrade versions) is SECURITY DEFINER with no authorization check and is callable by anon | 0.0 |
| SEC-5 | critical | Shop-membership check in process_checkout_rpc / process_reversal / process_stock_adjustment is bypassed by NULL logic (anon callers or p_shop_id = null) | 0.0 |
| SYNC-1 | critical | The checkout RPC that the sync queue replays (process_checkout) no longer checks who is calling or which shop the rows belong to | 0.0 |
| DB-6 | high | Live process_checkout replaces the client sale date with NOW() and rewrites the *Client text format, booking sales on the wrong day | 0.3 |
| DB-7 | high | bottles.id has no default and every app bottle insert omits it, so e-liquid bottle rows are never created (errors are ignored) | 0.3 |
| DB-10 | high | Backup export silently stops at 1000 rows per table, and restore deletes everything then re-inserts without a transaction or error checks | 0.0 |
| DB-11 | high | Sale line items are stored as untyped JSONB with copied-in totals, and remove-item and edit-sale run as several separate client calls instead of one transaction | 2.5 |
| DB-12 | high | customers.creditBalance is an unledgered balance updated by read-modify-write from several places | 2.4 |
| DB-13 | high | Reports and finance totals are added up in the browser from unordered result sets capped at 1000 rows | 2.9 |
| FE-1 | high | Backup export is silently truncated and restore wipes the shop before re-inserting, ignoring every error | 0.0 |
| FE-2 | high | Editing a sale double-counts stock locally, corrupts bottle ml in the cloud, and can lose the sale | 4.5 |
| FE-3 | high | The local Dexie cache is filled once per login and never refreshed after direct cloud writes or other devices' sales | 3.3 |
| FE-4 | high | Stock and credit balances are written as absolute values computed from stale client snapshots (lost updates) | 4.8 |
| FE-5 | high | Stock page ignores Supabase errors, and bottle and log inserts lack the required id, so bottles are never created and single delete always fails | 0.7 |
| FE-7 | high | Sales History is not refreshed after delete or remove-item, so repeating the action double-reverses, and remove-item is a non-atomic multi-write | 4.7 |
| FE-8 | high | Reports, dashboard, sales totals and the offline cache are silently capped at 1000 rows | 0.5 |
| FE-9 | high | SyncEngine retries failing items in a tight infinite loop with no backoff, cap or idempotency | 0.4 |
| FE-10 | high | POS creates 'phantom' bottles that are never saved to Dexie, and refill FIFO ordering is broken | 1.10 |
| FIN-3 | high | Sale deletion is not idempotent and uses stale client-side sale objects, so repeated or late deletes double-restore stock and credit | 0.3 |
| FIN-4 | high | 'Remove item' partial refund is an unchecked multi-step client read-modify-write that rewrites the original sale instead of recording a refund | 4.7 |
| FIN-5 | high | Stock page writes absolute stock values computed from the stale Dexie cache and never refreshes that cache | 1.11 |
| FIN-6 | high | Bottle state is written as absolute snapshots (checkout 'after', reversal 'before'), causing lost updates under replay, reversal and multiple devices | 2.5 |
| FIN-7 | high | Sale timestamps are inconsistent: the live RPC overwrites saleDate with NOW(), stores saleDateClient as reformatted text, and pages filter on different fields | 2.3 |
| FIN-8 | high | Report queries are silently truncated at Supabase's 1000-row cap, and Detailed Reports only loads the last 90 days whatever range is chosen | 0.5 |
| FIN-9 | high | Backup export is truncated and drops settings; restore deletes everything first and re-inserts with unchecked errors | 0.0 |
| FIN-10 | high | Customer credit balance is maintained by client read-modify-write and overwritten by the customer edit form | 1.11 |
| GAP1-2 | high | Complete write inventory: 39 of 61 Supabase write/RPC sites drop { error }; 29 reachable ones can leave stock, credit or audit data half-written behind a success toast | 1.11 |
| GAP2-1 | high | Several stock-changing paths write no inventory log at all: bulk import, bulk product delete, backup restore, sync-queue clear and any direct API write | 2.4 |
| GAP2-2 | high | The logged change can differ from what was actually applied, so the log looks right while hiding the real stock movement | 2.4 |
| GAP2-4 | high | Audit tables can be changed: any shop member, including a cashier, can UPDATE or DELETE inventory_logs and credits rows | 0.3 |
| GAP2-9 | high | Deleting a customer erases their udhaar without any record, and any cashier can get past the guard from the UI | 2.3 |
| PERF-1 | high | Backup export stops at 1,000 rows per table, and restore deletes everything before re-inserting the shortened backup | 0.0 |
| PERF-2 | high | Dashboard, Sales History and Detailed Reports add up sales in the browser from queries silently capped at 1,000 rows | 4.10 |
| PERF-3 | high | Offline cache sync downloads at most 1,000 rows per table and replaces the local tables, so customers and products go missing and fake bottles get created | 0.5 |
| PERF-4 | high | Refreshing the local cache means a full re-download that overwrites unsynced offline sales, while Stock page edits never refresh it at all | 3.3 |
| PERF-6 | high | Date filters compare text columns that are stored in mixed formats or missing, and different screens filter on different date columns | 2.3 |
| SEC-6 | high | SECURITY DEFINER RPCs update rows by id without shop scoping and insert rows using the payload's shopId (cross-tenant IDOR) | 0.0 |
| SEC-7 | high | Admin/cashier roles are enforced only in React; RLS and RPCs give cashiers full admin data powers | 2.2 |
| SEC-8 | high | RPCs trust client-computed money values: arbitrary credit increments/decrements and sale totals | 2.5 |
| SEC-9 | high | inventory_alerts has USING (true) / WITH CHECK (true) policies: cross-shop read and write, open to anon via grants.sql | 0.0 |
| SEC-10 | high | Backup restore is a non-atomic client delete-then-insert with ignored errors and no validation; it can wipe a shop and still report success | 0.0 |
| SYNC-2 | high | Offline (or a failed profile fetch), a cashier is silently switched to admin of an empty shop, so the offline POS shows no products | 0.6 |
| SYNC-3 | high | Opening the app offline more than about an hour after the last token refresh logs the user out, and logging in needs the network | 0.6 |
| SYNC-5 | high | The 'clear queue' button permanently deletes every unsynced sale, including healthy ones and while offline | 0.4 |
| SYNC-6 | high | The Dexie product/customer cache is only refreshed at login and after customer/credit actions (a regression from the old realtime useSupabase) | 3.3 |
| SYNC-7 | high | syncCloudToLocal replaces the local tables with server data and ignores the pending queue, wiping unsynced deductions and racing with checkout and sync | 3.3 |
| SYNC-8 | high | Products-page edits and imports write an absolute stockQuantity based on the stale local cache, so sales and restocks get lost and imports duplicate products | 4.8 |
| SYNC-9 | high | Bottles auto-created at checkout are never saved locally, so each sale creates another phantom bottle on the server | 2.5 |
| SYNC-10 | high | Synced sales are dated by when they synced, not when they happened, and saleDateClient changes format | 0.3 |
| UX-1 | high | Product and customer lists go stale after any change made outside POS checkout, until a full reload | 3.3 |
| UX-2 | high | A deleted sale stays on screen, and deleting it again reverses stock and udhaar a second time | 0.7 |
| UX-4 | high | Editing a customer silently overwrites their udhaar balance with no ledger entry, and cashiers can do it | 0.6 |
| UX-5 | high | Any cashier can permanently discard un-synced sales with a 14px trash icon | 0.0 |
| UX-6 | high | Many writes ignore Supabase errors and still show a success toast (for example, product delete) | 1.11 |
| UX-7 | high | Backups are silently incomplete, and Restore wipes the shop before checking the file | 0.0 |
| DB-5 | medium | No migration history: schema.sql is not the live schema, and conflicting loose RPC files have no defined order | 1.2 |
| DB-8 | medium | Code writes columns that exist in neither schema.sql nor the live schema, hidden because the Supabase client is untyped | 1.5 |
| DB-9 | medium | process_checkout is not idempotent: a retry after a lost response fails forever, and the only remedy wipes the whole offline queue | 0.0 |
| DB-14 | medium | Foreign keys are inconsistent: the live DB appears to lack them, and where schema.sql defines them their ON DELETE behaviour makes deletes fail silently | 2.3 |
| DB-16 | medium | Each table has two timestamps (createdAt timestamptz and a text *Client copy), filled and filtered inconsistently | 2.3 |
| DB-18 | medium | RLS ignores role: through the API a cashier can do everything an admin can | 2.2 |
| DB-19 | medium | inventory_alerts can be read and written by any user, breaks the naming convention, and is never shown in the app | 2.3 |
| DB-20 | medium | Audit fields come from the client and inventory log quantities are computed from a stale local cache | 2.4 |
| DB-21 | medium | There is no shops table: a shop is identified by its admin's auth uid, and shops and cashiers are provisioned from the browser | 2.1 |
| DB-22 | medium | migrate.js lost data: timestamps copied raw, camelCase keys sent to snake_case tables, non-UUID profile ids | 2.3 |
| FE-6 | medium | Auth treats any profile-fetch failure (including offline) as a first login and grants admin with the wrong shopId; cashier create and delete are unsafe | 0.6 |
| FE-11 | medium | Sale dates are inconsistent between pages; backdated, offline and edited sales land on different days | 4.4 |
| FE-12 | medium | Dashboard's 3 AM business-day offset is only half implemented, and period labels are wrong | 4.10 |
| FE-13 | medium | Dashboard 'Recovered Credit' is always Rs 0 for payments recorded in the app | 0.6 |
| FE-14 | medium | Editing an expense, the admin profile or a cashier always fails because of a non-existent updatedAt column | 0.0 |
| FE-15 | medium | Type checking is effectively disabled: React types are missing, the Supabase client is untyped and strict mode is off | 1.5 |
| FE-16 | medium | Checkout amounts are not validated: float equality blocks split payments and negative or zero prices are accepted | 0.6 |
| FE-17 | medium | Edit-sale cart leaks into the POS, and cart, offline cache and sync queue persist across users on shared devices | 4.5 |
| FE-18 | medium | Query errors are swallowed, so offline or failed loads show Rs 0 and 'No sales found' | 4.4 |
| FIN-11 | medium | Three conflicting process_checkout definitions; the upgrade version cannot work and the canonical fix version silently changes semantics | 0.3 |
| FIN-12 | medium | Sync queue has no idempotency, retries in a hot loop with no backoff, and 'Clear queue' discards all unsynced sales | 0.4 |
| FIN-13 | medium | Cloud-to-local refresh wipes unsynced local stock, bottles and credit while queue items are pending | 0.5 |
| FIN-14 | medium | Bottle inserts and the product-deletion log omit the required text id, so they always fail; errors are ignored and bottle tracking is broken | 0.7 |
| FIN-15 | medium | Floating-point money and ml math with strict equality in split validation; negative split components are accepted | 0.6 |
| FIN-16 | medium | COGS and weighted-average cost use stale cached cost/stock and can weight against negative stock | 2.7 |
| FIN-17 | medium | Dashboard 'Recovered Credit' is always zero because credit payments never set createdAtClient | 0.6 |
| FIN-18 | medium | Dashboard 'business day' (3 AM rule) picks the date but still queries midnight to midnight | 4.10 |
| FIN-19 | medium | Negative stock is silently allowed, the alerts it generates are never shown, and the alerts table is readable across shops | 4.10 |
| GAP1-1 | medium | No error boundary or global error handler: one bad date input or an IndexedDB error blanks the whole PWA, including offline | 1.11 |
| GAP1-3 | medium | Spreadsheet import number parser turns common Pakistani price formats into 0 or 0.5 and still marks the row 'Valid' | 1.10 |
| GAP1-5 | medium | Import validation and commit gaps: duplicates within a file, unbounded quantities, wrong row numbers, hidden invalid rows, no audit log | 4.8 |
| GAP1-6 | medium | Settings page falls back to default values when loading fails, so the next Save overwrites the real shop settings | 0.6 |
| GAP1-7 | medium | Long multi-step operations have no unload guard and no recovery after partial failure; a bulk sale delete retried after an error reverses sales twice | 4.2 |
| GAP1-8 | medium | Clicking remove-item on two lines of the same invoice brings a removed item back after its stock was restored | 4.7 |
| GAP1-9 | medium | No observability: 36 console calls, no telemetry, sync failures exist only in the device's IndexedDB, and 'Clear queue' erases the only record | 3.2 |
| GAP2-3 | medium | Log before/after snapshots are unusable: previousStock is never written, newStock is wrong or missing, and the live RPC throws away newStockMl and createdBy | 2.4 |
| GAP2-5 | medium | Backup restore wipes and rewrites the audit trail from an unvalidated JSON file and records no restore event | 0.0 |
| GAP2-6 | medium | Inventory logs cannot be linked to sales: checkout logs have no sale id, reversals keep only 6 characters, and deleted sales leave no record of the money | 2.5 |
| GAP2-7 | medium | Editing a sale reverses it, hard-deletes it and re-inserts it under the same id: the original cashier and time are replaced, and no version history is kept | 2.5 |
| GAP2-8 | medium | Bottle ml and status changes have no audit trail, and bottle ml is never reconciled with product ml | 2.6 |
| GAP2-10 | medium | Udhaar history is rebuilt from changeable sales plus credits, has no reversal entries, and is never checked against creditBalance | 2.4 |
| GAP2-11 | medium | 'Others' udhaar entries are saved but never displayed: no screen lists, totals or settles them | 4.9 |
| GAP3-1 | medium | Checkout and stock-adjustment business logic lives inside two 300+ line UI event handlers, so none of it can be tested | 1.10 |
| GAP3-2 | medium | An atomic process_stock_adjustment RPC and its queue handler exist, but the Stock page never uses them and keeps its own 13-call implementation | 4.8 |
| GAP3-3 | medium | Bottle creation is copy-pasted 7 times and row-to-BottleDoc mapping 4 times; only NewSale's copies set the required id | 1.10 |
| GAP3-4 | medium | Sales 'remove item' re-implements salesReversal line by line, but with a different write strategy and different credit rules | 4.7 |
| GAP3-5 | medium | Inventory log rows are hand-built in 12 places with inconsistent fields; bulk import and bulk product delete write no log at all | 1.10 |
| GAP3-9 | medium | Core domain objects are untyped: DataContext exposes any[], sale line items have no type, and the row types in db.ts are never imported | 1.5 |
| GAP4-1 | medium | The spreadsheet's 'Vendors GL' (supplier payables and purchase bills) has no place in the app, and restocking records no supplier, bill or amount owed | moot (6.5) |
| GAP4-3 | medium | The app cannot show how much cash should be in the drawer: expenses and udhaar receipts have no payment channel, there is no opening float, and the Dashboard 'CASH' card adds in every recovered credit | moot (4.10) |
| GAP4-5 | medium | Udhaar has no credit limit, and the POS does not show a customer's outstanding balance before a credit sale | moot (4.5) |
| HYG-3 | medium | @types/react and @types/react-dom are missing, so `tsc --noEmit` checks nothing in the React code | 1.5 |
| HYG-4 | medium | No migration system: schema.sql differs from the live DB, three conflicting process_checkout definitions, and an inventory_alerts table open to everyone | 1.2 |
| HYG-5 | medium | Real business financial records committed to the repository | 0.8 |
| HYG-7 | medium | xlsx 0.18.5 has known vulnerabilities, is no longer fixed on npm, parses user-uploaded files, and its static import cancels the lazy load | 1.4 |
| HYG-9 | medium | Dev server listens on 0.0.0.0 while running a vulnerable Vite 6.4.1 on Windows | 1.4 |
| HYG-10 | medium | PWA icons don't exist, so the app is not installable and 'Install Now' never appears; orientation is locked to portrait | 4.3 |
| HYG-12 | medium | Leftover root scripts can overwrite or pollute production data (migrate.js re-runs every step; test_sale.js inserts a fake sale) | 0.1 |
| HYG-13 | medium | Firebase-era 90-day query window silently cuts Detailed Reports short | 0.5 |
| HYG-15 | medium | No linting, formatting, tests or CI; the scripts are misleading | 1.8 |
| PERF-5 | medium | SyncEngine retries a failing item in a tight loop with no backoff or limit | 0.4 |
| PERF-7 | medium | The schema has no indexes beyond primary keys, and RLS policies run auth.uid() and EXISTS checks for every row | 2.2 |
| PERF-8 | medium | The whole app ships as one 1.69 MB JavaScript file, including the xlsx and recharts libraries, with no route-level code splitting | 4.2 |
| PERF-9 | medium | The app's offline cache is close to its 2 MiB per-file limit, the install icons don't exist, and app updates force a page reload mid-sale | 4.3 |
| PERF-10 | medium | The Expenses page loads only the latest 200 expenses but labels its sums as all-time totals | 4.9 |
| PERF-11 | medium | Inventory Logs truncates results silently and passes raw search text into the server filter | 4.11 |
| PERF-13 | medium | Bulk operations make one request at a time in a loop (N+1), and none of them is atomic | 4.7 |
| SEC-11 | medium | Cashier creation and removal are done client-side: session swap race, unchecked profile insert, and deleted cashiers keep working accounts | 3.4 |
| SEC-12 | medium | AuthContext treats any profile-fetch error as 'new user' and grants the admin role, caching it in localStorage | 0.6 |
| SEC-13 | medium | Offline IndexedDB data and the sync queue are not tied to a user and not cleared on logout; any user can discard unsynced sales | 3.4 |
| SEC-14 | medium | Audit-trail identity (actorName/actorRole/createdBy) is supplied by the client and can be forged | 2.3 |
| SEC-15 | medium | Confidential business ledger with personal names committed to git and pushed | 0.8 |
| SEC-16 | medium | Live database has drifted from the repo: tables with unknown RLS state (purchases, suppliers, users), missing FKs, untracked inventory_alerts | 0.3 |
| SYNC-4 | medium | A failing queue item is retried in a tight loop with no backoff, no retry limit and no 'failed' state | 0.4 |
| SYNC-11 | medium | Retried uploads are not idempotent and nothing prevents two tabs from syncing at once, so a sale that already reached the server becomes a permanently failing 'duplicate key' item | 3.2 |
| SYNC-12 | medium | Editing a bill is online-only and spread over several requests: a network blip can restore stock twice or lose the bill | 4.5 |
| SYNC-14 | medium | Users get misleading signals about pending and failed sales; negative-stock alerts are never shown | 3.3 |
| SYNC-15 | medium | The cloud-to-local pull is not paginated, so once a shop has more than 1,000 bottle rows the local cache is silently cut off | 0.5 |
| SYNC-16 | medium | New versions force an immediate page reload, which can cut off a queue sync, a stock import or a half-filled form | 0.7 |
| UX-3 | medium | No receipt printing at checkout, and the only Print button prints the whole app in an A4 layout | 4.6 |
| UX-8 | medium | Editing a sale takes over the POS cart, and an abandoned edit leaves those items ready to be sold again | 4.5 |
| UX-9 | medium | Invoices print wrong or missing information: credit sales marked 'Paid' and the footer setting ignored | 4.6 |
| UX-10 | medium | Several Settings controls are saved but have no effect anywhere | 4.12 |
| UX-11 | medium | No return or void workflow: corrections hard-delete the sale, so the 'Returns' KPI can never rise above zero | 4.7 |
| UX-12 | medium | POS checkout is slow for a busy counter: no barcode, no keyboard flow, no change calculator | 4.5 |
| UX-13 | medium | Refill pricing produces float totals that make split payments impossible, and silently falls back to Rs 100/ml | 4.5 |
| UX-14 | medium | Cashiers can override prices, backdate sales and delete customers with no limit or record | 4.5 |
| UX-15 | medium | Tablet and phone layout problems: portrait-locked PWA, stacked POS, overlapping menu button | 4.2 |
| UX-16 | medium | Row action buttons are invisible on touch screens and when reached by keyboard | 4.1 |
| UX-17 | medium | Basic accessibility is missing: no accessible names, linked labels, dialog semantics or Esc to close | 4.1 |
| UX-19 | medium | The Dashboard labels weekly and monthly figures as "TODAY'S" and drops after-midnight sales | 4.10 |
| UX-20 | medium | Several KPI cards show fake or mislabelled numbers | 4.9 |
| UX-21 | medium | History and report screens silently drop rows beyond a limit | 4.11 |
| UX-22 | medium | Detailed Reports: 'Print PDF' does nothing and sale item names are blank | 4.11 |
| UX-23 | medium | Inventory Logs filters never match, and the search box loses focus while typing | 4.11 |
| UX-24 | medium | Errors and offline state show up as empty data; offline support covers only checkout | 4.4 |
| UX-25 | medium | Udhaar workflow gaps: no balance shown when receiving payment, overpayment allowed, contact field dropped | 4.9 |
| UX-26 | medium | PWA icons are missing, and updates force-reload the app without asking | 4.3 |
| UX-31 | medium | Login and account management are misleading: dead 'Remember me', open signup, and 'removed' cashiers can still sign in | 3.4 |
| DB-15 | low | Missing CHECK constraints and enums, and stock units depend on a free-text category | 2.3 |
| DB-17 | low | Settings RLS lets only the owner read, so cashiers' invoices print without shop branding | 0.3 |
| DB-23 | low | No indexes beyond primary keys | 2.3 |
| DB-24 | low | Money columns are numeric with no scale and store unrounded JavaScript float results | 2.3 |
| DB-25 | low | No uniqueness constraints on product or customer natural keys | 2.3 |
| DB-26 | low | No updatedAt triggers: several tables have no updatedAt, and where it exists the client sets it | 2.3 |
| DB-28 | low | Unused, legacy and duplicated tables and columns | 6.2 |
| FE-19 | low | Full-page spinner on every refetch unmounts filter inputs (search loses focus while typing) | 4.4 |
| FE-20 | low | Inventory Logs search builds the PostgREST or() filter by string interpolation, and two type filters never match | 4.11 |
| FE-21 | low | Detailed Reports: item descriptions are blank, Print PDF does nothing, and ranges older than 90 days return partial data | 4.11 |
| FE-22 | low | Settings form fields are not used by the app; the invoice reads different keys; Sidebar and cashier list go stale | 4.12 |
| FE-23 | low | Misleading KPIs and labels on money screens | 4.9 |
| FE-24 | low | Dead code, unused dependencies and documentation drift | 1.3 |
| FE-25 | low | Garbled characters (mojibake) shown to users | 1.1 |
| FE-26 | low | Firestore-era date handling still in use; bottle dates always show '-' | 1.10 |
| FE-27 | low | Context values are not memoized, and the auth handler re-runs on every auth event and resets forms | 3.4 |
| FE-28 | low | Service-worker update force-reloads the app immediately, even mid-operation | 0.7 |
| FE-29 | low | Default dates use the UTC calendar day (toISOString) instead of Pakistan local time | 1.7 |
| FIN-20 | low | The double-entry finance module is unreachable, and its writes would fail silently because of schema mismatches | 1.3 |
| FIN-21 | low | Refill bottle ordering relies on Firestore Timestamp.toMillis, so FIFO is lost on Supabase strings | 1.10 |
| FIN-22 | low | UTC date defaults and audit-field overwrites in expenses and sale backdating | 1.7 |
| FIN-23 | low | Misleading financial labels and figures in reports and invoices | 4.11 |
| GAP1-4 | low | Read errors are swallowed in reads that gate writes, so stock and credit restorations are silently skipped while the sale is still deleted | 1.11 |
| GAP1-10 | low | Product, customer and expense forms accept negative or meaningless values and store untrimmed, un-normalised fields | 4.8 |
| GAP1-11 | low | Error messages are either raw database text or vague, and re-authentication reports network failures as 'Incorrect password' | 1.11 |
| GAP1-12 | low | Even 'checked' writes report success when they affect zero rows (row deleted on another device or hidden by RLS) | 1.11 |
| GAP1-13 | low | Unparseable dates are silently shown and exported as 'now'; edit-sale then throws on them after the old sale is already reversed | 1.7 |
| GAP2-12 | low | Manual stock removals have no reason code, there is no stock-count workflow, and price/cost edits are not logged | 2.7 |
| GAP2-13 | low | The RPCs take stock changes and log rows as two separate client arrays, so the logs are not derived from what the RPC actually applied | 2.5 |
| GAP2-14 | low | Inventory Logs page: no units shown, manual deductions not highlighted, a missing role is shown as Admin, and there is no per-product running view | 4.11 |
| GAP2-15 | low | process_stock_adjustment is dead code, so manual adjustments never go through an atomic, logged path | 2.7 |
| GAP3-6 | low | Bulk-import price parser turns common Pakistani price formats into 0 or 0.165 and still marks the row valid | 1.10 |
| GAP3-7 | low | RPC payload contracts are untyped and differ between the three RPCs; the 'fix' version of checkout silently dropped log columns | 1.10 |
| GAP3-8 | low | Business rules are hard-coded and contradict each other, while matching settings columns already exist and go unused | 1.7 |
| GAP3-10 | low | The cash/online/credit breakdown of a sale is computed in 7 places with two different parsers | 1.7 |
| GAP3-11 | low | There are three data-access styles, a query builder copied three times, and three separate settings fetches | 4.4 |
| GAP3-12 | low | Bottle allocation rules are split across three implementations with different orderings, and only one of them is affected by the FIFO bug | 1.10 |
| GAP3-13 | low | Page scaffolding is copy-pasted: bulk-select, re-auth and delete flows, a dead Firebase error branch, date presets, modal shells and inconsistent badge colours | 4.1 |
| GAP3-14 | low | Date helpers are duplicated, and the `// new Date()` fallback shows missing dates as 'now' | 1.7 |
| GAP3-15 | low | Product kind is decided by raw string literals in 26 places, with no shared predicate or category type | 1.7 |
| GAP4-2 | low | The Expenses page invites stock purchases and owner withdrawals to be recorded as shop expenses, which counts their cost twice in Net Profit | 4.9 |
| GAP4-4 | low | 'Others' credit entries, the natural place to record owner loans, can be written but never viewed, and the schema's 'supplier' credit type cannot be reached from the UI | 4.9 |
| GAP4-6 | low | The only way to give a discount is to overwrite the unit price, and the list price is not saved on the sale line, so total discounts cannot be measured | 2.5 |
| GAP4-7 | low | Sales record only the cashier's email prefix: the name entered in Settings is never used and no stable user id is stored, so per-cashier and shift reports are unreliable | 4.7 |
| GAP4-8 | low | There is no readable sequential invoice number, and the Invoice Prefix setting is never used | 4.6 |
| GAP4-9 | low | Product categories are fixed to device, coil and e-liquid, so pods, disposables and accessories are filed under the wrong category and category reports would mislead | moot (6.5) |
| GAP4-10 | low | Manual stock removals have no reason category, so wastage, testers and expired stock are invisible | 4.8 |
| GAP4-11 | low | Excel export cannot reproduce the spreadsheet's daily 'Sale' sheet: split sales export as just 'split', and there is no daily cash/online summary | 4.11 |
| GAP4-12 | low | The unrouted double-entry module matches the spreadsheet's workflows, but its ledger logic is wrong, so it should not simply be given a route | 1.3 |
| GAP4-13 | low | There is no reorder support: minimum stock levels are hard-coded and cannot be edited, and the dashboard alert that Settings promises does not exist | 4.8 |
| HYG-6 | low | Commit c650023 re-encoded the source: garbled characters (mojibake) visible in the UI, BOMs added to 23 files, no .gitattributes or .editorconfig | 1.1 |
| HYG-8 | low | Unused and misplaced dependencies cause 19 audit findings (1 critical) and confusion; the package is still named 'react-example' | 1.4 |
| HYG-11 | low | Documentation is AI Studio boilerplate or describes Firebase; memory.md tells AI editors to use Firestore hooks | 6.5 |
| HYG-14 | low | Supabase client is untyped, generated types are stale, and missing env vars cause a blank screen | 1.5 |
| HYG-16 | low | Firebase and AI Studio leftovers are still tracked and can still deploy | 1.3 |
| HYG-17 | low | tsconfig/vite config cruft: tsc parses dist/ and root scripts, unused decorators/alias, Gemini define, AI Studio HMR comment | 1.5 |
| HYG-18 | low | Unreachable feature code is shipped (double-entry finance components, sample-data seeder) | 1.3 |
| HYG-19 | low | vercel.json has no caching or security headers, and the catch-all rewrite hides missing files | 4.3 |
| HYG-20 | low | PWA reloads itself as soon as an update is detected, even though registerType is 'prompt' | 0.7 |
| HYG-21 | low | No route-level code splitting: one ~1.5 MB JS bundle for every user | 4.2 |
| PERF-12 | low | Long lists render every row and search does O(n·m) work on each keystroke and cart change | 4.5 |
| PERF-14 | low | Dashboard downloads full sale records and computes figures it never shows | 4.10 |
| PERF-15 | low | Context values are not memoized and auth events cause extra profile fetches and app-wide re-renders | 3.3 |
| SEC-17 | low | 'Re-authentication' for sensitive actions is a client-only speed bump and blocks Google-login users | 4.13 |
| SEC-18 | low | No security headers on the Vercel deployment (CSP, frame-ancestors, etc.) | 4.3 |
| SEC-19 | low | SECURITY DEFINER functions have no fixed search_path and use unqualified table names | 0.0 |
| SEC-20 | low | Dev server exposed on all interfaces while running a Vite version with dev-server file-read advisories | 1.4 |
| SEC-21 | low | PostgREST filter-string injection in Inventory Logs search | 4.11 |
| SEC-22 | low | Infrastructure identifiers and risky scripts committed; dead GEMINI_API_KEY define | 0.1 |
| SEC-23 | low | Weak password policy and incomplete password-recovery flow | 4.13 |
| SYNC-13 | low | The queue, local cache and cart are not tied to a user or shop, and logout neither syncs, warns nor clears them | 3.4 |
| SYNC-17 | low | The app cannot be installed as a PWA: icon files are missing and the install prompt is listened for too late | 4.3 |
| SYNC-18 | low | Connectivity is judged only by navigator.onLine: no reachability check, no timed retry, and three separate listeners | 3.2 |
| SYNC-19 | low | Persistent storage is never requested, and checkout requires IndexedDB even when online | 3.3 |
| SYNC-20 | low | Queue design gaps: unversioned payloads, declared-but-unhandled operation types, unsafe stock-adjustment handler, wrong Dexie index | 3.2 |
| UX-18 | low | Low-contrast 10px text and colour-only status cues throughout | 4.1 |
| UX-27 | low | Documented features are missing from the app (Analytics, Personal Expenses, finance ledger, suppliers, barcode) | 6.5 |
| UX-28 | low | Garbled characters (broken encoding) appear in the UI | 1.1 |
| UX-29 | low | The Dark Mode toggle does nothing | 4.2 |
| UX-30 | low | Date and currency formatting is inconsistent, and default dates use UTC | 1.7 |
| UX-32 | low | Error messages show raw database codes, and some checks still look for Firebase codes | 1.11 |
| UX-33 | low | Bottle Details always shows '-' for Opened, Created and Updated dates | 1.10 |
| DB-27 | info | Seed data writes inconsistent records and ships in the production bundle | 1.3 |
| HYG-22 | info | Git workflow: two diverging remotes, direct pushes to main, and very large mixed commits | 0.8 |
| PERF-16 | info | Unused realtime hook and finance module would cause scaling problems if reused | 1.3 |
