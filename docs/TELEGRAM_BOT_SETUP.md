# 🚀 VapeTrax AI Telegram Bot Setup Guide

Control your entire store live directly from Telegram without paying for servers.

---

## 🛠️ Step 1: Create Your Bot on Telegram (2 Minutes)

1. Open **Telegram** on your phone or PC.
2. Search for **`@BotFather`** (the official verified bot).
3. Tap **Start** and send the command:
   ```text
   /newbot
   ```
4. It will ask for a name. Type:
   ```text
   VapeTrax Admin Bot
   ```
5. It will ask for a unique username ending in `bot`. For example:
   ```text
   vapetrax_store_bot
   ```
6. **Copy the Bot API Token** that `@BotFather` gives you. It looks like:
   ```text
   7123456789:AAFq_xxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

---

## 🔒 Step 2: Get Your Personal Telegram User ID (For Security)

To make sure only **you** can access your store data:

1. Search for **`@userinfobot`** on Telegram.
2. Tap **Start**.
3. It will reply with your profile info. Copy your numeric **`Id`** (e.g. `123456789`).

---

## ⚙️ Step 3: Add Environment Variables

### Option A: If Deploying to Vercel (Recommended & Easiest)
Go to your **Vercel Dashboard** $\rightarrow$ select your `VapeTrax-AI` project $\rightarrow$ **Settings** $\rightarrow$ **Environment Variables**:

Add these variables:
* `TELEGRAM_BOT_TOKEN`: Your token from `@BotFather`
* `ADMIN_TELEGRAM_ID`: Your numeric Telegram ID from `@userinfobot`
* `SUPABASE_URL`: `https://<your-project>.supabase.co`
* `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key (from Supabase Dashboard $\rightarrow$ Settings $\rightarrow$ API)
* `OPENROUTER_API_KEY`: *(Optional)* Your OpenRouter key to enable natural language Sheru AI banter.

Then redeploy your app on Vercel (or push your commit to GitHub).

---

### Option B: If Deploying via Supabase Edge Functions
In your terminal, run:
```bash
npx supabase secrets set TELEGRAM_BOT_TOKEN=your_token ADMIN_TELEGRAM_ID=your_id
npx supabase functions deploy telegram-bot
```

---

## 🔗 Step 4: Link Your Webhook (1 Command!)

Open your terminal in the `VapeTrax-AI` project directory and run:

```bash
npm run telegram:setup
```

It will ask you for:
1. Your **Telegram Bot Token**
2. Your **Webhook URL**:
   * If on Vercel: `https://<your-project>.vercel.app/api/telegram` (or `https://vapetrax.online/api/telegram`)
   * If on Supabase: `https://<your-project>.supabase.co/functions/v1/telegram-bot`

It will instantly link the webhook and configure your slash commands menu in Telegram!

---

## 📱 How to Use Your Bot

Open your bot on Telegram (`t.me/<your_bot_username>`) and send:

* `/start` — Shows the welcome menu and buttons
* `/sales` — Shows today's revenue, order count, and cash/card breakdown
* `/sales yesterday` — Shows yesterday's sales figures
* `/stock caliburn` — Checks stock and prices for any product
* `/lowstock` — Alerts you on products with 5 or fewer items remaining
* `/expense 500 Chai and snacks` — Records a shop expense directly into Supabase
* `/udhaar` — Lists customers with pending credit balances
* **Natural Conversation with Sheru:** Just send any message in Roman Urdu or English (*"Bhai aaj kitna maal bika?"*, *"Caliburn kitne bache hain?"*) and Sheru AI will answer using live numbers!
