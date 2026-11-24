#!/usr/bin/env node
/**
 * Telegram Bot Setup & Webhook Linker for VapeTrax AI
 *
 * Usage:
 *   node scripts/setup-telegram.mjs <BOT_TOKEN> <WEBHOOK_URL>
 *
 * Example:
 *   node scripts/setup-telegram.mjs 123456789:ABCdefGHI https://vapetrax.online/api/telegram
 */

import readline from 'node:readline';

const args = process.argv.slice(2);
let botToken = args[0] || process.env.TELEGRAM_BOT_TOKEN;
let webhookUrl = args[1] || process.env.TELEGRAM_WEBHOOK_URL;

async function ask(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  console.log('\n=========================================');
  console.log('  ⚡ VapeTrax Telegram Bot Setup Wizard   ');
  console.log('=========================================\n');

  if (!botToken) {
    botToken = await ask('1. Enter your Telegram Bot Token (from @BotFather): ');
  }

  if (!botToken) {
    console.error('❌ Bot token is required. Exiting.');
    process.exit(1);
  }

  // 1. Verify Bot Token
  console.log('\n🔍 Verifying Bot Token with Telegram API...');
  const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const meData = await meRes.json();

  if (!meData.ok) {
    console.error('❌ Invalid Bot Token. Telegram rejected it:');
    console.error(meData);
    process.exit(1);
  }

  console.log(`✅ Connected successfully to: @${meData.result.username} (${meData.result.first_name})`);

  if (!webhookUrl) {
    console.log('\nChoose your deployment URL:');
    console.log('  - If using Vercel:    https://<your-project>.vercel.app/api/telegram');
    console.log('  - If using Supabase:  https://<your-project>.supabase.co/functions/v1/telegram-bot');
    webhookUrl = await ask('\n2. Enter your live Webhook URL: ');
  }

  if (!webhookUrl || !webhookUrl.startsWith('https://')) {
    console.error('❌ Webhook URL must begin with https://. Exiting.');
    process.exit(1);
  }

  // 2. Set Webhook
  console.log(`\n🔗 Linking Webhook URL: ${webhookUrl}...`);
  const hookRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      drop_pending_updates: true,
      allowed_updates: ['message', 'edited_message'],
    }),
  });
  const hookData = await hookRes.json();

  if (!hookData.ok) {
    console.error('❌ Failed to set webhook:', hookData);
    process.exit(1);
  }

  console.log('✅ Webhook successfully configured!');

  // 3. Register Slash Commands Autocomplete Menu
  console.log('\n📋 Registering Telegram slash commands menu (/sales, /stock, /expense)...');
  const commands = [
    { command: 'sales', description: "Today's total sales and orders breakdown" },
    { command: 'stock', description: 'Search inventory stock & prices (/stock <item>)' },
    { command: 'lowstock', description: 'List products running out (<= 5 units)' },
    { command: 'expense', description: 'Record a quick shop expense (/expense <amt> <reason>)' },
    { command: 'udhaar', description: 'List customers with pending credit balance' },
    { command: 'help', description: 'Show all commands and instructions' },
  ];

  const cmdRes = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const cmdData = await cmdRes.json();

  if (cmdData.ok) {
    console.log('✅ Slash command menu registered in Telegram!');
  } else {
    console.warn('⚠️ Could not set command menu (non-fatal):', cmdData);
  }

  // 4. Output Summary
  console.log('\n=========================================');
  console.log('  🎉 All Done! Your Bot is Active!       ');
  console.log('=========================================');
  console.log(`👉 Open Telegram and start chatting: https://t.me/${meData.result.username}`);
  console.log('\nNext steps:');
  console.log('1. Make sure TELEGRAM_BOT_TOKEN and ADMIN_TELEGRAM_ID are set in your');
  console.log('   Vercel Dashboard (Settings -> Environment Variables) or Supabase Secrets.');
  console.log('2. Send /start in Telegram to test your bot!\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
