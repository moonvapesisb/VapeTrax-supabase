export type AgentProvider = 'gemini' | 'openrouter' | 'mock';

export type ToolTier = 'read' | 'write' | 'destructive';

export type UserRoleType = 'admin' | 'cashier';

export interface AgentConfig {
  provider: AgentProvider;
  apiKey: string;
  model: string;
  autopilot: boolean;
  configVersion?: number;
}

export const DEFAULT_AGENT_MODELS: Record<AgentProvider, { label: string; defaultModel: string; defaultKey?: string }> = {
  openrouter: {
    label: 'OpenRouter (Auto-Fallback • Recommended)',
    defaultModel: 'openai/gpt-4o-mini',
    defaultKey: '',
  },
  gemini: {
    label: 'Google Gemini Direct (Tool Calling)',
    defaultModel: 'gemini-3.5-flash',
    defaultKey: 'AQ.Ab8RN6LKjNT20NBeLguVlKX-kI2YVF606_tBFIpERXeaGqcbhQ',
  },
  mock: {
    label: 'Offline Simulator (0 API Hits)',
    defaultModel: 'local-rule-engine',
  },
};

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  tier: ToolTier;
  adminOnly?: boolean;
  summarize: (args: any) => string;
}

export interface AgentToolLog {
  id: string;
  toolName: string;
  tier: ToolTier;
  summary: string;
  status: 'executed' | 'blocked' | 'error';
  detail?: string;
  durationMs?: number;
}

export type AgentVisualCard =
  | {
      type: 'sales_pulse';
      title: string;
      salesCount: number;
      totalRevenue: number;
      cashTotal: number;
      onlineTotal: number;
      creditTotal: number;
      totalProfit?: number;
      recentSales: Array<{
        id: string;
        shortId: string;
        date: string;
        totalAmount: number;
        paymentMethod: string;
        customerName: string;
        items: string[];
      }>;
    }
  | {
      type: 'stock_health';
      title: string;
      products: Array<{
        id: string;
        name: string;
        category: string;
        stockQuantity: number;
        minStockLevel: number;
        sellingPrice: number;
        bottleSize?: string | number;
        availableMl?: number;
        openBottlesCount?: number;
        closedBottlesCount?: number;
      }>;
    }
  | {
      type: 'customer_khata';
      title: string;
      totalUdhaar?: number;
      customer?: {
        id: string;
        name: string;
        phone?: string;
        creditBalance: number;
      };
      transactions?: Array<{
        id: string;
        transactionType: string;
        amount: number;
        description: string;
        date: string;
      }>;
      customers?: Array<{
        id: string;
        name: string;
        phone?: string;
        creditBalance: number;
      }>;
    }
  | {
      type: 'finance_overview';
      title: string;
      accounts: Array<{
        id: string;
        name: string;
        category?: string;
        balance: number;
      }>;
    }
  | {
      type: 'roughbook_scan';
      title: string;
      summary: {
        totalLines: number;
        totalAmount: number;
        cashAmount: number;
        onlineAmount: number;
        creditAmount: number;
        unmatchedCount: number;
      };
      lines: any[];
    }
  | {
      type: 'dead_stock_audit';
      title: string;
      lookbackDays: number;
      totalTiedUpCapital?: number;
      items: Array<{
        id: string;
        name: string;
        category: string;
        stockDisplay: string;
        sellingPrice: number;
        tiedUpCapital?: number;
        daysSinceLastSale: number | null;
        unitsSoldInPeriod: number;
        suggestedDiscountPercent: number;
        currentDiscountPercent: number;
      }>;
    }
  | {
      type: 'restock_plan';
      title: string;
      budget?: number;
      totalEstimatedCost?: number;
      whatsappOrderText: string;
      items: Array<{
        id: string;
        name: string;
        category: string;
        currentStockDisplay: string;
        soldLast30d: number;
        daysLeftEstimate: number | null;
        recommendedQty: number;
        unitLabel: string;
        unitCost?: number;
        lineCost?: number;
      }>;
    }
  | {
      type: 'udhaar_radar';
      title: string;
      daysThreshold: number;
      totalAtRisk: number;
      customers: Array<{
        id: string;
        name: string;
        phone: string;
        creditBalance: number;
        daysSinceLastActivity: number | null;
        udhaarBlocked: boolean;
        whatsappReminderUrl?: string;
        reminderText: string;
      }>;
    }
  | {
      type: 'open_bottle_risk';
      title: string;
      minDaysOpen: number;
      bottles: Array<{
        bottleId: string;
        productId: string;
        productName: string;
        remainingMl: number;
        bottleSize: number;
        daysOpen: number;
        currentDiscountPercent: number;
        priorityRefill: boolean;
      }>;
    }
  | {
      type: 'combo_deals';
      title: string;
      mode: 'suggested' | 'active';
      combos: Array<{
        id?: string;
        title: string;
        primaryProductId: string;
        primaryProductName: string;
        secondaryProductId: string;
        secondaryProductName: string;
        regularTotal: number;
        comboPrice: number;
        discountPercent: number;
      }>;
    }
  | {
      type: 'leakage_audit';
      title: string;
      lookbackDays: number;
      flags: Array<{
        id: string;
        severity: 'high' | 'medium';
        kind: string;
        title: string;
        detail: string;
        actorName: string;
        date: string;
        saleId?: string;
      }>;
    }
  | {
      type: 'day_closing_audit';
      title: string;
      date: string;
      salesCount: number;
      cashSales: number;
      onlineSales: number;
      creditSales: number;
      cashVasooli: number;
      expensesTotal: number;
      expectedCashInDrawer: number;
      zeroStockAlerts: string[];
      whatsappSummaryText: string;
      saved?: boolean;
    };

export interface PendingToolCall {
  id: string;
  toolName: string;
  args: Record<string, any>;
  summary: string;
  tier: ToolTier;
  status: 'pending' | 'executed' | 'rejected' | 'error';
  resultMessage?: string;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  imagePreviewUrl?: string;
  toolLogs?: AgentToolLog[];
  visualCards?: AgentVisualCard[];
  pendingActions?: PendingToolCall[];
  error?: string;
}
