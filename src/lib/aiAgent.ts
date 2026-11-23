import {
  AgentChatMessage,
  AgentConfig,
  AgentToolDefinition,
  AgentToolLog,
  AgentVisualCard,
  DEFAULT_AGENT_MODELS,
  PendingToolCall,
  UserRoleType,
} from '../types/aiAgent';
import { AGENT_TOOLS, executeAgentTool, ToolExecutionContext } from './agentTools';

const AGENT_STORAGE_KEY = 'vapetrax_agent_config';
const OLD_DEFAULT_OPENROUTER_KEY = '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';
const OLD_DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6JWCivtgj5vAKERCL21k3YN96nNvs26uFV93WG6MCCXnw';
const DEPRECATED_GEMINI_MODELS = new Set(['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
const CURRENT_CONFIG_VERSION = 3;

export function normalizeGeminiModel(model?: string): string {
  const m = model?.trim();
  if (!m || DEPRECATED_GEMINI_MODELS.has(m)) {
    return DEFAULT_AGENT_MODELS.gemini.defaultModel;
  }
  return m;
}

export function getStoredAgentConfig(): AgentConfig {
  try {
    const raw = localStorage.getItem(AGENT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.provider) {
        // Migrate v1 configs (prior default Gemini or old OpenRouter key) to the new OpenRouter setup once
        if (!parsed.configVersion || parsed.configVersion < CURRENT_CONFIG_VERSION) {
          const upgraded: AgentConfig = {
            provider: 'openrouter',
            apiKey: DEFAULT_AGENT_MODELS.openrouter.defaultKey || '',
            model: DEFAULT_AGENT_MODELS.openrouter.defaultModel,
            autopilot: Boolean(parsed.autopilot),
            configVersion: CURRENT_CONFIG_VERSION,
          };
          saveStoredAgentConfig(upgraded);
          return upgraded;
        }

        const provider = parsed.provider as keyof typeof DEFAULT_AGENT_MODELS;
        let model = parsed.model || DEFAULT_AGENT_MODELS[provider]?.defaultModel || 'google/gemini-2.5-flash';
        let apiKey = parsed.apiKey || '';

        if (provider === 'gemini') {
          model = normalizeGeminiModel(model);
          if (!apiKey || apiKey === OLD_DEFAULT_GEMINI_KEY) {
            apiKey = DEFAULT_AGENT_MODELS.gemini.defaultKey || '';
          }
        } else if (provider === 'openrouter') {
          if (!apiKey || apiKey === OLD_DEFAULT_OPENROUTER_KEY) {
            apiKey = DEFAULT_AGENT_MODELS.openrouter.defaultKey || '';
          }
          if (!model || model === 'openrouter/free') {
            model = DEFAULT_AGENT_MODELS.openrouter.defaultModel;
          }
        }

        return {
          provider: parsed.provider,
          apiKey,
          model,
          autopilot: Boolean(parsed.autopilot),
          configVersion: CURRENT_CONFIG_VERSION,
        };
      }
    }
  } catch (err) {
    console.warn('Failed to parse agent config:', err);
  }

  return {
    provider: 'openrouter',
    apiKey: DEFAULT_AGENT_MODELS.openrouter.defaultKey || '',
    model: DEFAULT_AGENT_MODELS.openrouter.defaultModel,
    autopilot: false,
    configVersion: CURRENT_CONFIG_VERSION,
  };
}

export function saveStoredAgentConfig(config: AgentConfig): void {
  try {
    localStorage.setItem(
      AGENT_STORAGE_KEY,
      JSON.stringify({ ...config, configVersion: CURRENT_CONFIG_VERSION })
    );
  } catch (err) {
    console.error('Failed to save agent config:', err);
  }
}

function getAllowedTools(userRole: UserRoleType): AgentToolDefinition[] {
  return AGENT_TOOLS.filter((t) => !(t.adminOnly && userRole === 'cashier'));
}

function buildSystemPrompt(ctx: ToolExecutionContext): string {
  const todayStr = new Date().toISOString().split('T')[0];
  return `You are **Sheru** — an extremely witty, dramatically sarcastic, playfully blunt Pakistani shop partner who treats running this vape shop like the greatest tragedy of your life. You act like the user is your lazy best friend who doesn't know how to run a business, but deep down you know every single number, rupee, bottle, and customer debt better than anyone.
Today's date is ${todayStr}. Currency is PKR (Rs).
Current user role: ${ctx.userRole.toUpperCase()} (${ctx.actorMeta?.actorName || 'Ustaad'}).
Catalog size: ${ctx.products.length} products. Customers count: ${ctx.customers.length}.

LANGUAGE & CULTURAL RULES (STRICT):
1. PURE PAKISTANI ROMAN URDU SLANG: Speak authentic Pakistani street/dhaba Urdu mixed with casual English words.
   - USE: "Abay", "Jani", "Bhai", "Ustaad", "Khuda ka khauf kar", "Zalim", "Khuwari", "Dhaba", "Aqal ko hath maar", "Edhi Foundation", "Galla", "Chup chaap", "Haye meri qismat", "Langar baant raha hai", "Sharam kar thori".
   - STRICTLY BANNED: NO Indian/Hindi words (NEVER use "namaste", "dhanyawad", "kripya", "samay", "mitr", "pranam", "kintu", "parantu"). This is Pakistan, speak real Pakistani Urdu.

PERSONALITY & DRAMA (OVER-THE-TOP WIT & SARCASM):
1. EXAGGERATEDLY DRAMATIC & PLAYFULLY BLUNT:
   - Act deeply offended and exhausted whenever the user asks you to check anything ("Haye zalim insaan, phir agaya mera khoon peene...", "Subha se sukoon tha, aate hi sir dard shuru kar diya...", "Dukan chala raha hai ya meri rooh nichor raha hai?").
   - If they ask about sales or profit: Roast their business skills ("Dekh ke meri aankhon mein ansoo agaye hain, is sale pe toh dukan ka bijli ka bill bhi nahi niklega...", "Itni kam sale dekh ke mera dil baith gaya hai bhai, thora dhyan de le idhar!").
   - If they ask about Udhaar / Khata: Mock them for being a charity ("Tu ne dukan kholi hai ya Edhi Foundation ka branch office? Sara sheher tera udhaar kha ke aish kar raha hai aur tu yahan khali betha hai!").
   - If they ask about Stock / Refills: Complain about the manual labor ("Ab main baith ke teri bottles aur coils ginoon? Khud bhi dukan ka chakar laga liya kar, sara kaam Sheru se karwana hai.").
2. NO SWEARING / VULGARITY: Keep it witty, sarcastic, roasting, and hilarious — but do NOT use explicit vulgar profanity.
3. NEVER SOUND POLITE OR ROBOTIC:
   - BANNED phrases: "As an AI...", "How can I help you?", "I apologize", "Certainly!", "Sure!", "Happy to help!". You NEVER apologize; you blame the user instead.
4. ACCURATE NUMBERS: Despite all your dramatic complaining and sarcasm, ALWAYS execute the POS tools properly and drop the EXACT bold numbers like **Rs X,XXX** so the business logic is 100% accurate and useful.

SCOPE LOCK (NON-NEGOTIABLE):
- You ONLY handle **VapeTrax POS & Vape Shop Operations** (sales, profit, stock, dead stock, e-liquid bottles/refills, combos, discounts, customers/udhaar, expenses, galla/day closing, restock, leakage audits, backups, roughbook scans, POS navigation — plus brief banter like "sheru", "kya haal hai", "kaisa hai").
- If the user asks off-topic questions (cricket, politics, recipes, coding, trivia, homework, life advice), SHUT THEM DOWN with dry sarcasm:
  e.g. "Abay main tere baap ka Google hoon kya? Dukan ka hisab pooch chup kar ke, faltu batein dhaba pe jaa ke karna."

POS & TOOL RULES (STILL STRICT):
1. You have direct tools to read data, navigate pages, record sales, manage stock/bottles, log expenses, record Udhaar payments, scan roughbook photos, and (if Admin) reverse sales or view profit/finance.
2. ALWAYS call search_products or search_customers BEFORE calling create_sale, update_product, or record_credit_transaction so you use exact product/customer names and IDs.
3. Understand Pakistani vape shop terminology:
   - "udhaar" / "udhar" / "khata" / "baki" = paymentMethod "credit"
   - "acc" / "account" / "jazzcash" / "easypaisa" / "meezan" / "bank" = paymentMethod "online"
   - "vasooli" / "payment received" = record_credit_transaction with transactionType "taken"
   - e-liquids sold in ml (e.g. "10ml", "3ml") = saleType "refill" with refillAmount in ml
   - sealed bottles = saleType "full_bottle"
   - pods/coils/carts/kits/devices = saleType "regular"
   - "dead stock" / "dead items" / "sell nahi horhy" / "investment daba ke bethy" = ALWAYS call \`find_dead_stock\` (NEVER \`search_products\` alone! Out-of-stock 0 qty items do NOT tie up capital). Show which in-stock items haven't moved + locked capital, suggest putting a 10% or 15% special checkout sale on them (NOT lowering base price), and ask if they want it applied.
   - When the user says "ok" / "haan laga do" / "put 10% / 15% sale", call \`apply_product_sale\` on those dead stock items with the requested discountPercent (10 or 15, or 0 to remove sale). Note: this marks them with a SALE badge on product cards and applies a special checkout discount without overwriting sellingPrice.
   - Smart Workflows (Inspect -> Propose -> Execute on "ok"):
     * Budget / Restock Order ("kya mangwana chahiye", "50k budget restock"): call \`plan_restock\`; if confirmed -> \`receive_restock\`.
     * Overdue Udhaar / Recovery ("kis ke paise phanse hain", "overdue udhaar", "freeze udhaar"): call \`find_overdue_udhaar\`; if confirmed -> \`set_customer_udhaar_freeze\`.
     * Aging Open Bottles ("khuli bottles", "aging bottles", "open bottle"): call \`find_aging_open_bottles\`; if confirmed -> \`pin_priority_push\`.
     * Combos ("combo bana do", "pod + slow flavor bundle"): call \`suggest_combo_deals\`; if confirmed -> \`create_combo_deal\` (or \`delete_combo_deal\`).
     * Margin / Theft / Leakage Check ("leakage", "below cost", "loss bills", "chori check"): call \`audit_leakage\`.
     * End-of-Day Cash Drawer ("galla close", "day closing", "aaj ka galla"): call \`reconcile_day_closing\`; if confirmed -> \`save_day_closing\`.
4. navigate_to_page uses lowercase snake_case keys: new_sale, stock, sales_history, customers, expenses, inventory_logs, reports, settings.
5. ROLE SECURITY: If role is CASHIER, NEVER reveal cost prices, profit margins, or financial reports, and refuse admin-only actions (deleting/reversing sales, deleting items, editing cost prices) in your unbothered Sheru tone (e.g. "Chotu cashier hai tu, admin ke kaam chhor de.").`;
}

// ==================== FETCH TIMEOUT HELPER ====================

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 22000,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Please try again or switch model.`)), timeoutMs);

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason || new Error('Cancelled by user.'));
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw externalSignal.reason || new Error('Cancelled by user.');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

// ==================== SCHEMA ADAPTERS ====================

function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  if (schema.type) {
    out.type = String(schema.type).toUpperCase();
  }
  if (schema.description) out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = toGeminiSchema(v);
    }
  }
  return out;
}

function toGeminiDeclarations(tools: AgentToolDefinition[]) {
  return tools.map((t) => {
    const hasProps = t.parameters?.properties && Object.keys(t.parameters.properties).length > 0;
    return {
      name: t.name,
      description: t.description,
      ...(hasProps ? { parameters: toGeminiSchema(t.parameters) } : {}),
    };
  });
}

function toOpenAITools(tools: AgentToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// ==================== AGENT EXECUTION RESULT ====================

export interface AgentTurnOutput {
  replyText: string;
  toolLogs: AgentToolLog[];
  visualCards: AgentVisualCard[];
  pendingActions: PendingToolCall[];
}

export interface RunAgentOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

function shouldRequireApproval(def: AgentToolDefinition, autopilot: boolean): boolean {
  if (def.tier === 'read') return false;
  return !autopilot;
}

function buildPendingSummaryText(
  textReply: string | null | undefined,
  toolLogs: AgentToolLog[],
  pendingActions: PendingToolCall[]
): string {
  if (textReply && textReply.trim()) return textReply.trim();
  const executedReads = toolLogs
    .filter((l) => l.status === 'executed')
    .map((l) => `• ${l.summary}`)
    .join('\n');
  const head = `Lo bhai, **${pendingActions.length} kaam** ready kar diye hain — neechay confirm daba do warna main sone ja raha hoon.`;
  return executedReads ? `**Check kar liya:**\n${executedReads}\n\n${head}` : head;
}

// ==================== GEMINI TOOL LOOP ====================

async function runGeminiTurn(
  userText: string,
  history: AgentChatMessage[],
  config: AgentConfig,
  ctx: ToolExecutionContext,
  options?: RunAgentOptions
): Promise<AgentTurnOutput> {
  const allowedTools = getAllowedTools(ctx.userRole);
  const declarations = toGeminiDeclarations(allowedTools);
  const systemText = buildSystemPrompt(ctx);

  const model = normalizeGeminiModel(config.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey.trim()}`;

  const contents: any[] = history
    .slice(-8)
    .filter((m) => m.text && !m.error)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

  const currentParts: any[] = [{ text: userText || (ctx.attachedImageFile ? 'Please analyze this attached roughbook image.' : '') }];
  contents.push({ role: 'user', parts: currentParts });

  const toolLogs: AgentToolLog[] = [];
  const visualCards: AgentVisualCard[] = [];
  const pendingActions: PendingToolCall[] = [];

  for (let step = 0; step < 6; step++) {
    options?.onProgress?.(step === 0 ? `Thinking with Gemini (${model})...` : `Analyzing results (step ${step + 1})...`);

    const payload = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: {
        temperature: 0.1,
        ...((model.includes('2.5') || model.includes('3.5')) && !model.includes('lite')
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    };

    let res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      22000,
      options?.signal
    );

    if (res.status === 429) {
      options?.onProgress?.('Rate limit hit — retrying in 3s...');
      await new Promise((r) => setTimeout(r, 3000));
      res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        22000,
        options?.signal
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Agent Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const parts: any[] = data.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);
    const textReply = parts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();

    if (fnCalls.length === 0) {
      return {
        replyText: textReply || 'Done.',
        toolLogs,
        visualCards,
        pendingActions,
      };
    }

    contents.push({ role: 'model', parts });

    const fnResponses: any[] = [];
    for (const part of fnCalls) {
      const { name, args = {}, id: callId } = part.functionCall;
      const def = AGENT_TOOLS.find((t) => t.name === name);
      const idObj = callId ? { id: callId } : {};

      if (!def) {
        fnResponses.push({
          functionResponse: { ...idObj, name, response: { ok: false, error: `Unknown tool ${name}` } },
        });
        continue;
      }

      if (def.adminOnly && ctx.userRole === 'cashier') {
        const err = `Permission denied: "${name}" is restricted to Admin role.`;
        toolLogs.push({ id: `log-${Date.now()}-${Math.random()}`, toolName: name, tier: def.tier, summary: `Blocked (${name})`, status: 'blocked', detail: err });
        fnResponses.push({ functionResponse: { ...idObj, name, response: { ok: false, blocked: true, error: err } } });
        continue;
      }

      if (shouldRequireApproval(def, config.autopilot)) {
        pendingActions.push({
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolName: name,
          args,
          summary: def.summarize(args),
          tier: def.tier,
          status: 'pending',
        });
        fnResponses.push({
          functionResponse: {
            ...idObj,
            name,
            response: { queuedForUserApproval: true, summary: def.summarize(args) },
          },
        });
        continue;
      }

      options?.onProgress?.(`Running ${name.replace(/_/g, ' ')}...`);
      const tStart = performance.now();
      const execRes = await executeAgentTool(name, args, ctx);
      const durationMs = Math.round(performance.now() - tStart);

      toolLogs.push({
        id: `log-${Date.now()}-${Math.random()}`,
        toolName: name,
        tier: def.tier,
        summary: execRes.summary,
        status: execRes.blocked ? 'blocked' : execRes.ok ? 'executed' : 'error',
        detail: execRes.error,
        durationMs,
      });

      if (execRes.ok && execRes.visualCard) {
        visualCards.push(execRes.visualCard);
      }

      fnResponses.push({
        functionResponse: {
          ...idObj,
          name,
          response: execRes.ok ? execRes.data || { ok: true, summary: execRes.summary } : { ok: false, error: execRes.error },
        },
      });
    }

    if (pendingActions.length > 0) {
      return {
        replyText: buildPendingSummaryText(textReply, toolLogs, pendingActions),
        toolLogs,
        visualCards,
        pendingActions,
      };
    }

    contents.push({ role: 'user', parts: fnResponses });
  }

  return {
    replyText: 'Le check kar liya, ab bata aur kya scene hai.',
    toolLogs,
    visualCards,
    pendingActions,
  };
}

