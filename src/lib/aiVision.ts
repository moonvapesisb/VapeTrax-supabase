import {
  AIProvider,
  AIProviderConfig,
  DEFAULT_AI_CONFIGS,
  ExtractedSaleLine,
  RoughbookScanResult,
} from '../types/aiVision';

const STORAGE_KEY = 'vapetrax_ai_config';

/**
 * Retrieves the stored AI configuration or returns sensible defaults.
 */
export function getStoredAIConfig(): AIProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.provider) {
        if (parsed.provider === 'groq') {
          parsed.provider = 'openrouter';
          parsed.model = 'openrouter/free';
          parsed.apiKey = DEFAULT_AI_CONFIGS.openrouter.defaultKey;
        }
        if (parsed.provider === 'openrouter') {
          if (!parsed.model || parsed.model === 'qwen/qwen-2.5-vl-72b-instruct:free' || parsed.model === 'openrouter/free') {
            parsed.model = DEFAULT_AI_CONFIGS.openrouter.defaultModel;
          }
          if (
            !parsed.apiKey ||
            parsed.apiKey.length < 10 ||
            parsed.apiKey === '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'
          ) {
            parsed.apiKey = DEFAULT_AI_CONFIGS.openrouter.defaultKey;
          }
        }
        if (parsed.provider === 'gemini') {
          if (
            !parsed.model ||
            parsed.model === 'gemini-2.5-flash' ||
            parsed.model === 'gemini-2.0-flash' ||
            parsed.model === 'gemini-1.5-flash'
          ) {
            parsed.model = 'gemini-3.5-flash';
          }
          if (
            !parsed.apiKey ||
            parsed.apiKey.length < 10 ||
            parsed.apiKey === 'AQ.Ab8RN6JWCivtgj5vAKERCL21k3YN96nNvs26uFV93WG6MCCXnw'
          ) {
            parsed.apiKey = DEFAULT_AI_CONFIGS.gemini.defaultKey;
          }
        }
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to load AI config from storage', err);
  }

  // Fallback defaults: Google Gemini 3.5 Flash
  return {
    provider: 'gemini',
    apiKey: DEFAULT_AI_CONFIGS.gemini.defaultKey,
    model: 'gemini-3.5-flash',
  };
}

/**
 * Saves the AI configuration to localStorage.
 */
export function saveStoredAIConfig(config: AIProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save AI config', err);
  }
}

/**
 * Compresses an image client-side to ensure fast uploads, minimal token usage,
 * and compliance with free-tier payload size limits.
 */
export async function compressImage(file: File, maxWidth = 1200, quality = 0.72): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mimeType: 'image/jpeg' });
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * Calculates a simple fuzzy similarity score between two strings (0 to 1).
 */
function stringSimilarity(s1: string, s2: string): number {
  const norm1 = s1.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const norm2 = s2.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();

  if (norm1 === norm2) return 1.0;
  if (!norm1 || !norm2) return 0.0;

  const words1 = norm1.split(/\s+/);
  const words2 = new Set(norm2.split(/\s+/));

  let matchedWords = 0;
  for (const w of words1) {
    if (words2.has(w) || Array.from(words2).some((w2) => w2.includes(w) || w.includes(w2))) {
      matchedWords++;
    }
  }

  return (2 * matchedWords) / (words1.length + words2.size);
}

/**
 * Finds the closest product from the store catalog matching the raw text.
 */
export function matchCatalogProduct(
  rawText: string,
  catalog: any[],
  suggestedName?: string
): { product: any | null; confidence: 'high' | 'medium' | 'low' | 'unmatched' } {
  if (!catalog || catalog.length === 0) return { product: null, confidence: 'unmatched' };

  const searchText = `${rawText} ${suggestedName || ''}`.toLowerCase();

  let bestMatch: any = null;
  let highestScore = 0;

  for (const prod of catalog) {
    const prodName = (prod.name || '').toLowerCase();
    const prodBrand = (prod.brand || '').toLowerCase();
    const score = stringSimilarity(searchText, `${prodName} ${prodBrand}`);

    if (score > highestScore) {
      highestScore = score;
      bestMatch = prod;
    }
  }

  if (highestScore >= 0.6) {
    return { product: bestMatch, confidence: 'high' };
  } else if (highestScore >= 0.35) {
    return { product: bestMatch, confidence: 'medium' };
  } else if (highestScore > 0.15) {
    return { product: bestMatch, confidence: 'low' };
  }

  return { product: null, confidence: 'unmatched' };
}

