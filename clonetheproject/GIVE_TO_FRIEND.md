# Give VapeTrax to a friend (code only, never your data)

Your GitHub repo holds **your** business data (`data/business`: spreadsheet and customer names) in its history. **Never** push your repo to your friend directly. The steps below send a **clean copy**: app code only, no data, no history.

---

## 1. Your friend creates an empty GitHub repo

On **his** GitHub account:

1. Click **New repository**.
2. **Name:** `vapetrax` (or any name).
3. **Private**: yes.
4. **Do NOT** tick "Add a README", .gitignore or license. The repo must be empty.
5. In the new repo, go to **Settings → Collaborators → Add people** and add your GitHub user: **ZainMal3125**.
6. Accept the invitation email on your side.

## 2. You make the clean copy (on your PC)

Open a terminal in `D:\VapeTrax-Supabase` and run this, using **your friend's** GitHub name and email:

```bash
node scripts/make-friend-copy.mjs "Friend Name" "friend@gmail.com"
```

It creates a local branch **`share/friend`** with only the app code. It leaves out:

- `data/` (your spreadsheet and customer names)
- `supabase/scripts/`
- your database log
- your live-database snapshot

The copy is labelled with your friend's name, so **his free Vercel plan accepts it**.

## 3. You send it to his repo

Replace `FRIEND` (his GitHub username) and `REPO` (the repo name):

```bash
git push https://github.com/FRIEND/REPO.git share/friend:main
```

**Check:** open his repo on GitHub. There must be **no `data` folder**.

## 4. Your friend sets up his own Supabase and website

Follow **`clonetheproject/HOW_TO_SET_UP.md`**, parts A, C and D. In short:

1. **Supabase:** on his own Gmail, create a new project (Free, region Mumbai).
2. **Database:** in **SQL Editor → New query**, paste the **whole** file `clonetheproject/database_setup.sql` and click **Run**. The last result must say `"all_ok": true`.
3. **Login settings:** in **Authentication → Sign In / Providers → Email**, set Email **ON**, Confirm email **OFF**, and keep sign-ups **ON**.
4. **Connection values:** copy the **Project URL** and the **publishable / anon key**. Never the secret key.
5. **Website:** on **Vercel**, import his repo and add these two Environment Variables, then click **Deploy**:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the publishable or anon key
6. **Password-reset link:** in **Supabase → Authentication → URL Configuration**, set **Site URL** to his Vercel address.
7. **Admin account:** open his website and **Sign up**. The first account becomes his shop's admin.

## 5. Later updates

When VapeTrax gets new features, run the same two commands again:

```bash
node scripts/make-friend-copy.mjs "Friend Name" "friend@gmail.com"
```
```bash
git push https://github.com/FRIEND/REPO.git share/friend:main
```

If the update has new files in `supabase/migrations/` (newer than **Database version 20261012200000**), your friend runs **only those new files**, in order, in his SQL Editor, and **before** you push. He never re-runs `database_setup.sql`.