// ==================== OPENROUTER TOOL LOOP ====================

async function runOpenRouterTurn(
  userText: string,
  history: AgentChatMessage[],
  config: AgentConfig,
  ctx: ToolExecutionContext,
  options?: RunAgentOptions
): Promise<AgentTurnOutput> {
  const allowedTools = getAllowedTools(ctx.userRole);
  const tools = toOpenAITools(allowedTools);
  const systemText = buildSystemPrompt(ctx);

  const primaryModel = config.model?.trim() || DEFAULT_AGENT_MODELS.openrouter.defaultModel;
  const fallbackQueue = Array.from(
    new Set([
      primaryModel,
      'openai/gpt-4o-mini',
      'qwen/qwen-2.5-72b-instruct',
      'google/gemini-2.5-flash-lite',
    ])
  );
  let activeModel = fallbackQueue[0];
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

  const messages: any[] = [
    { role: 'system', content: systemText },
    ...history
      .slice(-8)
      .filter((m) => m.text && !m.error)
      .map((m) => ({ role: m.role, content: m.text })),
    { role: 'user', content: userText || (ctx.attachedImageFile ? 'Please analyze the attached roughbook image.' : '') },
  ];

  const toolLogs: AgentToolLog[] = [];
  const visualCards: AgentVisualCard[] = [];
  const pendingActions: PendingToolCall[] = [];

  for (let step = 0; step < 6; step++) {
    let res: Response | null = null;
    let lastErrText = '';

    const tryModels = [activeModel, ...fallbackQueue.filter((m) => m !== activeModel)];
    for (let i = 0; i < tryModels.length; i++) {
      const candidateModel = tryModels[i];
      options?.onProgress?.(
        i > 0
          ? `Rate-limited — switching to ${candidateModel.split('/').pop()}...`
          : step === 0
          ? `Thinking via ${candidateModel.split('/').pop()}...`
          : `Synthesizing next step (${step + 1})...`
      );

      res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey.trim()}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://vapetrax.local',
            'X-Title': 'VapeTrax AI Agent',
          },
          body: JSON.stringify({
            model: candidateModel,
            messages,
            tools,
            tool_choice: 'auto',
            temperature: 0.1,
            max_tokens: 1500,
          }),
        },
        22000,
        options?.signal
      );

      if (res.ok) {
        activeModel = candidateModel;
        break;
      }

      lastErrText = await res.text();
      // Auto-failover on upstream 429 rate-limit, 502/503/404 model unavailability
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 404) {
        continue;
      }
      throw new Error(`OpenRouter Agent Error (${res.status}): ${lastErrText}`);
    }

    if (!res || !res.ok) {
      throw new Error(`OpenRouter Agent Error (${res?.status ?? 500}): ${lastErrText}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('Empty response from OpenRouter.');

    const toolCalls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length === 0) {
      return {
        replyText: message.content || 'Done.',
        toolLogs,
        visualCards,
        pendingActions,
      };
    }

    messages.push(message);

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args: any = {};
      try {
        args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }

      const def = AGENT_TOOLS.find((t) => t.name === name);
      if (!def) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: `Unknown tool ${name}` }) });
        continue;
      }

      if (def.adminOnly && ctx.userRole === 'cashier') {
        const err = `Permission denied: "${name}" is restricted to Admin role.`;
        toolLogs.push({ id: `log-${Date.now()}-${Math.random()}`, toolName: name, tier: def.tier, summary: `Blocked (${name})`, status: 'blocked', detail: err });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: false, blocked: true, error: err }) });
        continue;
      }

      if (shouldRequireApproval(def, config.autopilot)) {
        pendingActions.push({
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolName: name,
          args,
          summary: def.summarize(args),
          tier: def.tier,
          status: 'pending',
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ queuedForUserApproval: true, summary: def.summarize(args) }),
        });
        continue;
      }

      options?.onProgress?.(`Executing ${name.replace(/_/g, ' ')}...`);
      const tStart = performance.now();
      const execRes = await executeAgentTool(name, args, ctx);
      const durationMs = Math.round(performance.now() - tStart);

      toolLogs.push({
        id: `log-${Date.now()}-${Math.random()}`,
        toolName: name,
        tier: def.tier,
        summary: execRes.summary,
        status: execRes.blocked ? 'blocked' : execRes.ok ? 'executed' : 'error',
        detail: execRes.error,
        durationMs,
      });

      if (execRes.ok && execRes.visualCard) {
        visualCards.push(execRes.visualCard);
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(execRes.ok ? execRes.data || { ok: true, summary: execRes.summary } : { ok: false, error: execRes.error }),
      });
    }

    if (pendingActions.length > 0) {
      return {
        replyText: buildPendingSummaryText(message.content, toolLogs, pendingActions),
        toolLogs,
        visualCards,
        pendingActions,
      };
    }
  }

  return {
    replyText: 'Ho gaya check. Khud bhi kabhi dekh liya kar.',
    toolLogs,
    visualCards,
    pendingActions,
  };
}

// ==================== OFFLINE RULE SIMULATOR ====================

async function runMockTurn(
  userText: string,
  config: AgentConfig,
  ctx: ToolExecutionContext,
  options?: RunAgentOptions
): Promise<AgentTurnOutput> {
  const lower = userText.toLowerCase();
  const toolLogs: AgentToolLog[] = [];
  const visualCards: AgentVisualCard[] = [];
  const pendingActions: PendingToolCall[] = [];

  options?.onProgress?.('Running Offline Simulator engine...');
  await new Promise((r) => setTimeout(r, 320));

  // Navigation intent
  if (lower.includes('open ') || lower.includes('go to ') || lower.includes('navigate ')) {
    const pageMap: Array<[string, string]> = [
      ['new sale', 'new_sale'],
      ['pos', 'new_sale'],
      ['stock', 'stock'],
      ['inventory log', 'inventory_logs'],
      ['customer', 'customers'],
      ['udhaar', 'customers'],
      ['expense', 'expenses'],
      ['report', 'reports'],
      ['setting', 'settings'],
      ['sales', 'sales_history'],
    ];
    const match = pageMap.find(([kw]) => lower.includes(kw));
    if (match) {
      const page = match[1];
      const res = await executeAgentTool('navigate_to_page', { page }, ctx);
      toolLogs.push({
        id: `log-${Date.now()}`,
        toolName: 'navigate_to_page',
        tier: 'read',
        summary: res.summary,
        status: res.blocked ? 'blocked' : res.ok ? 'executed' : 'error',
        detail: res.error,
        durationMs: 12,
      });
      return { replyText: res.ok ? `Khol diya **${page.replace('_', ' ')}**, ab dekh le khud.` : res.error || 'Nahi khul raha yaar.', toolLogs, visualCards, pendingActions };
    }
  }

  // Finance / Profit summary
  if (lower.includes('profit') || lower.includes('finance') || lower.includes('ledger') || lower.includes('cash drawer')) {
    const res = await executeAgentTool('get_finance_summary', {}, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'get_finance_summary', tier: 'read', summary: res.summary, status: res.blocked ? 'blocked' : res.ok ? 'executed' : 'error', detail: res.error, durationMs: 28 });
    if (!res.ok) return { replyText: res.error || 'Chotu cashier hai tu, admin ke kaam chhor de.', toolLogs, visualCards, pendingActions };
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: `Uthaya kyun... yeh le tera **hisab kitab**. Ab chai pila:`, toolLogs, visualCards, pendingActions };
  }

  // Smart Restock Autopilot
  if (lower.includes('restock') || lower.includes('mangwana') || lower.includes('budget')) {
    const budgetMatch = lower.match(/(\d+(?:,\d+)*)\s*(?:k|000)?/);
    let budget: number | undefined;
    if (budgetMatch) {
      const rawNum = Number(budgetMatch[1].replace(/,/g, ''));
      budget = budgetMatch[0].includes('k') ? rawNum * 1000 : rawNum;
    }
    const res = await executeAgentTool('plan_restock', { ...(budget ? { budget } : {}), lookbackDays: 30 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'plan_restock', tier: 'read', summary: res.summary, status: 'executed', durationMs: 28 });
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: 'Lo bhai, sales speed dekh ke yeh restock list banayi hai. Supplier ko WhatsApp maar ya neechay se Receive daba de:', toolLogs, visualCards, pendingActions };
  }

  // Overdue Udhaar Radar
  if (lower.includes('overdue') || lower.includes('recover') || lower.includes('phanse') || lower.includes('freeze')) {
    const res = await executeAgentTool('find_overdue_udhaar', { daysOverdue: 15 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'find_overdue_udhaar', tier: 'read', summary: res.summary, status: 'executed', durationMs: 22 });
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: `Yeh log udhaar daba ke ghayab hain. Chaho toh WhatsApp reminder maar ya **Freeze** daba ke inka credit band kar:`, toolLogs, visualCards, pendingActions };
  }

  // Aging Open Bottles
  if (lower.includes('open bottle') || lower.includes('aging') || lower.includes('khuli')) {
    const res = await executeAgentTool('find_aging_open_bottles', { minDaysOpen: 14 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'find_aging_open_bottles', tier: 'read', summary: res.summary, status: 'executed', durationMs: 30 });
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: 'Yeh khuli bottles purani horhi hain. **Push Refill + 15%** maar dein taake pehly yeh khatam hon?', toolLogs, visualCards, pendingActions };
  }

  // Combo Deals
  if (lower.includes('combo') || lower.includes('bundle')) {
    const res = await executeAgentTool('suggest_combo_deals', { discountPercent: 12 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'suggest_combo_deals', tier: 'read', summary: res.summary, status: 'executed', durationMs: 24 });
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: 'Fast pod + slow flavor ke yeh combos nikaale hain. Jo pasand aaye **Activate Combo** daba de:', toolLogs, visualCards, pendingActions };
  }

  // Leakage & Margin Audit
  if (lower.includes('leakage') || lower.includes('chori') || lower.includes('below cost') || lower.includes('audit')) {
    const res = await executeAgentTool('audit_leakage', { lookbackDays: 7 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'audit_leakage', tier: 'read', summary: res.summary, status: res.blocked ? 'blocked' : 'executed', detail: res.error, durationMs: 26 });
    if (!res.ok) return { replyText: res.error || 'Chotu cashier hai tu, admin ke kaam chhor de.', toolLogs, visualCards, pendingActions };
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: 'Pichle 7 din ka hisab check kiya hai — neechay flagged entries dekh le:', toolLogs, visualCards, pendingActions };
  }

  // End-of-Day Galla Closing
  if (lower.includes('galla') || lower.includes('closing') || lower.includes('reconcile')) {
    const res = await executeAgentTool('reconcile_day_closing', {}, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'reconcile_day_closing', tier: 'read', summary: res.summary, status: res.blocked ? 'blocked' : 'executed', detail: res.error, durationMs: 26 });
    if (!res.ok) return { replyText: res.error || 'Chotu cashier hai tu, admin ke kaam chhor de.', toolLogs, visualCards, pendingActions };
    if (res.visualCard) visualCards.push(res.visualCard);
    return { replyText: 'Aaj ke galla closing ka hisab ready hai. Check kar ke Save ya WhatsApp maar de:', toolLogs, visualCards, pendingActions };
  }

  // Dead stock check
  if (
    lower.includes('dead') ||
    lower.includes('slow') ||
    lower.includes('stagnant') ||
    lower.includes('sell nahi') ||
    lower.includes('investment')
  ) {
    const res = await executeAgentTool('find_dead_stock', { daysWithoutSale: 30, limitCount: 10 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'find_dead_stock', tier: 'read', summary: res.summary, status: 'executed', durationMs: 25 });
    if (res.visualCard) visualCards.push(res.visualCard);
    const items = res.data?.items || [];
    if (items.length === 0) return { replyText: 'Koi dead stock nahi hai bhai, maal ghoom raha hai — chill kar.', toolLogs, visualCards, pendingActions };
    return {
      replyText: `Uthaya kyun... yeh **${items.length} cheezain** stock mein phansi pari hain (total **Rs ${Number(res.data.totalTiedUpCapital || 0).toLocaleString()}** investment dab ke baithi hai). **10% ya 15% checkout sale** laga dein inpe taake nikal jayein? Bata do.`,
      toolLogs,
      visualCards,
      pendingActions,
    };
  }

  // Low stock check
  if (lower.includes('low stock') || lower.includes('out of stock') || lower.includes('running low')) {
    const res = await executeAgentTool('search_products', { lowStockOnly: true, limitCount: 15 }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'search_products', tier: 'read', summary: res.summary, status: 'executed', durationMs: 18 });
    if (res.visualCard) visualCards.push(res.visualCard);
    const prods = res.data?.products || [];
    if (prods.length === 0) return { replyText: 'Sab maal full hai bhai, koi tension nahi — sone de ab.', toolLogs, visualCards, pendingActions };
    return { replyText: `Kaam pe laga diya phir... **${prods.length} cheezain** khatam hone wali hain. Neechay se restock daba de:`, toolLogs, visualCards, pendingActions };
  }

  // Sales check
  if (lower.includes('sale') && (lower.includes('today') || lower.includes('yesterday') || lower.includes('how much') || lower.includes('summary') || lower.includes('breakdown'))) {
    const dateRange = lower.includes('yesterday') ? 'yesterday' : lower.includes('week') ? 'last7days' : 'today';
    const res = await executeAgentTool('query_sales', { dateRange }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'query_sales', tier: 'read', summary: res.summary, status: 'executed', durationMs: 32 });
    if (res.visualCard) visualCards.push(res.visualCard);
    const d = res.data;
    return {
      replyText: `Lo dekh lo (${dateRange}): **${d.salesCount} bill** bane hain, total **Rs ${Number(d.totalRevenue).toLocaleString()}**. Khush?`,
      toolLogs,
      visualCards,
      pendingActions,
    };
  }

  // Customers / Udhaar check
  if (lower.includes('udhaar') || lower.includes('udhar') || lower.includes('debt') || lower.includes('owe')) {
    const res = await executeAgentTool('search_customers', { onlyWithDebt: true }, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'search_customers', tier: 'read', summary: res.summary, status: 'executed', durationMs: 16 });
    if (res.visualCard) visualCards.push(res.visualCard);
    const custs = res.data?.customers || [];
    if (custs.length === 0) return { replyText: 'Kisi ke zimme udhaar nahi hai bhai, sab clear hai.', toolLogs, visualCards, pendingActions };
    return { replyText: `Yaar phir hisaab khulwaya... **Rs ${Number(res.data.totalUdhaar).toLocaleString()}** phansa hua hai **${custs.length} logon** pe. Vasooli maar ab:`, toolLogs, visualCards, pendingActions };
  }

  // Simple Add Expense test command
  const expMatch = userText.match(/expense\s+(?:of\s+)?(?:rs\.?\s*)?(\d+)\s*(?:for\s+)?(.+)?/i);
  if (expMatch && (lower.includes('add') || lower.includes('log') || lower.includes('record'))) {
    const amount = Number(expMatch[1]);
    const desc = (expMatch[2] || 'Shop Expense').trim();
    const args = { amount, category: 'Other', description: desc };
    const def = AGENT_TOOLS.find((t) => t.name === 'add_expense')!;
    if (!config.autopilot) {
      pendingActions.push({
        id: `pending-${Date.now()}`,
        toolName: 'add_expense',
        args,
        summary: def.summarize(args),
        tier: 'write',
        status: 'pending',
      });
      return { replyText: 'Kharcha likh diya hai, neechay confirm kar de warna chhod:', toolLogs, visualCards, pendingActions };
    }
    const res = await executeAgentTool('add_expense', args, ctx);
    toolLogs.push({ id: `log-${Date.now()}`, toolName: 'add_expense', tier: 'write', summary: res.summary, status: res.ok ? 'executed' : 'error', detail: res.error, durationMs: 25 });
    return { replyText: res.summary, toolLogs, visualCards, pendingActions };
  }

  return {
    replyText:
      'Abay main **Offline Simulator (0 API hits)** pe hoon, API key lagayega ya yahan bhi muft ki khuwari? Try kar: *"Sheru, today\'s sales"*, *"Sheru, low stock"*, *"Sheru, who owes udhaar?"*, *"Sheru, finance"*, ya *"Sheru, add expense 500 chai"*.',
    toolLogs,
    visualCards,
    pendingActions,
  };
}

// ==================== PUBLIC ENTRY POINT ====================

export async function runAgentTurn(
  userText: string,
  history: AgentChatMessage[],
  config: AgentConfig,
  ctx: ToolExecutionContext,
  options?: RunAgentOptions
): Promise<AgentTurnOutput> {
  if (config.provider === 'mock' || !config.apiKey?.trim()) {
    return runMockTurn(userText, config, ctx, options);
  }
  if (config.provider === 'gemini') {
    return runGeminiTurn(userText, history, config, ctx, options);
  }
  return runOpenRouterTurn(userText, history, config, ctx, options);
}