/**
 * Finds customer by name similarity.
 */
export function matchCustomer(nameText: string, customers: any[]): any | null {
  if (!nameText || !customers || customers.length === 0) return null;
  const clean = nameText.toLowerCase().trim();

  let bestCust: any = null;
  let bestScore = 0;

  for (const cust of customers) {
    const score = stringSimilarity(clean, cust.name || '');
    if (score > bestScore) {
      bestScore = score;
      bestCust = cust;
    }
  }

  return bestScore >= 0.4 ? bestCust : null;
}

/**
 * Constructs the specialized system prompt for the Vision model.
 */
function buildExtractionPrompt(catalog: any[], customers: any[]): string {
  // Ultra-compact line-by-line format: "id | name | category | price"
  // Reduces token usage by over 75% compared to verbose JSON
  const compactCatalog = catalog
    .map((p) => `${p.id} | ${p.name} | ${p.category} | ${p.sellingPrice || 0}`)
    .join('\n');

  const compactCustomers = customers.map((c) => `${c.id} | ${c.name}`).join('\n');

  return `You are a specialist retail data extraction agent for a Vape Store in Pakistan.
The user will provide a photograph of a handwritten daily sales roughbook / register page.
The notes may be in English, Urdu, or Roman Urdu with abbreviations and vape shop slang.

Your goal is to parse EVERY distinct sale entry written on the page and match each entry to the store's product catalog and customer roster.

STORE PRODUCT CATALOG (format: id | name | category | sellingPrice):
${compactCatalog}

STORE CUSTOMER ROSTER (format: id | name):
${compactCustomers}

RECOGNITION RULES:
1. Product Types:
   - "e-liquid" / "flavor" / "juice" / "salt nic": Can be sold as:
     * "refill" (e.g., "10ml cubano", "5ml mango", "refill 15ml") -> set saleType: "refill", refillAmount: <number in ml>.
     * "full_bottle" (e.g., "1 bottle cubano", "vgod sealed", "sealed 30ml") -> set saleType: "full_bottle", refillAmount: null.
   - "coil" (e.g., "argus coil", "oxva 0.6", "caliburn pod", "caliburn g 3 cart 0.6", "cart") -> set saleType: "regular", category: "coil".
   - "device" (e.g., "drag x", "ursa nano kit", "xros 3", "g 2 mini", "air - pod") -> set saleType: "regular", category: "device".
   - disposables / accessories -> set saleType: "regular".

2. Payment & Credit (Udhaar / Khata):
   - If marked "Acc", "A/C", "Account", "online", "jazzcash", "easypaisa", "meezan", "card":
     * paymentMethod: "online"
   - If marked "udhar", "udhaar", "baki", "credit", or has a customer name without cash paid:
     * paymentMethod: "credit"
     * customerName: <extracted customer name>
     * matchedCustomerId: <matched ID from customer roster or null>
   - Default is:
     * paymentMethod: "cash"

3. Pricing & Quantity:
   - Read the price written in the note (in PKR).
   - Read the quantity (default to 1 if not explicitly written).
   - If unit price is not written, calculate unitPrice = totalPrice / quantity.

RESPONSE FORMAT:
You MUST respond with valid JSON ONLY. No markdown explanation, no backticks, no prefix.
JSON Schema:
{
  "lines": [
    {
      "rawText": "exact text from book, e.g., 10ml vgod cubano 500 cash",
      "matchedProductId": "product id from catalog or null",
      "matchedProductName": "product name from catalog",
      "category": "device" | "coil" | "e-liquid" | "accessory" | "other",
      "saleType": "regular" | "refill" | "full_bottle",
      "quantity": 1,
      "refillAmount": 10, // number in ml if refill, otherwise null
      "bottleSize": 30, // bottle size if known, else null
      "unitPrice": 500,
      "totalPrice": 500,
      "paymentMethod": "cash" | "online" | "credit",
      "customerName": "Customer name if udhar/written, else null",
      "matchedCustomerId": "customer id from roster or null",
      "confidence": "high" | "medium" | "low" | "unmatched"
    }
  ]
}`;
}

