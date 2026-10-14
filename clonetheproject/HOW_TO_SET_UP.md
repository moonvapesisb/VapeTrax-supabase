# Set up VapeTrax for another shop (with its own Supabase)

This gives another shop owner (for example a friend) their **own copy** of VapeTrax:

- their own Supabase database, on **their** Gmail;
- their own GitHub copy of the code, and their own Vercel website.

Their data and yours are completely separate. Your customers, sales and spreadsheet are **never** copied.

There are 5 parts:

| Part | Who | Time |
|---|---|---|
| A. Create their Supabase database | the friend (you can help) | 10 min |
| B. Give them a clean copy of the code | you | 5 min |
| C. Put their website online with Vercel | the friend | 10 min |
| D. First login and shop setup | the friend | 5 min |
| E. Later updates | you, then the friend | a few min each time |

---

## A. Create their Supabase database (on the friend's Gmail)

1. **Create the project.**
   1. Go to **https://supabase.com** and click **Start your project**. Sign in with the **friend's** Gmail or GitHub.
   2. Click **New project**:
      - **Organization:** their own (Free).
      - **Project name:** `VapeTrax`.
      - **Database password:** click **Generate**, then **save it somewhere safe**. Do not share it.
      - **Region:** **South Asia (Mumbai)**, the closest to Pakistan.
   3. Click **Create new project** and wait 1–2 minutes until it is ready.
2. **Build the whole database with one file.**
   1. Open the file **`clonetheproject/database_setup.sql`** from this folder. On GitHub, open it and click **Raw**, then select everything with Ctrl+A and copy with Ctrl+C.
   2. In Supabase, click **SQL Editor** in the left menu, then **New query**. Paste with Ctrl+V and click **Run**.
   3. It takes up to a minute. The result at the bottom must say **`"all_ok": true`**.
      - **If you see an error instead:** nothing was created (the file is all-or-nothing). Copy the error message and send it to the developer.
      - **Run it only once,** and only on this new, empty project. It refuses to run on a project that already has VapeTrax tables, so it can never touch your own shop's database.
3. **Login settings** (Authentication in the left menu):
   - **Sign In / Providers → Email:** Email turned **ON**, **Confirm email** turned **OFF** (same as the original shop), then click **Save**.
   - **Allow new users to sign up:** keep it **ON**. The app needs it to create cashier accounts.
4. **Copy the two connection values.** In **Project Settings** (gear icon) → **API Keys**, and **Data API** for the URL, copy:
   - the **Project URL** (looks like `https://abcdxyz.supabase.co`);
   - the **publishable key** (`sb_publishable_…`), or under *Legacy API keys*, the **anon public** key (`eyJ…`).

   ⚠️ Never copy or share the **secret** / **service_role** key. The app never needs it.

> **Free plan note:** Supabase pauses a free project after about 7 days with no use. A shop that sells every day will not be paused. If it ever is, open the project in Supabase and click **Restore**.

---

## B. Give them a clean copy of the code (you do this)

Your GitHub repository holds your business data. **Never** give the friend your repository itself. This makes a clean copy without your data or history:

1. **The friend creates an empty repository.** On the friend's GitHub (**github.com → New repository**):
   - **Name:** e.g. `vapetrax`.
   - **Visibility:** **Private**.
   - **Do not** add a README, .gitignore or license, so the repository is empty.
2. **The friend gives you access.** In that repository: **Settings → Collaborators → Add people**, then add your GitHub user (`ZainMal3125`).
3. **You make the clean copy.** In your VapeTrax folder, run this, with the friend's **GitHub** name and email:
   ```bash
   node scripts/make-friend-copy.mjs "Friend Name" "friend@gmail.com"
   ```
   It creates a local branch `share/friend` containing only the app code. Your `data/` folder, your one-off scripts and your database log are left out. The commit is labelled with the friend's name, so the friend's free Vercel plan will deploy it.
4. **Send it to the friend's repository.** Replace `FRIEND` and `REPO`:
   ```bash
   git push https://github.com/FRIEND/REPO.git share/friend:main
   ```

---

## C. Put their website online (Vercel, friend's account)

1. **Import the code.**
   1. Go to **https://vercel.com** and sign up with the friend's **GitHub**.
   2. Click **Add New… → Project** and **Import** their VapeTrax repository.
2. **Add the two connection values.** Vercel detects **Vite** automatically. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | the Project URL from A4 |
   | `VITE_SUPABASE_ANON_KEY` | the publishable or anon key from A4 |
3. **Deploy.** Click **Deploy** and wait until it says **Ready**. Copy the website address (e.g. `https://vapetrax-friend.vercel.app`).
4. **Point Supabase at the website.** Back in Supabase, open **Authentication → URL Configuration**, set **Site URL** to that website address, and click **Save**. Password-reset emails then open the right website.

---

## D. First login and shop setup (friend)

1. **Create the admin account.** Open the website and click **Sign up**. Use the shop owner's email and a strong password. **The first account becomes the shop's admin.**
2. **Shop details.** In **Settings**, fill in the shop name, address and phone, which are printed on invoices.
3. **Products.** Under **Products**, add products, or use **Bulk Import**.
4. **Cashiers.** In **Settings → Cashiers**, add each cashier's email and password. Cashiers can then log in on their own phones.

Done. The shop runs completely separately from yours.

---

## E. Later updates (when VapeTrax gets new features)

1. **You:** in your VapeTrax folder, run the same two commands again:
   ```bash
   node scripts/make-friend-copy.mjs "Friend Name" "friend@gmail.com"
   ```
   ```bash
   git push https://github.com/FRIEND/REPO.git share/friend:main
   ```
   The friend's Vercel deploys the new version automatically.
2. **If the update also changes the database,** the developer will name the new file(s) in `supabase/migrations/`. The friend pastes **only those new files**, one at a time and in order, into their SQL Editor, the same way as A2, and checks the result.
   - The database version in `database_setup.sql` (the "Database version" line near the top) tells you which files are already included. **Do not** re-run `database_setup.sql` itself.
3. **Order matters:** new database files first, then push the code.

---

### For the developer

- `database_setup.sql` is **generated**; do not edit it by hand. It is built from:
  - `supabase/clone/base_schema.sql` (the tables);
  - every file in `supabase/migrations/`, in order;
  - the realtime setup and a final check.
- Rebuild it with `npm run build:clone-sql` after adding a migration. The rehearsal test `supabase/rehearsal/tests/10_clone_setup.mjs` proves it builds a database identical to the original, and fails when the file is stale.
