// Supabase Edge Function: sheru-agent
// Secure OpenRouter Gateway with Auth verification, Secret Key hiding, and Auto-Fallback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 2. Validate Supabase Auth Token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired Supabase session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Read Body Payload
    const body = await req.json();
    const {
      model = "openai/gpt-4o-mini",
      messages = [],
      tools = [],
      tool_choice = "auto",
      temperature = 0.1,
      max_tokens = 1500,
    } = body;

    // 4. Retrieve Server-Side Secret Key
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "Server configuration required: OPENROUTER_API_KEY secret is not set in Supabase. Run: supabase secrets set OPENROUTER_API_KEY=your_key in your terminal, or add it in Supabase Dashboard -> Edge Functions -> Secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. OpenRouter Failover Queue
    const candidateModels = Array.from(
      new Set([
        model,
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
        "qwen/qwen-2.5-72b-instruct",
      ])
    );

    let lastError = "";
    let finalData = null;

    for (const candidateModel of candidateModels) {
      const payload: any = {
        model: candidateModel,
        messages,
        temperature,
        max_tokens,
      };

      if (Array.isArray(tools) && tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = tool_choice;
      }

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://vapetrax.app",
          "X-Title": "VapeTrax Sheru AI",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        finalData = await res.json();
        break;
      }

      lastError = await res.text();
      // On upstream rate-limit (429) or service outages (502, 503, 404), try next fallback model
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 404) {
        continue;
      }

      // Other fatal error (e.g. 401 invalid key)
      return new Response(
        JSON.stringify({ error: `OpenRouter error (${res.status}): ${lastError}` }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!finalData) {
      return new Response(
        JSON.stringify({ error: `OpenRouter all fallbacks failed: ${lastError}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(finalData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal Edge Function error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
