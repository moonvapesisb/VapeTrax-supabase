export type AIProvider = 'openrouter' | 'groq' | 'gemini' | 'mock';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  customEndpoint?: string;
}

export type ExtractedSaleType = 'regular' | 'refill' | 'full_bottle';
export type ExtractedPaymentMethod = 'cash' | 'online' | 'credit';
export type MatchConfidence = 'high' | 'medium' | 'low' | 'unmatched';

export interface ExtractedSaleLine {
  id: string; // Temporary unique ID for UI tracking
  rawText: string; // The original text read from the roughbook line (e.g., "10ml cubano 500")
  
  // Product matching
  matchedProductId: string | null;
  matchedProductName: string;
  category: 'device' | 'coil' | 'e-liquid' | 'accessory' | 'other';
  saleType: ExtractedSaleType;
  
  // Quantity & volume
  quantity: number;
  refillAmount?: number; // Only for e-liquid refills (in ml, e.g. 10)
  bottleSize?: number; // In ml, e.g. 30, 60, 100
  
  // Financials
  unitPrice: number;
  totalPrice: number;
  expectedCatalogPrice?: number;
  priceMismatch?: boolean; // True if written price differs noticeably from catalog
  
  // Payment & Customer
  paymentMethod: ExtractedPaymentMethod;
  matchedCustomerId?: string | null;
  customerName?: string | null; // Name written on the paper (e.g., "Ali", "Kashif")
  
  // AI Diagnostics
  confidence: MatchConfidence;
  warningNote?: string;
  isExcluded?: boolean; // User can uncheck/exclude this line from being committed
}

export interface RoughbookScanResult {
  lines: ExtractedSaleLine[];
  summary: {
    totalLines: number;
    totalAmount: number;
    cashAmount: number;
    onlineAmount: number;
    creditAmount: number;
    unmatchedCount: number;
  };
  rawModelResponse?: string;
}

export const DEFAULT_AI_CONFIGS: Record<AIProvider, { defaultModel: string; endpoint: string; defaultKey: string }> = {
  openrouter: {
    defaultModel: 'google/gemini-2.5-flash',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultKey: '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',
  },
  gemini: {
    defaultModel: 'gemini-3.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultKey: 'AQ.Ab8RN6LKjNT20NBeLguVlKX-kI2YVF606_tBFIpERXeaGqcbhQ',
  },
  groq: {
    defaultModel: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultKey: '',
  },
  mock: {
    defaultModel: 'mock-simulator',
    endpoint: 'local',
    defaultKey: '',
  },
};
