// Supabase Edge Function: telegram-bot
// Private Store Operations & Sheru AI Assistant for VapeTrax via Telegram Webhook

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Helper to escape HTML characters for Telegram HTML parse_mode
function escapeHtml(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Helper to send message via Telegram Bot API
async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: any
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: any = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Telegram sendMessage error:", err);
      // Fallback without HTML formatting in case of malformed tag
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.replace(/<[^>]+>/g, "") }),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to post to Telegram:", err);
    return false;
  }
}

// Get Pakistan Standard Time (UTC+5) date bounds
function getPktDateBounds(offsetDays = 0): { startIso: string; endIso: string; label: string } {
  const now = new Date();
  const pktMs = now.getTime() + (5 * 60 + now.getTimezoneOffset()) * 60000;
  const pktDate = new Date(pktMs);
  pktDate.setDate(pktDate.getDate() + offsetDays);

  const yyyy = pktDate.getFullYear();
  const mm = String(pktDate.getMonth() + 1).padStart(2, "0");
  const dd = String(pktDate.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const startPkt = new Date(`${dateStr}T00:00:00+05:00`);
  const endPkt = new Date(`${dateStr}T23:59:59.999+05:00`);

  return {
    startIso: startPkt.toISOString(),
    endIso: endPkt.toISOString(),
    label: dateStr,
  };
}

Deno.serve(async (req) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check on GET
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        status: "ok",
        app: "VapeTrax Telegram Bot Gateway",
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN environment variable is missing.");
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const ADMIN_TELEGRAM_ID = (Deno.env.get("ADMIN_TELEGRAM_ID") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    "";
  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const update = await req.json();
    const message = update.message || update.edited_message;

    if (!message || !message.text) {
      return new Response("ok", { headers: corsHeaders });
    }

    const chatId = message.chat.id;
    const senderId = String(message.from?.id || chatId);
    const senderName = message.from?.first_name || "Ustaad";
    const text = message.text.trim();

    // 1. Security Check: Whitelist check
    if (ADMIN_TELEGRAM_ID.length > 0 && !ADMIN_TELEGRAM_ID.includes(senderId)) {
      await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        `⛔ <b>Access Denied</b>\nThis bot is private to the VapeTrax store admin.\nYour Telegram ID: <code>${senderId}</code>`
      );
      return new Response("ok", { headers: corsHeaders });
    }

    // 2. Command Handlers
    const lower = text.toLowerCase();

    // /start or /help
    if (lower === "/start" || lower === "/help") {
      const welcomeMsg =
        `🔥 <b>VapeTrax Admin Bot</b> (Sheru Inside)\n` +
        `Salam <b>${escapeHtml(senderName)}</b>! Dukan ka pura hisab yahan se live control karo:\n\n` +
        `📊 <b>Quick Commands:</b>\n` +
        `• <code>/sales</code> — Aaj ki total sales aur orders\n` +
        `• <code>/sales yesterday</code> — Kal ka hisab\n` +
        `• <code>/stock &lt;item&gt;</code> — Kisi bhi item ka stock check karo\n` +
        `• <code>/lowstock</code> — Jo cheezein khatam hone wali hain (≤ 5)\n` +
        `• <code>/expense &lt;amount&gt; &lt;reason&gt;</code> — Kharcha record karo\n` +
        `• <code>/udhaar</code> — Customers jin ki taraf payment baqi hai\n\n` +
        `💬 <b>Natural Language:</b>\n` +
        `Kuch bhi Urdu ya English mein likho (e.g. <i>"Bhai Caliburn kitne bache hain?"</i>, <i>"Today's summary"</i>) aur Sheru live jawab dega!`;

      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, welcomeMsg, {
        keyboard: [
          [{ text: "/sales" }, { text: "/lowstock" }],
          [{ text: "/udhaar" }, { text: "/help" }],
        ],
        resize_keyboard: true,
      });
      return new Response("ok", { headers: corsHeaders });
    }

    // /sales [today|yesterday]
    if (lower.startsWith("/sales")) {
      const isYesterday = lower.includes("yesterday") || lower.includes("kal");
      const { startIso, endIso, label } = getPktDateBounds(isYesterday ? -1 : 0);

      const { data: sales, error } = await supabase
        .from("sales")
        .select("id, total, paymentMethod, createdAt, items")
        .gte("createdAt", startIso)
        .lte("createdAt", endIso);

      if (error) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `⚠️ Error fetching sales: <code>${escapeHtml(error.message)}</code>`
        );
        return new Response("ok", { headers: corsHeaders });
      }

      const totalSalesCount = sales ? sales.length : 0;
      let totalRevenue = 0;
      let cashTotal = 0;
      let cardTotal = 0;
      let creditTotal = 0;

      for (const s of sales || []) {
        const val = Number(s.total) || 0;
        totalRevenue += val;
        const method = (s.paymentMethod || "").toLowerCase();
        if (method === "card" || method === "online" || method === "bank") cardTotal += val;
        else if (method === "credit" || method === "udhaar") creditTotal += val;
        else cashTotal += val;
      }

      const dateLabel = isYesterday ? "Kal (Yesterday)" : "Aaj (Today)";
      const reply =
        `💰 <b>Sales Summary — ${dateLabel} (${label})</b>\n\n` +
        `• <b>Total Revenue:</b> Rs. ${totalRevenue.toLocaleString()}\n` +
        `• <b>Orders Completed:</b> ${totalSalesCount}\n` +
        `• <b>Cash In Hand:</b> Rs. ${cashTotal.toLocaleString()}\n` +
        (cardTotal > 0 ? `• <b>Card/Bank:</b> Rs. ${cardTotal.toLocaleString()}\n` : "") +
        (creditTotal > 0 ? `• <b>Udhaar (Credit):</b> Rs. ${creditTotal.toLocaleString()}\n` : "") +
        `\n${totalSalesCount === 0 ? "<i>Abhi tak koi sale nahi hui ustaad!</i>" : "🔥 <i>Chitthi barabar, hisab clean!</i>"}`;

      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, reply);
      return new Response("ok", { headers: corsHeaders });
    }

    // /stock <search_term>
    if (lower.startsWith("/stock")) {
      const query = text.replace(/^\/stock/i, "").trim();
      if (!query) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "🔍 Please provide an item name.\nExample: <code>/stock caliburn</code> or <code>/stock pod</code>"
        );
        return new Response("ok", { headers: corsHeaders });
      }

      const { data: products, error } = await supabase
        .from("products")
        .select("id, name, category, stockQuantity, sellingPrice, bottleSize")
        .ilike("name", `%${query}%`)
        .limit(10);

      if (error) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `⚠️ Error: <code>${escapeHtml(error.message)}</code>`
        );
        return new Response("ok", { headers: corsHeaders });
      }

      if (!products || products.length === 0) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `❌ <i>Koi product nahi mila matching "${escapeHtml(query)}"</i>`
        );
        return new Response("ok", { headers: corsHeaders });
      }

      let reply = `📦 <b>Stock Results for "${escapeHtml(query)}":</b>\n\n`;
      for (const p of products) {
        const stock = Number(p.stockQuantity) || 0;
        const icon = stock <= 0 ? "🔴" : stock <= 5 ? "🟡" : "🟢";
        reply += `${icon} <b>${escapeHtml(p.name)}</b>\n`;
        reply += `   Qty: <b>${stock}</b> | Price: Rs. ${Number(p.sellingPrice || 0).toLocaleString()}\n`;
      }

      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, reply);
      return new Response("ok", { headers: corsHeaders });
    }

    // /lowstock
    if (lower === "/lowstock") {
      const { data: lowItems, error } = await supabase
        .from("products")
        .select("id, name, stockQuantity, minStockLevel, sellingPrice")
        .lte("stockQuantity", 5)
        .order("stockQuantity", { ascending: true })
        .limit(15);

      if (error) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `⚠️ Error: <code>${escapeHtml(error.message)}</code>`
        );
        return new Response("ok", { headers: corsHeaders });
      }

      if (!lowItems || lowItems.length === 0) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "🎉 <b>Stock is healthy!</b> Koi bhi product low stock (≤ 5) nahi hai."
        );
        return new Response("ok", { headers: corsHeaders });
      }

      let reply = `⚠️ <b>Low Stock Alert (≤ 5 items):</b>\n\n`;
      for (const item of lowItems) {
        const qty = Number(item.stockQuantity) || 0;
        const status = qty <= 0 ? "🚨 OUT OF STOCK" : `⚠️ ${qty} left`;
        reply += `• <b>${escapeHtml(item.name)}</b>: <b>${status}</b>\n`;
      }
      reply += `\n<i>Time to reorder maal, ustaad!</i>`;

      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, reply);
      return new Response("ok", { headers: corsHeaders });
    }

    // /expense <amount> <description>
    if (lower.startsWith("/expense")) {
      const raw = text.replace(/^\/expense/i, "").trim();
      const match = raw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);

      if (!match) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "✍️ <b>Usage:</b> <code>/expense &lt;amount&gt; &lt;details&gt;</code>\nExample: <code>/expense 500 Chai and snacks</code>"
        );
        return new Response("ok", { headers: corsHeaders });
      }

      const amount = Number(match[1]);
      const desc = match[2].trim() || "Shop Expense";

      const { error } = await supabase.from("expenses").insert([
        {
          id: `exp-${Date.now()}`,
          amount: amount,
          description: desc,
          title: desc,
          category: "General",
          createdAt: new Date().toISOString(),
        },
      ]);

      if (error) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `⚠️ Failed to record expense: <code>${escapeHtml(error.message)}</code>`
        );
      } else {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `✅ <b>Expense Recorded!</b>\nAmount: <b>Rs. ${amount.toLocaleString()}</b>\nReason: <i>${escapeHtml(
            desc
          )}</i>\nTime: ${new Date().toLocaleTimeString("en-PK", { timeZone: "Asia/Karachi" })}`
        );
      }
      return new Response("ok", { headers: corsHeaders });
    }

    // /udhaar or /customers
    if (lower === "/udhaar" || lower === "/customers" || lower === "/credit") {
      const { data: debtors, error } = await supabase
        .from("customers")
        .select("id, name, phone, creditBalance")
        .gt("creditBalance", 0)
        .order("creditBalance", { ascending: false })
        .limit(10);

      if (error) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          `⚠️ Error: <code>${escapeHtml(error.message)}</code>`
        );
        return new Response("ok", { headers: corsHeaders });
      }

      if (!debtors || debtors.length === 0) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "✨ <b>No pending credit!</b> Sab customers ka hisab cleared hai."
        );
        return new Response("ok", { headers: corsHeaders });
      }

      let totalUdhaar = 0;
      let reply = `📋 <b>Top Customer Udhaar (Credit Balances):</b>\n\n`;
      for (const c of debtors) {
        const bal = Number(c.creditBalance) || 0;
        totalUdhaar += bal;
        reply += `• <b>${escapeHtml(c.name)}</b> (${escapeHtml(c.phone || "No phone")}): <b>Rs. ${bal.toLocaleString()}</b>\n`;
      }
      reply += `\n<b>Total Outstanding Udhaar:</b> Rs. ${totalUdhaar.toLocaleString()}`;

      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, reply);
      return new Response("ok", { headers: corsHeaders });
    }

    // 3. Fallback: Natural Language AI Assistant (Sheru AI)
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        "💡 <i>Command not recognized. Type <code>/help</code> to see available commands.</i>"
      );
      return new Response("ok", { headers: corsHeaders });
    }

    // Fetch brief context for Sheru
    const { startIso } = getPktDateBounds(0);
    const [{ count: salesTodayCount }, { count: lowStockCount }] = await Promise.all([
      supabase.from("sales").select("*", { count: "exact", head: true }).gte("createdAt", startIso),
      supabase.from("products").select("*", { count: "exact", head: true }).lte("stockQuantity", 5),
    ]);

    const systemPrompt = `You are Sheru — the witty, dramatically sarcastic Pakistani vape shop partner for VapeTrax POS.
Today's Date: ${new Date().toISOString().split("T")[0]}.
Current Shop Facts:
- Sales made today: ${salesTodayCount || 0}
- Low stock items count: ${lowStockCount || 0}
Currency: PKR (Rs).
Language Rules:
- Mix of Roman Urdu and casual Pakistani English.
- Sarcastic, funny, blunt, brotherly ("Ustaad", "Bhai", "Abay", "Dukan ka hisab").
- Be concise (max 3-4 sentences because this is Telegram).
- Give accurate advice if they ask about sales, stock, or vape products.`;

    try {
      const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://vapetrax.online",
          "X-Title": "VapeTrax Telegram Sheru",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          temperature: 0.3,
          max_tokens: 400,
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const sheruReply = aiData.choices?.[0]?.message?.content || "Suno ustaad, samajh nahi aayi dobara bolo.";
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `🦁 <b>Sheru:</b>\n${escapeHtml(sheruReply)}`);
      } else {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "💡 <i>Type <code>/help</code> for available commands.</i>"
        );
      }
    } catch (e: any) {
      console.error("AI turn error:", e);
      await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        "💡 <i>Type <code>/help</code> for available commands.</i>"
      );
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (err: any) {
    console.error("Unhandled webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