/**
 * Realistic Mock Extractor for instant testing and sandbox verification
 * without requiring an API key.
 */
export function generateMockScanResult(catalog: any[], customers: any[]): RoughbookScanResult {
  // Pick representative products from catalog or synthesize realistic ones
  const eliquid = catalog.find((p) => p.category === 'e-liquid') || {
    id: 'mock-liquid-1',
    name: 'VGod Cubano SaltNic 30ml (50mg)',
    category: 'e-liquid',
    sellingPrice: 3200,
    pricePerMl: 120,
    bottleSize: 30,
  };

  const coil = catalog.find((p) => p.category === 'coil') || {
    id: 'mock-coil-1',
    name: 'Voopoo Argus Replacement Pod 0.7Ω',
    category: 'coil',
    sellingPrice: 850,
  };

  const device = catalog.find((p) => p.category === 'device') || {
    id: 'mock-device-1',
    name: 'Uwell Caliburn G3 Pod Kit',
    category: 'device',
    sellingPrice: 7500,
  };

  const testCustomer = customers[0] || {
    id: 'mock-cust-1',
    name: 'Ali Raza',
  };

  const lines: ExtractedSaleLine[] = [
    {
      id: 'mock-line-1',
      rawText: '10ml Cubano refill - 1200 cash',
      matchedProductId: eliquid.id,
      matchedProductName: eliquid.name,
      category: 'e-liquid',
      saleType: 'refill',
      quantity: 1,
      refillAmount: 10,
      bottleSize: eliquid.bottleSize || 30,
      unitPrice: 1200,
      totalPrice: 1200,
      expectedCatalogPrice: (eliquid.pricePerMl || 120) * 10,
      priceMismatch: false,
      paymentMethod: 'cash',
      confidence: 'high',
    },
    {
      id: 'mock-line-2',
      rawText: 'Argus 0.7 pod 2pc - 1700 cash',
      matchedProductId: coil.id,
      matchedProductName: coil.name,
      category: 'coil',
      saleType: 'regular',
      quantity: 2,
      unitPrice: 850,
      totalPrice: 1700,
      expectedCatalogPrice: coil.sellingPrice || 850,
      priceMismatch: false,
      paymentMethod: 'cash',
      confidence: 'high',
    },
    {
      id: 'mock-line-3',
      rawText: 'Caliburn G3 kit - 7200 online jazzcash',
      matchedProductId: device.id,
      matchedProductName: device.name,
      category: 'device',
      saleType: 'regular',
      quantity: 1,
      unitPrice: 7200,
      totalPrice: 7200,
      expectedCatalogPrice: device.sellingPrice || 7500,
      priceMismatch: true,
      warningNote: `Written as Rs 7,200. Catalog price is Rs ${device.sellingPrice || 7500} (Discounted)`,
      paymentMethod: 'online',
      confidence: 'high',
    },
    {
      id: 'mock-line-4',
      rawText: 'Ali udhar 1 pod + 5ml cubano - 1450',
      matchedProductId: coil.id,
      matchedProductName: coil.name,
      category: 'coil',
      saleType: 'regular',
      quantity: 1,
      unitPrice: 850,
      totalPrice: 850,
      expectedCatalogPrice: coil.sellingPrice || 850,
      priceMismatch: false,
      paymentMethod: 'credit',
      customerName: testCustomer.name,
      matchedCustomerId: testCustomer.id,
      confidence: 'medium',
      warningNote: 'Check split: Salesman combined pod & 5ml on one note line',
    },
  ];

  let totalAmount = 0;
  let cashAmount = 0;
  let onlineAmount = 0;
  let creditAmount = 0;

  for (const l of lines) {
    totalAmount += l.totalPrice;
    if (l.paymentMethod === 'cash') cashAmount += l.totalPrice;
    else if (l.paymentMethod === 'online') onlineAmount += l.totalPrice;
    else if (l.paymentMethod === 'credit') creditAmount += l.totalPrice;
  }

  return {
    lines,
    summary: {
      totalLines: lines.length,
      totalAmount,
      cashAmount,
      onlineAmount,
      creditAmount,
      unmatchedCount: 0,
    },
    rawModelResponse: 'Mock simulator generated test output matching local database.',
  };
}

/**
 * Main Vision Ingestion Function.
 * Dispatches to OpenRouter, Groq, Gemini, or Mock Simulator.
 */
export async function scanRoughbookImage(
  imageFile: File,
  catalog: any[],
  customers: any[],
  configOverride?: Partial<AIProviderConfig>
): Promise<RoughbookScanResult> {
  const config: AIProviderConfig = { ...getStoredAIConfig(), ...configOverride };

  // If mock mode is explicitly chosen or if no API key is provided yet, use simulator
  if (config.provider === 'mock' || !config.apiKey?.trim()) {
    console.log('[AI Vision] Running in Mock/Simulator Mode (no API key configured).');
    await new Promise((r) => setTimeout(r, 1200)); // Simulate realistic processing delay
    return generateMockScanResult(catalog, customers);
  }

  // 1. Compress image client-side to save bandwidth & token limits
  const { base64, mimeType } = await compressImage(imageFile);
  const prompt = buildExtractionPrompt(catalog, customers);

  let rawJsonText = '';

  // 2. Dispatch to selected AI Provider
  if (config.provider === 'openrouter' || config.provider === 'groq') {
    const endpoint =
      config.provider === 'openrouter'
        ? DEFAULT_AI_CONFIGS.openrouter.endpoint
        : DEFAULT_AI_CONFIGS.groq.endpoint;

    const model = config.model || DEFAULT_AI_CONFIGS[config.provider].defaultModel;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
        ...(config.provider === 'openrouter'
          ? { 'HTTP-Referer': 'https://vapetrax.local', 'X-Title': 'VapeTrax POS' }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64}`,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        ...(config.provider === 'openrouter' ? { max_tokens: 1800 } : {}),
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Vision Error (${response.status}): ${errText}`);
    }

    const resData = await response.json();
    rawJsonText = resData.choices?.[0]?.message?.content || '{}';
  } else if (config.provider === 'gemini') {
    // Direct Google Gemini API endpoint
    let model = config.model || DEFAULT_AI_CONFIGS.gemini.defaultModel;
    if (
      !model ||
      model === 'gemini-2.5-flash' ||
      model === 'gemini-2.0-flash' ||
      model === 'gemini-1.5-flash'
    ) {
      model = 'gemini-3.5-flash';
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey.trim()}`;

    const requestPayload = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    };

    let response = await fetch(url, requestPayload);

    // Auto-retry on temporary burst rate limit (429)
    if (response.status === 429) {
      console.warn('Hit temporary 429 rate limit. Waiting 4 seconds before auto-retry...');
      await new Promise((r) => setTimeout(r, 4000));
      response = await fetch(url, requestPayload);
    }

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        throw new Error('Gemini rate limit reached (429). Please wait 30 seconds, or switch to Offline Simulator Mode.');
      }
      throw new Error(`AI Vision Error (${response.status}): ${errText}`);
    }

    const resData = await response.json();
    rawJsonText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  }

  // 3. Parse and sanitize the JSON output
  if (rawJsonText.includes('User Safety: unsafe') || rawJsonText.includes('PII/Privacy')) {
    throw new Error('OpenRouter community safety filter blocked this handwritten receipt. Please switch to Google Gemini 2.5 Flash in Engine Tuning.');
  }
  let parsed: any;
  try {
    // Strip markdown code fences if model accidentally wrapped in ```json
    const cleaned = rawJsonText.replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('JSON parsing failed. Raw response:', rawJsonText);
    throw new Error('Failed to parse AI output into structured JSON. Please try again.');
  }

  const rawLines: any[] = Array.isArray(parsed?.lines) ? parsed.lines : [];

  // 4. Enrich and double-check matches against local catalog
  const enrichedLines: ExtractedSaleLine[] = rawLines.map((line, idx) => {
    let matchedProduct = catalog.find((p) => p.id === line.matchedProductId);

    // If model didn't find an exact ID or was unsure, run client-side fuzzy match
    let confidence: 'high' | 'medium' | 'low' | 'unmatched' = line.confidence || 'medium';
    if (!matchedProduct) {
      const fuzzy = matchCatalogProduct(line.rawText || '', catalog, line.matchedProductName);
      matchedProduct = fuzzy.product;
      confidence = fuzzy.confidence;
    }

    // Expected catalog price calculation
    let expectedPrice = 0;
    if (matchedProduct) {
      if (line.saleType === 'refill') {
        const bottleSize = matchedProduct.bottleSize || 30;
        const ml = Number(line.refillAmount) || 10;
        const pricePerMl = matchedProduct.pricePerMl || (matchedProduct.sellingPrice || 0) / bottleSize;
        expectedPrice = Math.round(pricePerMl * ml * (line.quantity || 1));
      } else {
        expectedPrice = Math.round((matchedProduct.sellingPrice || 0) * (line.quantity || 1));
      }
    }

    const unitPrice = Number(line.unitPrice) || 0;
    const quantity = Number(line.quantity) || 1;
    const totalPrice = Number(line.totalPrice) || unitPrice * quantity;

    const priceMismatch = expectedPrice > 0 && Math.abs(totalPrice - expectedPrice) > 50;
    let warningNote = line.warningNote || '';
    if (priceMismatch && !warningNote) {
      warningNote = `Written as Rs ${totalPrice}, catalog expected Rs ${expectedPrice}`;
    }

    // Match customer if credit
    let matchedCust = customers.find((c) => c.id === line.matchedCustomerId);
    if (!matchedCust && line.customerName) {
      matchedCust = matchCustomer(line.customerName, customers);
    }

    return {
      id: `line-${Date.now()}-${idx}`,
      rawText: line.rawText || 'Line item',
      matchedProductId: matchedProduct ? matchedProduct.id : null,
      matchedProductName: matchedProduct ? matchedProduct.name : line.matchedProductName || 'Unmatched Item',
      category: matchedProduct ? matchedProduct.category : (line.category || 'other'),
      saleType: line.saleType || 'regular',
      quantity,
      refillAmount: line.refillAmount ? Number(line.refillAmount) : undefined,
      bottleSize: line.bottleSize ? Number(line.bottleSize) : matchedProduct?.bottleSize,
      unitPrice,
      totalPrice,
      expectedCatalogPrice: expectedPrice,
      priceMismatch,
      paymentMethod: (line.paymentMethod as any) || 'cash',
      customerName: line.customerName || (matchedCust ? matchedCust.name : null),
      matchedCustomerId: matchedCust ? matchedCust.id : null,
      confidence,
      warningNote,
    };
  });

  // Calculate summary
  let totalAmount = 0;
  let cashAmount = 0;
  let onlineAmount = 0;
  let creditAmount = 0;
  let unmatchedCount = 0;

  for (const l of enrichedLines) {
    totalAmount += l.totalPrice;
    if (l.paymentMethod === 'cash') cashAmount += l.totalPrice;
    else if (l.paymentMethod === 'online') onlineAmount += l.totalPrice;
    else if (l.paymentMethod === 'credit') creditAmount += l.totalPrice;

    if (!l.matchedProductId) unmatchedCount++;
  }

  return {
    lines: enrichedLines,
    summary: {
      totalLines: enrichedLines.length,
      totalAmount,
      cashAmount,
      onlineAmount,
      creditAmount,
      unmatchedCount,
    },
    rawModelResponse: rawJsonText,
  };
}
