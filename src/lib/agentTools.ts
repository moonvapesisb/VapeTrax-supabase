import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  db,
} from './firestoreCompat';
import { AgentToolDefinition, AgentVisualCard, UserRoleType } from '../types/aiAgent';
import {
  applyRefillToBottles,
  getAvailableMl,
  orderBottlesForRefill,
  parseBottleSizeMl,
  type BottleDoc,
} from './bottles';
import { getCreditBalanceDelta } from './credits';
import { deleteSaleWithReversal } from './salesReversal';
import { getAggregatedFinancialData } from './finance-system';
import { exportBackup } from './backup';
import { scanRoughbookImage } from './aiVision';
import { getDiscountedUnitPrice, getProductDiscountPercent } from './utils';

export interface ToolExecutionContext {
  shopId: string;
  userRole: UserRoleType;
  actorMeta: any;
  products: any[];
  customers: any[];
  navigate: (path: string) => void;
  attachedImageFile?: File | null;
}

export interface ToolExecutionResult {
  ok: boolean;
  blocked?: boolean;
  data?: any;
  summary: string;
  error?: string;
  visualCard?: AgentVisualCard;
}

function toJsDate(val: any): Date {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function resolveDateRange(range?: string, startDate?: string, endDate?: string): { start: Date; end: Date } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (startDate || endDate) {
    const s = startDate ? new Date(`${startDate}T00:00:00`) : new Date(0);
    const e = endDate ? new Date(`${endDate}T23:59:59.999`) : endOfToday;
    return { start: s, end: e };
  }

  switch (range) {
    case 'yesterday': {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 1);
      const e = new Date(endOfToday);
      e.setDate(e.getDate() - 1);
      return { start: s, end: e };
    }
    case 'last7days': {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 6);
      return { start: s, end: endOfToday };
    }
    case 'thisMonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start: s, end: endOfToday };
    }
    case 'all':
      return { start: new Date(0), end: endOfToday };
    case 'today':
    default:
      return { start: startOfToday, end: endOfToday };
  }
}

function findBestMatch(items: any[], id?: string, nameQuery?: string): any | null {
  if (id) {
    const byId = items.find((i) => i.id === id);
    if (byId) return byId;
  }
  if (!nameQuery) return null;
  const q = nameQuery.toLowerCase().trim();
  const exact = items.find((i) => (i.name || '').toLowerCase().trim() === q);
  if (exact) return exact;

  const tokens = q.split(/\s+/).filter(Boolean);
  let best: any = null;
  let bestScore = 0;

  for (const item of items) {
    const name = (item.name || '').toLowerCase();
    if (name.includes(q)) return item;
    let hits = 0;
    for (const t of tokens) {
      if (name.includes(t)) hits++;
    }
    const score = tokens.length > 0 ? hits / tokens.length : 0;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

export const AGENT_TOOLS: AgentToolDefinition[] = [
  // ==================== READ TOOLS ====================
  {
    name: 'search_products',
    description:
      'Search store products by name, category, or low stock status. Always use this before creating a sale or updating a product so you have exact IDs and prices.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional product name search text (e.g., "Tokyo Strawberry", "Caliburn G3").' },
        category: { type: 'string', enum: ['all', 'e-liquid', 'device', 'coil', 'accessory'], description: 'Filter by category.' },
        lowStockOnly: { type: 'boolean', description: 'If true, only return products at or below their minimum stock threshold.' },
        limitCount: { type: 'number', description: 'Max number of results to return (default 15, max 40).' },
      },
    },
    summarize: (args) => `Search products (${args.query || args.category || (args.lowStockOnly ? 'low stock' : 'all')})`,
  },
  {
    name: 'find_dead_stock',
    description:
      'Analyze inventory + sales history to find true stagnant / dead-stock items that currently have stock > 0 (trapped capital) and have not sold in N days (default 30 days).',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        daysWithoutSale: { type: 'number', description: 'Lookback window in days (default 30).' },
        category: { type: 'string', enum: ['all', 'e-liquid', 'device', 'coil', 'accessory'], description: 'Optional category filter.' },
        limitCount: { type: 'number', description: 'Max items to return (default 10, max 25).' },
      },
    },
    summarize: (args) => `Audit dead stock (${args.daysWithoutSale || 30}d+ stagnant, in-stock only)`,
  },
  {
    name: 'plan_restock',
    description:
      'Analyze sales velocity + low stock vs an optional PKR budget and build a prioritized restock plan + WhatsApp supplier order list.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        budget: { type: 'number', description: 'Optional max PKR budget for restocking (Admin sees costs).' },
        lookbackDays: { type: 'number', description: 'Sales velocity window in days (default 30).' },
        limitCount: { type: 'number', description: 'Max products to include (default 12).' },
      },
    },
    summarize: (args) => `Build restock plan${args.budget ? ` (budget Rs ${args.budget})` : ''}`,
  },
  {
    name: 'find_overdue_udhaar',
    description:
      'Find customers with pending Udhaar whose last payment/activity was N+ days ago (default 15 days), generating WhatsApp reminder links and freeze status.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        daysOverdue: { type: 'number', description: 'Days without payment/activity threshold (default 15).' },
        minBalance: { type: 'number', description: 'Minimum Udhaar balance in PKR (default 1).' },
      },
    },
    summarize: (args) => `Scan overdue Udhaar (${args.daysOverdue || 15}d+ quiet)`,
  },
  {
    name: 'find_aging_open_bottles',
    description:
      'Inspect open e-liquid bottles that have been open for N+ days (default 14) with remaining ml at risk of losing flavor/freshness.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        minDaysOpen: { type: 'number', description: 'Days open threshold (default 14).' },
      },
    },
    summarize: (args) => `Audit aging open e-liquid bottles (${args.minDaysOpen || 14}d+ open)`,
  },
  {
    name: 'suggest_combo_deals',
    description:
      'Find slow/dead flavors in stock paired with top-selling devices/coils and propose bundle combos (10-12% off combined regular price) for NewSale 1-tap checkout.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        discountPercent: { type: 'number', description: 'Proposed combo discount % (default 12).' },
        limitCount: { type: 'number', description: 'Max combos to propose (default 4).' },
      },
    },
    summarize: () => 'Suggest dead-flavor + top-pod combo deals',
  },
  {
    name: 'audit_leakage',
    description:
      'Admin only: Audit recent sales and inventory logs for below-cost bills, heavy price drops (>20%), frequent returns, or manual stock deductions.',
    tier: 'read',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        lookbackDays: { type: 'number', description: 'Audit window in days (default 7).' },
      },
    },
    summarize: (args) => `Run margin & leakage audit (last ${args.lookbackDays || 7}d)`,
  },
  {
    name: 'reconcile_day_closing',
    description:
      'Admin only: Compute end-of-day Cash Drawer (Galla) reconciliation: Cash Sales + Cash Vasooli - Expenses = Expected Cash, Online/Udhaar totals, and zero-stock alerts.',
    tier: 'read',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Optional YYYY-MM-DD date (default today).' },
      },
    },
    summarize: (args) => `Reconcile Galla closing (${args.date || 'today'})`,
  },
  {
    name: 'get_product_bottles',
    description: 'Get individual bottle records (opened, closed, empty, remaining ml) for an e-liquid product.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID' },
        productName: { type: 'string', description: 'Product name if ID unknown' },
      },
    },
    summarize: (args) => `Inspect bottles for ${args.productName || args.productId}`,
  },
  {
    name: 'search_customers',
    description: 'Search store customers by name/phone, or list customers who owe Udhaar (credit balance > 0).',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional customer name or phone substring.' },
        onlyWithDebt: { type: 'boolean', description: 'If true, return only customers with creditBalance > 0 sorted highest first.' },
      },
    },
    summarize: (args) => `Search customers (${args.onlyWithDebt ? 'with Udhaar debt' : args.query || 'all'})`,
  },
  {
    name: 'get_customer_credit_history',
    description: 'Get credit/Udhaar payment and charge history for a specific customer.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        customerName: { type: 'string' },
      },
    },
    summarize: (args) => `Fetch credit history for ${args.customerName || args.customerId}`,
  },
  {
    name: 'query_sales',
    description: 'Query sales transactions, revenue, and net profit (for Admins) for a specific date range (today, yesterday, last7days, thisMonth), payment method, or customer.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        dateRange: { type: 'string', enum: ['today', 'yesterday', 'last7days', 'thisMonth', 'all'], description: 'Preset range (default: today).' },
        startDate: { type: 'string', description: 'Optional YYYY-MM-DD start date.' },
        endDate: { type: 'string', description: 'Optional YYYY-MM-DD end date.' },
        paymentMethod: { type: 'string', enum: ['all', 'cash', 'online', 'credit', 'split'] },
        customerName: { type: 'string', description: 'Optional customer name filter.' },
        limitCount: { type: 'number', description: 'Max sales entries to return in detail list (default 15).' },
      },
    },
    summarize: (args) => `Query sales (${args.startDate ? `${args.startDate} to ${args.endDate || 'today'}` : args.dateRange || 'today'})`,
  },
  {
    name: 'query_expenses',
    description: 'Query shop expenses for a date range or category.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        dateRange: { type: 'string', enum: ['today', 'yesterday', 'last7days', 'thisMonth', 'all'] },
        startDate: { type: 'string', description: 'Optional YYYY-MM-DD start date.' },
        endDate: { type: 'string', description: 'Optional YYYY-MM-DD end date.' },
        category: { type: 'string', description: 'Optional category filter (e.g., Rent, Utilities, Food/Tea, Salaries).' },
      },
    },
    summarize: (args) => `Query expenses (${args.dateRange || 'today'})`,
  },
  {
    name: 'get_finance_summary',
    description: 'Admin only: Get all-time overall Cash Drawer, Bank Account, Accounts Receivable (Udhaar), Total Revenue, and Total Expenses balances. (Use query_sales for today/date-range sales or profit).',
    tier: 'read',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
    summarize: () => 'Calculate overall shop financial ledger summary',
  },
  {
    name: 'get_inventory_logs',
    description: 'Fetch recent inventory audit logs (additions, deductions, sales, returns).',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        productName: { type: 'string', description: 'Optional filter by product name.' },
        limitCount: { type: 'number', description: 'Max logs to return (default 15).' },
      },
    },
    summarize: () => 'Read recent inventory logs',
  },
  {
    name: 'navigate_to_page',
    description: 'Navigate the POS interface to a specific screen.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          enum: ['new_sale', 'stock', 'sales_history', 'customers', 'expenses', 'inventory_logs', 'reports', 'settings'],
          description: 'Target screen name.',
        },
      },
      required: ['page'],
    },
    summarize: (args) => `Navigate to ${args.page}`,
  },
  {
    name: 'scan_attached_roughbook_image',
    description: 'Extract sales lines from the handwritten roughbook image currently attached in the chat.',
    tier: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    summarize: () => 'Analyze attached roughbook photo with AI Vision',
  },

  // ==================== WRITE TOOLS ====================
  {
    name: 'create_sale',
    description:
      'Record a POS sale with one or more items. Automatically handles regular piece deduction, e-liquid FIFO bottle refill ml deduction, full sealed bottles, inventory logs, and customer Udhaar credit updates.',
    tier: 'write',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'List of items sold.',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'Product ID from search_products.' },
              productName: { type: 'string', description: 'Product name (used for lookup if productId omitted).' },
              saleType: { type: 'string', enum: ['regular', 'refill', 'full_bottle'], description: 'Use refill or full_bottle for e-liquids; regular for devices/coils/accessories.' },
              quantity: { type: 'number', description: 'Quantity of units/bottles (or multiplier for refills, usually 1).' },
              refillAmount: { type: 'number', description: 'Milliliters (ml) if saleType is refill (e.g., 10).' },
              unitPrice: { type: 'number', description: 'Total price per unit (for refill, price for one refillAmount e.g. 1000 for 10ml). If omitted, uses catalog price.' },
            },
            required: ['quantity', 'saleType'],
          },
        },
        paymentMethod: { type: 'string', enum: ['cash', 'online', 'credit', 'split'] },
        customerId: { type: 'string', description: 'Customer ID (required if paymentMethod is credit or split with credit).' },
        customerName: { type: 'string', description: 'Customer name if ID unknown.' },
        splitAmounts: {
          type: 'object',
          description: 'Required only when paymentMethod is split.',
          properties: {
            cash: { type: 'number' },
            online: { type: 'number' },
            credit: { type: 'number' },
          },
        },
        saleDate: { type: 'string', description: 'Optional YYYY-MM-DD override date.' },
      },
      required: ['items', 'paymentMethod'],
    },
    summarize: (args) => {
      const itemsText = (args.items || [])
        .map((it: any) =>
          it.saleType === 'refill'
            ? `${it.refillAmount || 10}ml ${it.productName || it.productId} (x${it.quantity})`
            : `${it.quantity}x ${it.productName || it.productId}`
        )
        .join(', ');
      return `Create ${String(args.paymentMethod || 'cash').toUpperCase()} sale${args.customerName ? ` for ${args.customerName}` : ''}: ${itemsText}`;
    },
  },
  {
    name: 'add_product',
    description: 'Add a new product to store inventory. If category is e-liquid, also creates closed bottle records.',
    tier: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: ['e-liquid', 'device', 'coil', 'accessory', 'other'] },
        sellingPrice: { type: 'number' },
        costPrice: { type: 'number', description: 'Admin only: purchase cost per unit/bottle.' },
        stockQuantity: { type: 'number', description: 'For non-liquids: piece count. For e-liquids: total ml (or bottleCount * bottleSizeMl).' },
        bottleCount: { type: 'number', description: 'For e-liquids: number of closed bottles to initialize.' },
        bottleSizeMl: { type: 'number', description: 'For e-liquids: ml per bottle (e.g., 30, 60).' },
        minStockLevel: { type: 'number', description: 'Optional low stock alert threshold.' },
      },
      required: ['name', 'category', 'sellingPrice'],
    },
    summarize: (args) => `Add product "${args.name}" (${args.category}) at Rs ${args.sellingPrice}`,
  },
  {
    name: 'update_product',
    description:
      'Update an existing product (selling price, name, low stock threshold, or adjust stock quantity with stockDelta). Cost price changes require Admin.',
    tier: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        productName: { type: 'string' },
        newName: { type: 'string' },
        sellingPrice: { type: 'number' },
        costPrice: { type: 'number', description: 'Admin only.' },
        minStockLevel: { type: 'number' },
        stockDelta: { type: 'number', description: 'Positive to add stock/ml, negative to deduct stock/ml.' },
        bottlesToAdd: { type: 'number', description: 'For e-liquids: number of new full bottles to add.' },
        reason: { type: 'string', description: 'Reason for stock adjustment.' },
      },
    },
    summarize: (args) => {
      const changes: string[] = [];
      if (args.sellingPrice !== undefined) changes.push(`sellingPrice -> Rs ${args.sellingPrice}`);
      if (args.costPrice !== undefined) changes.push(`costPrice -> Rs ${args.costPrice}`);
      if (args.stockDelta !== undefined) changes.push(`stock ${args.stockDelta > 0 ? '+' : ''}${args.stockDelta}`);
      if (args.bottlesToAdd !== undefined) changes.push(`+${args.bottlesToAdd} bottles`);
      if (args.newName) changes.push(`rename -> ${args.newName}`);
      return `Update "${args.productName || args.productId}": ${changes.join(', ') || 'fields'}`;
    },
  },
  {
    name: 'apply_product_sale',
    description:
      'Admin only: Put a special checkout clearance sale discount (%) on one or more products (e.g., 10 or 15%, or 0 to remove sale) WITHOUT changing their original sellingPrice. Applied automatically at checkout and shown as a SALE badge on product cards.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'List of products to update sale status on.',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              productName: { type: 'string' },
              discountPercent: { type: 'number', description: 'e.g. 10 or 15. Pass 0 to end sale.' },
            },
            required: ['discountPercent'],
          },
        },
        discountPercent: { type: 'number', description: 'Fallback uniform discount % if productName/productId passed at top level.' },
        productName: { type: 'string' },
        productId: { type: 'string' },
      },
    },
    summarize: (args) => {
      const count = Array.isArray(args.items) && args.items.length > 0 ? args.items.length : 1;
      const pct = args.items?.[0]?.discountPercent ?? args.discountPercent ?? 10;
      return pct > 0
        ? `Apply -${pct}% checkout clearance sale on ${count} product(s) (original prices unchanged)`
        : `Remove clearance sale on ${count} product(s)`;
    },
  },
  {
    name: 'receive_restock',
    description: 'Admin only: Apply a restock order into inventory (adds pcs or new closed e-liquid bottles and logs additions).',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              productName: { type: 'string' },
              quantityToAdd: { type: 'number', description: 'Units (for device/coil) or closed bottles (for e-liquid).' },
              unitCost: { type: 'number', description: 'Optional updated purchase cost per unit/bottle.' },
            },
            required: ['quantityToAdd'],
          },
        },
        reason: { type: 'string' },
      },
      required: ['items'],
    },
    summarize: (args) => `Receive restock for ${(args.items || []).length} product(s)`,
  },
  {
    name: 'set_customer_udhaar_freeze',
    description: 'Admin only: Freeze or unfreeze Udhaar (credit checkout) for one or more overdue customers.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              customerId: { type: 'string' },
              customerName: { type: 'string' },
              blocked: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['blocked'],
          },
        },
        customerId: { type: 'string' },
        customerName: { type: 'string' },
        blocked: { type: 'boolean' },
        reason: { type: 'string' },
      },
    },
    summarize: (args) => {
      const count = Array.isArray(args.items) && args.items.length > 0 ? args.items.length : 1;
      const blocked = args.items?.[0]?.blocked ?? args.blocked ?? true;
      return `${blocked ? 'Freeze' : 'Unfreeze'} Udhaar for ${count} customer(s)`;
    },
  },
  {
    name: 'pin_priority_push',
    description:
      'Admin only: Pin "PUSH REFILL" badge on aging open-bottle e-liquids in POS NewSale cards and optionally apply a clearance discount %.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              productName: { type: 'string' },
              priorityRefill: { type: 'boolean' },
              discountPercent: { type: 'number', description: 'Optional checkout discount % (e.g. 15).' },
            },
            required: ['priorityRefill'],
          },
        },
      },
      required: ['items'],
    },
    summarize: (args) => `Update priority refill push on ${(args.items || []).length} product(s)`,
  },
  {
    name: 'create_combo_deal',
    description: 'Admin only: Publish a 1-tap combo/bundle deal in NewSale POS pairing two products at a bundle discount %.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        primaryProductId: { type: 'string' },
        primaryProductName: { type: 'string' },
        secondaryProductId: { type: 'string' },
        secondaryProductName: { type: 'string' },
        discountPercent: { type: 'number', description: 'Combo discount % (default 12).' },
      },
      required: ['primaryProductName', 'secondaryProductName'],
    },
    summarize: (args) => `Create POS combo "${args.title || `${args.primaryProductName} + ${args.secondaryProductName}`}"`,
  },
  {
    name: 'delete_combo_deal',
    description: 'Admin only: Remove an active combo deal from POS NewSale.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        comboId: { type: 'string' },
        title: { type: 'string' },
      },
    },
    summarize: (args) => `Remove combo deal "${args.title || args.comboId}"`,
  },
  {
    name: 'save_day_closing',
    description: 'Admin only: Save today (or specific date) verified cash drawer Galla closing snapshot to day_closings collection.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Optional YYYY-MM-DD (default today).' },
        notes: { type: 'string' },
      },
    },
    summarize: (args) => `Save verified Galla day closing (${args.date || 'today'})`,
  },
  {
    name: 'add_customer',
    description: 'Create a new customer profile in the Customers & Udhaar roster.',
    tier: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        creditBalance: { type: 'number', description: 'Optional opening debt balance (default 0).' },
      },
      required: ['name'],
    },
    summarize: (args) => `Add customer "${args.name}"${args.phone ? ` (${args.phone})` : ''}`,
  },
  {
    name: 'record_credit_transaction',
    description: 'Record a customer Udhaar payment received ("taken") or new credit given ("given"), updating creditBalance.',
    tier: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        customerName: { type: 'string' },
        transactionType: { type: 'string', enum: ['taken', 'given'], description: '"taken" = customer paid back debt; "given" = added debt.' },
        amount: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['transactionType', 'amount'],
    },
    summarize: (args) =>
      `${args.transactionType === 'taken' ? 'Receive payment' : 'Add credit'} Rs ${args.amount} for ${args.customerName || args.customerId}`,
  },
  {
    name: 'add_expense',
    description: 'Record a shop expense (rent, bills, tea/snacks, salaries, courier, etc.).',
    tier: 'write',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        category: { type: 'string', description: 'e.g., Rent, Utilities, Food/Tea, Salaries, Supplies, Other' },
        description: { type: 'string' },
        expenseDate: { type: 'string', description: 'Optional YYYY-MM-DD (defaults to today).' },
      },
      required: ['amount', 'category', 'description'],
    },
    summarize: (args) => `Record Rs ${args.amount} expense [${args.category}]: ${args.description}`,
  },
  {
    name: 'export_backup',
    description: 'Admin only: Download a full JSON backup of all shop collections and bottle inventories.',
    tier: 'write',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {},
    },
    summarize: () => 'Download full JSON database backup',
  },

  // ==================== DESTRUCTIVE TOOLS (ADMIN ONLY) ====================
  {
    name: 'reverse_and_delete_sale',
    description: 'Admin only: Reverse a sale (restores product stock, FIFO bottle ml, inventory return logs, and reverses Udhaar debt) and delete the sale record.',
    tier: 'destructive',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        saleId: { type: 'string', description: 'Exact sale ID (or last 6 chars shown in UI).' },
      },
      required: ['saleId'],
    },
    summarize: (args) => `REVERSE & DELETE sale #${args.saleId} (restores stock & reverses customer credit)`,
  },
  {
    name: 'delete_product',
    description: 'Admin only: Permanently delete a product and write an audit log.',
    tier: 'destructive',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        productName: { type: 'string' },
        reason: { type: 'string' },
      },
    },
    summarize: (args) => `DELETE product "${args.productName || args.productId}"`,
  },
  {
    name: 'delete_expense',
    description: 'Admin only: Delete an expense record by ID.',
    tier: 'destructive',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        expenseId: { type: 'string' },
      },
      required: ['expenseId'],
    },
    summarize: (args) => `DELETE expense #${args.expenseId}`,
  },
  {
    name: 'delete_customer',
    description: 'Admin only: Delete a customer (only allowed if creditBalance is 0).',
    tier: 'destructive',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        customerName: { type: 'string' },
      },
    },
    summarize: (args) => `DELETE customer "${args.customerName || args.customerId}"`,
  },
];

function formatPkWaUrl(phone: string | undefined, text: string): string | undefined {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return undefined;
  let normalized = digits;
  if (normalized.startsWith('0') && normalized.length >= 10) {
    normalized = `92${normalized.slice(1)}`;
  } else if (normalized.startsWith('3') && normalized.length === 10) {
    normalized = `92${normalized}`;
  }
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

async function computeDayClosingMetrics(
  shopId: string,
  targetDateStr: string | undefined,
  products: any[]
) {
  const dateStr = targetDateStr && /^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)
    ? targetDateStr
    : new Date().toISOString().split('T')[0];
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);

  const [salesSnap, creditsSnap, expSnap] = await Promise.all([
    getDocs(query(collection(db, 'sales'), where('shopId', '==', shopId))),
    getDocs(query(collection(db, 'credits'), where('shopId', '==', shopId))),
    getDocs(query(collection(db, 'expenses'), where('shopId', '==', shopId))),
  ]);

  let salesCount = 0;
  let cashSales = 0;
  let onlineSales = 0;
  let creditSales = 0;

  salesSnap.docs.forEach((docSnap) => {
    const s = docSnap.data() as any;
    const dt = toJsDate(s.saleDate || s.saleDateClient);
    if (dt < start || dt > end || s.paymentMethod === 'return') return;
    salesCount += 1;
    if (s.paymentMethod === 'cash') cashSales += Number(s.totalAmount) || 0;
    else if (s.paymentMethod === 'online') onlineSales += Number(s.totalAmount) || 0;
    else if (s.paymentMethod === 'credit') creditSales += Number(s.totalAmount) || 0;
    else if (s.paymentMethod === 'split' && s.splitAmounts) {
      cashSales += Number(s.splitAmounts.cash) || 0;
      onlineSales += Number(s.splitAmounts.online) || 0;
      creditSales += Number(s.splitAmounts.credit) || 0;
    }
  });

  let cashVasooli = 0;
  creditsSnap.docs.forEach((docSnap) => {
    const c = docSnap.data() as any;
    const dt = toJsDate(c.createdAt || c.createdAtClient);
    if (dt >= start && dt <= end && c.transactionType === 'taken') {
      cashVasooli += Number(c.amount) || 0;
    }
  });

  let expensesTotal = 0;
  expSnap.docs.forEach((docSnap) => {
    const e = docSnap.data() as any;
    const dt = toJsDate(e.expenseDate || e.createdAt || e.createdAtClient);
    if (dt >= start && dt <= end) {
      expensesTotal += Number(e.amount) || 0;
    }
  });

  const expectedCashInDrawer = Math.round(cashSales + cashVasooli - expensesTotal);
  const zeroStockAlerts = products
    .filter((p) => (Number(p.stockQuantity) || 0) <= 0)
    .map((p) => String(p.name || 'Unnamed'))
    .slice(0, 8);

  const whatsappSummaryText = [
    `*VapeTrax Galla Closing (${dateStr})*`,
    `Bills: ${salesCount}`,
    `Cash Sales: Rs ${Math.round(cashSales).toLocaleString()}`,
    `Cash Vasooli: +Rs ${Math.round(cashVasooli).toLocaleString()}`,
    `Expenses: -Rs ${Math.round(expensesTotal).toLocaleString()}`,
    `*Expected Cash in Drawer: Rs ${expectedCashInDrawer.toLocaleString()}*`,
    `Online/Bank: Rs ${Math.round(onlineSales).toLocaleString()} | Udhaar: Rs ${Math.round(creditSales).toLocaleString()}`,
    zeroStockAlerts.length > 0 ? `Out of stock: ${zeroStockAlerts.slice(0, 4).join(', ')}` : 'Stock: OK',
  ].join('\n');

  return {
    date: dateStr,
    salesCount,
    cashSales: Math.round(cashSales),
    onlineSales: Math.round(onlineSales),
    creditSales: Math.round(creditSales),
    cashVasooli: Math.round(cashVasooli),
    expensesTotal: Math.round(expensesTotal),
    expectedCashInDrawer,
    zeroStockAlerts,
    whatsappSummaryText,
  };
}

export async function executeAgentTool(
  name: string,
  args: Record<string, any>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const def = AGENT_TOOLS.find((t) => t.name === name);
  if (!def) {
    return { ok: false, summary: `Unknown tool: ${name}`, error: `Tool "${name}" does not exist.` };
  }

  // Enforce Admin role restrictions
  if (def.adminOnly && ctx.userRole === 'cashier') {
    return {
      ok: false,
      blocked: true,
      summary: `Blocked (${name}): Admin role required`,
      error: `Permission denied: "${name}" is restricted to Admin users. Cashiers cannot perform this action.`,
    };
  }

  try {
    switch (name) {
      case 'search_products': {
        const q = (args.query || '').toLowerCase().trim();
        const cat = args.category && args.category !== 'all' ? args.category : null;
        const lowOnly = Boolean(args.lowStockOnly);
        const max = Math.min(40, Math.max(1, Number(args.limitCount) || 15));

        let matches = ctx.products.filter((p) => {
          if (cat && p.category !== cat) return false;
          if (q && !(p.name || '').toLowerCase().includes(q)) return false;
          if (lowOnly) {
            const stock = Number(p.stockQuantity) || 0;
            const min = Number(p.minStockLevel ?? p.lowStockAlert ?? (p.category === 'e-liquid' ? 30 : 2));
            if (stock > min) return false;
          }
          return true;
        });

        matches = matches.slice(0, max);

        const mapped = matches.map((p) => {
          const item: any = {
            id: p.id,
            name: p.name,
            category: p.category,
            stockQuantity: Number(p.stockQuantity) || 0,
            sellingPrice: Number(p.sellingPrice) || 0,
            bottleSize: p.bottleSize || null,
            pricePerMl: p.pricePerMl || null,
            minStockLevel: p.minStockLevel ?? p.lowStockAlert ?? null,
          };
          if (ctx.userRole !== 'cashier') {
            item.costPrice = Number(p.costPrice) || 0;
          }
          return item;
        });

        return {
          ok: true,
          summary: `Found ${mapped.length} products`,
          data: { totalCatalogSize: ctx.products.length, count: mapped.length, products: mapped },
          ...(mapped.length > 0
            ? {
                visualCard: {
                  type: 'stock_health' as const,
                  title: lowOnly ? 'Low-Stock & Reorder Monitor' : q ? `Inventory Match: "${args.query}"` : 'Inventory Stock Health',
                  products: mapped.slice(0, 10).map((m) => ({
                    id: m.id,
                    name: m.name,
                    category: m.category,
                    stockQuantity: m.stockQuantity,
                    minStockLevel: Number(m.minStockLevel ?? (m.category === 'e-liquid' ? 30 : 2)),
                    sellingPrice: m.sellingPrice,
                    bottleSize: m.bottleSize,
                  })),
                },
              }
            : {}),
        };
      }

      case 'get_product_bottles': {
        const product = findBestMatch(ctx.products, args.productId, args.productName);
        if (!product) {
          return { ok: false, summary: 'Product not found', error: 'Could not find matching product.' };
        }
        const snap = await getDocs(
          query(collection(db, `products/${product.id}/bottles`), where('shopId', '==', ctx.shopId))
        );
        const bottles = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        const availableMl = getAvailableMl(bottles as any);
        const openBottlesCount = bottles.filter((b) => b.status === 'open').length;
        const closedBottlesCount = bottles.filter((b) => b.status === 'closed').length;
        return {
          ok: true,
          summary: `${bottles.length} bottles (${availableMl}ml available)`,
          data: { productId: product.id, productName: product.name, availableMl, bottles },
          visualCard: {
            type: 'stock_health',
            title: `Bottle Telemetry: ${product.name}`,
            products: [
              {
                id: product.id,
                name: product.name,
                category: product.category || 'e-liquid',
                stockQuantity: Number(product.stockQuantity) || availableMl,
                minStockLevel: Number(product.minStockLevel ?? product.lowStockAlert ?? 30),
                sellingPrice: Number(product.sellingPrice) || 0,
                bottleSize: product.bottleSize,
                availableMl,
                openBottlesCount,
                closedBottlesCount,
              },
            ],
          },
        };
      }

      case 'find_dead_stock': {
        const lookbackDays = Math.max(7, Math.min(365, Number(args.daysWithoutSale) || 30));
        const maxItems = Math.max(1, Math.min(25, Number(args.limitCount) || 10));
        const cat = (args.category || 'all').toLowerCase();
        const nowMs = Date.now();
        const cutoffMs = nowMs - lookbackDays * 86400000;

        const salesSnap = await getDocs(
          query(collection(db, 'sales'), where('shopId', '==', ctx.shopId))
        );
        const lastSoldByProduct = new Map<string, number>();
        const unitsSoldInWindow = new Map<string, number>();

        salesSnap.docs.forEach((d) => {
          const s = d.data() as any;
          if (s.paymentMethod === 'return') return;
          const sMs = toJsDate(s.saleDate || s.saleDateClient).getTime();
          const items = Array.isArray(s.items) ? s.items : [];
          for (const it of items) {
            if (!it?.productId) continue;
            const prev = lastSoldByProduct.get(it.productId) || 0;
            if (sMs > prev) lastSoldByProduct.set(it.productId, sMs);
            if (sMs >= cutoffMs) {
              unitsSoldInWindow.set(
                it.productId,
                (unitsSoldInWindow.get(it.productId) || 0) + (Number(it.quantity) || 1)
              );
            }
          }
        });

        const candidates = ctx.products
          .filter((p) => {
            const qty = Number(p.stockQuantity) || 0;
            if (qty <= 0) return false; // Dead stock must have unsold stock on hand
            if (cat !== 'all' && (p.category || '').toLowerCase() !== cat) return false;
            const lastMs = lastSoldByProduct.get(p.id) || 0;
            return lastMs < cutoffMs;
          })
          .map((p) => {
            const isLiquid = p.category === 'e-liquid';
            const bottleSizeMl = parseBottleSizeMl(p.bottleSize, 30);
            const qty = Number(p.stockQuantity) || 0;
            const cost = Number(p.costPrice) || 0;
            const tiedUpCapital = isLiquid
              ? Math.round((qty / Math.max(1, bottleSizeMl)) * cost)
              : Math.round(qty * cost);
            const lastMs = lastSoldByProduct.get(p.id) || 0;
            const daysSinceLastSale = lastMs > 0 ? Math.floor((nowMs - lastMs) / 86400000) : null;
            const suggestedDiscountPercent =
              daysSinceLastSale === null || daysSinceLastSale >= Math.max(45, lookbackDays + 15) ? 15 : 10;
            const currentDiscountPercent = getProductDiscountPercent(p);
            const stockDisplay = isLiquid
              ? `${Math.floor(qty / bottleSizeMl)} btl ${Math.round(qty % bottleSizeMl)}ml (${qty}ml)`
              : `${qty} ${p.unit || 'pcs'}`;

            return {
              id: p.id,
              name: p.name,
              category: p.category || 'device',
              stockQuantity: qty,
              stockDisplay,
              sellingPrice: Number(p.sellingPrice) || 0,
              ...(ctx.userRole === 'admin' ? { costPrice: cost, tiedUpCapital } : {}),
              daysSinceLastSale,
              unitsSoldInPeriod: unitsSoldInWindow.get(p.id) || 0,
              suggestedDiscountPercent,
              currentDiscountPercent,
            };
          })
          .sort((a, b) => {
            const capDiff = (Number((b as any).tiedUpCapital) || b.stockQuantity * b.sellingPrice) -
              (Number((a as any).tiedUpCapital) || a.stockQuantity * a.sellingPrice);
            if (capDiff !== 0) return capDiff;
            return (b.daysSinceLastSale ?? 9999) - (a.daysSinceLastSale ?? 9999);
          });

        const top = candidates.slice(0, maxItems);
        const totalTiedUpCapital =
          ctx.userRole === 'admin'
            ? top.reduce((sum, x) => sum + (Number((x as any).tiedUpCapital) || 0), 0)
            : undefined;

        return {
          ok: true,
          summary: `Found ${candidates.length} stagnant in-stock item(s) with 0 sales in last ${lookbackDays} days`,
          data: {
            lookbackDays,
            totalFound: candidates.length,
            ...(totalTiedUpCapital !== undefined ? { totalTiedUpCapital } : {}),
            items: top,
          },
          visualCard: {
            type: 'dead_stock_audit',
            title: 'Dead & Slow-Moving Stock Audit',
            lookbackDays,
            ...(totalTiedUpCapital !== undefined ? { totalTiedUpCapital } : {}),
            items: top.map((x) => ({
              id: x.id,
              name: x.name,
              category: x.category,
              stockDisplay: x.stockDisplay,
              sellingPrice: x.sellingPrice,
              ...((x as any).tiedUpCapital !== undefined ? { tiedUpCapital: (x as any).tiedUpCapital } : {}),
              daysSinceLastSale: x.daysSinceLastSale,
              unitsSoldInPeriod: x.unitsSoldInPeriod,
              suggestedDiscountPercent: x.suggestedDiscountPercent,
              currentDiscountPercent: x.currentDiscountPercent,
            })),
          },
        };
      }

      case 'plan_restock': {
        const lookbackDays = Math.max(7, Math.min(90, Number(args.lookbackDays) || 30));
        const budget = Number(args.budget) > 0 ? Number(args.budget) : undefined;
        const maxItems = Math.max(1, Math.min(20, Number(args.limitCount) || 12));
        const cutoffMs = Date.now() - lookbackDays * 86400000;

        const salesSnap = await getDocs(query(collection(db, 'sales'), where('shopId', '==', ctx.shopId)));
        const unitsSoldMap = new Map<string, number>();

        salesSnap.docs.forEach((docSnap) => {
          const s = docSnap.data() as any;
          if (s.paymentMethod === 'return') return;
          const sMs = toJsDate(s.saleDate || s.saleDateClient).getTime();
          if (sMs < cutoffMs) return;
          const items = Array.isArray(s.items) ? s.items : [];
          for (const it of items) {
            if (!it?.productId) continue;
            const amt = it.saleType === 'refill' ? Number(it.refillAmount) || 10 : Number(it.quantity) || 1;
            unitsSoldMap.set(it.productId, (unitsSoldMap.get(it.productId) || 0) + amt);
          }
        });

        const ranked = ctx.products
          .map((p) => {
            const isLiquid = p.category === 'e-liquid';
            const bottleSizeMl = parseBottleSizeMl(p.bottleSize, 30);
            const qty = Number(p.stockQuantity) || 0;
            const minLvl = Number(p.minStockLevel ?? p.lowStockAlert ?? (isLiquid ? bottleSizeMl * 2 : 3));
            const soldInWindow = unitsSoldMap.get(p.id) || 0;
            const dailyRate = soldInWindow / lookbackDays;
            const daysLeftEstimate = dailyRate > 0 ? Math.max(0, Math.round(qty / dailyRate)) : null;

            const needsRestock = qty <= minLvl || (daysLeftEstimate !== null && daysLeftEstimate <= 14);
            if (!needsRestock) return null;

            let recommendedQty = 0;
            if (isLiquid) {
              const targetMl = Math.max(bottleSizeMl * 3, Math.ceil(dailyRate * 21));
              recommendedQty = Math.max(1, Math.ceil(Math.max(bottleSizeMl, targetMl - qty) / bottleSizeMl));
            } else {
              const targetUnits = Math.max(minLvl * 2, Math.ceil(dailyRate * 21), 4);
              recommendedQty = Math.max(1, targetUnits - qty);
            }

            const unitCost = Math.max(0, Number(p.costPrice) || 0);
            const priorityScore = (daysLeftEstimate !== null ? Math.max(0, 30 - daysLeftEstimate) * 3 : 0) + (qty <= 0 ? 100 : 25) + soldInWindow;

            return {
              product: p,
              isLiquid,
              bottleSizeMl,
              qty,
              soldLast30d: Math.round(soldInWindow),
              daysLeftEstimate,
              recommendedQty,
              unitCost,
              priorityScore,
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.priorityScore - a.priorityScore) as any[];

        const chosen: any[] = [];
        let runningCost = 0;

        for (const r of ranked) {
          if (chosen.length >= maxItems) break;
          let recQty = r.recommendedQty;
          if (budget && r.unitCost > 0) {
            const remaining = budget - runningCost;
            if (remaining < r.unitCost) continue;
            const maxAffordable = Math.floor(remaining / r.unitCost);
            recQty = Math.min(recQty, maxAffordable);
            if (recQty <= 0) continue;
          }
          const lineCost = recQty * r.unitCost;
          runningCost += lineCost;
          chosen.push({
            id: r.product.id,
            name: r.product.name,
            category: r.product.category || 'device',
            currentStockDisplay: r.isLiquid ? `${Math.round(r.qty)}ml` : `${r.qty} ${r.product.unit || 'pcs'}`,
            soldLast30d: r.soldLast30d,
            daysLeftEstimate: r.daysLeftEstimate,
            recommendedQty: recQty,
            unitLabel: r.isLiquid ? 'bottles' : 'pcs',
            ...(ctx.userRole === 'admin' ? { unitCost: r.unitCost, lineCost: Math.round(lineCost) } : {}),
          });
        }

        const whatsappOrderText = [
          '*VapeTrax Restock Order*',
          ...chosen.map((c, idx) => `${idx + 1}. ${c.name} — ${c.recommendedQty} ${c.unitLabel}`),
        ].join('\n');

        return {
          ok: true,
          summary: `Prepared restock plan for ${chosen.length} item(s)`,
          data: {
            budget,
            ...(ctx.userRole === 'admin' ? { totalEstimatedCost: Math.round(runningCost) } : {}),
            items: chosen,
            whatsappOrderText,
          },
          visualCard: {
            type: 'restock_plan',
            title: budget ? `Restock Plan (Budget Rs ${budget.toLocaleString()})` : 'Smart Restock Autopilot',
            budget,
            ...(ctx.userRole === 'admin' ? { totalEstimatedCost: Math.round(runningCost) } : {}),
            whatsappOrderText,
            items: chosen,
          },
        };
      }

      case 'find_overdue_udhaar': {
        const daysThreshold = Math.max(1, Number(args.daysOverdue) || 15);
        const minBalance = Math.max(1, Number(args.minBalance) || 1);
        const nowMs = Date.now();
        const cutoffMs = nowMs - daysThreshold * 86400000;

        const [creditsSnap, salesSnap] = await Promise.all([
          getDocs(query(collection(db, 'credits'), where('shopId', '==', ctx.shopId))),
          getDocs(query(collection(db, 'sales'), where('shopId', '==', ctx.shopId))),
        ]);

        const lastActivityMap = new Map<string, number>();
        creditsSnap.docs.forEach((docSnap) => {
          const c = docSnap.data() as any;
          if (!c.customerId || c.transactionType !== 'taken') return;
          const ms = toJsDate(c.createdAt || c.createdAtClient).getTime();
          if (ms > (lastActivityMap.get(c.customerId) || 0)) lastActivityMap.set(c.customerId, ms);
        });
        salesSnap.docs.forEach((docSnap) => {
          const s = docSnap.data() as any;
          if (!s.customerId) return;
          const ms = toJsDate(s.saleDate || s.saleDateClient).getTime();
          if (ms > (lastActivityMap.get(s.customerId) || 0)) lastActivityMap.set(s.customerId, ms);
        });

        const overdue = ctx.customers
          .filter((c) => {
            const bal = Number(c.creditBalance) || 0;
            if (bal < minBalance) return false;
            const lastMs = lastActivityMap.get(c.id) || 0;
            return lastMs < cutoffMs;
          })
          .map((c) => {
            const bal = Number(c.creditBalance) || 0;
            const lastMs = lastActivityMap.get(c.id) || 0;
            const daysSinceLastActivity = lastMs > 0 ? Math.floor((nowMs - lastMs) / 86400000) : null;
            const reminderText = `Assalam o Alaikum ${c.name} bhai, VapeTrax ki taraf se reminder hai ke aap ka Rs ${bal.toLocaleString()} udhaar pending hai. Meharbani kar ke clear kar dein, shukriya.`;
            return {
              id: c.id,
              name: c.name,
              phone: c.phone || '',
              creditBalance: bal,
              daysSinceLastActivity,
              udhaarBlocked: Boolean(c.udhaarBlocked),
              whatsappReminderUrl: formatPkWaUrl(c.phone, reminderText),
              reminderText,
            };
          })
          .sort((a, b) => b.creditBalance - a.creditBalance);

        const totalAtRisk = overdue.reduce((acc, c) => acc + c.creditBalance, 0);
        return {
          ok: true,
          summary: `Found ${overdue.length} overdue Udhaar customer(s) (${daysThreshold}d+ quiet)`,
          data: { daysThreshold, totalAtRisk, customers: overdue },
          visualCard: {
            type: 'udhaar_radar',
            title: 'Udhaar Recovery Radar',
            daysThreshold,
            totalAtRisk,
            customers: overdue.slice(0, 15),
          },
        };
      }

      case 'find_aging_open_bottles': {
        const minDaysOpen = Math.max(1, Number(args.minDaysOpen) || 14);
        const nowMs = Date.now();
        const liquids = ctx.products.filter((p) => p.category === 'e-liquid' && (Number(p.stockQuantity) || 0) > 0);
        const allOpen: any[] = [];

        await Promise.all(
          liquids.map(async (p) => {
            const snap = await getDocs(
              query(collection(db, `products/${p.id}/bottles`), where('shopId', '==', ctx.shopId))
            );
            const bottleSize = parseBottleSizeMl(p.bottleSize, 30);
            snap.docs.forEach((bDoc) => {
              const b = bDoc.data() as any;
              if (b.status !== 'open' || (Number(b.remainingMl) || 0) <= 0) return;
              const openedMs = toJsDate(b.openedDate || b.createdAt).getTime();
              const daysOpen = Math.max(0, Math.floor((nowMs - openedMs) / 86400000));
              if (daysOpen >= minDaysOpen) {
                allOpen.push({
                  bottleId: bDoc.id,
                  productId: p.id,
                  productName: p.name,
                  remainingMl: Math.round((Number(b.remainingMl) || 0) * 10) / 10,
                  bottleSize: Number(b.bottleSize) || bottleSize,
                  daysOpen,
                  currentDiscountPercent: getProductDiscountPercent(p),
                  priorityRefill: Boolean(p.priorityRefill),
                });
              }
            });
          })
        );

        allOpen.sort((a, b) => b.daysOpen - a.daysOpen);
        const top = allOpen.slice(0, 15);
        return {
          ok: true,
          summary: `Found ${allOpen.length} aging open e-liquid bottle(s) (${minDaysOpen}d+ open)`,
          data: { minDaysOpen, count: allOpen.length, bottles: top },
          visualCard: {
            type: 'open_bottle_risk',
            title: 'Aging Open Bottle Rescue',
            minDaysOpen,
            bottles: top,
          },
        };
      }

      case 'suggest_combo_deals': {
        const discountPercent = Math.min(40, Math.max(5, Number(args.discountPercent) || 12));
        const maxCombos = Math.max(1, Math.min(6, Number(args.limitCount) || 4));
        const cutoffMs = Date.now() - 30 * 86400000;

        const salesSnap = await getDocs(query(collection(db, 'sales'), where('shopId', '==', ctx.shopId)));
        const soldCount = new Map<string, number>();
        const lastSoldMs = new Map<string, number>();

        salesSnap.docs.forEach((docSnap) => {
          const s = docSnap.data() as any;
          if (s.paymentMethod === 'return') return;
          const sMs = toJsDate(s.saleDate || s.saleDateClient).getTime();
          for (const it of Array.isArray(s.items) ? s.items : []) {
            if (!it?.productId) continue;
            if (sMs >= cutoffMs) soldCount.set(it.productId, (soldCount.get(it.productId) || 0) + (Number(it.quantity) || 1));
            if (sMs > (lastSoldMs.get(it.productId) || 0)) lastSoldMs.set(it.productId, sMs);
          }
        });

        const fastDevices = ctx.products
          .filter((p) => (p.category === 'device' || p.category === 'coil') && (Number(p.stockQuantity) || 0) > 0)
          .sort((a, b) => (soldCount.get(b.id) || 0) - (soldCount.get(a.id) || 0));

        const slowLiquids = ctx.products
          .filter((p) => p.category === 'e-liquid' && (Number(p.stockQuantity) || 0) >= parseBottleSizeMl(p.bottleSize, 30))
          .sort((a, b) => (soldCount.get(a.id) || 0) - (soldCount.get(b.id) || 0));

        const combos = [];
        for (let i = 0; i < Math.min(maxCombos, fastDevices.length, slowLiquids.length); i++) {
          const dev = fastDevices[i];
          const liq = slowLiquids[i];
          const regularTotal = Math.round((Number(dev.sellingPrice) || 0) + (Number(liq.sellingPrice) || 0));
          const comboPrice = getDiscountedUnitPrice(regularTotal, discountPercent);
          combos.push({
            title: `${dev.name} + ${liq.name} Combo`,
            primaryProductId: dev.id,
            primaryProductName: dev.name,
            secondaryProductId: liq.id,
            secondaryProductName: liq.name,
            regularTotal,
            comboPrice,
            discountPercent,
          });
        }

        return {
          ok: true,
          summary: `Generated ${combos.length} pod + slow-flavor combo deal(s)`,
          data: { combos },
          visualCard: {
            type: 'combo_deals',
            title: 'Suggested Smart Combo Deals',
            mode: 'suggested',
            combos,
          },
        };
      }

      case 'audit_leakage': {
        const lookbackDays = Math.max(1, Math.min(60, Number(args.lookbackDays) || 7));
        const cutoffMs = Date.now() - lookbackDays * 86400000;
        const [salesSnap, logsSnap] = await Promise.all([
          getDocs(query(collection(db, 'sales'), where('shopId', '==', ctx.shopId))),
          getDocs(query(collection(db, 'inventoryLogs'), where('shopId', '==', ctx.shopId))),
        ]);

        const flags: any[] = [];

        salesSnap.docs.forEach((docSnap) => {
          const s = docSnap.data() as any;
          const dt = toJsDate(s.saleDate || s.saleDateClient);
          if (dt.getTime() < cutoffMs) return;
          const dateLabel = dt.toLocaleDateString();
          const actorName = s.actorName || s.cashierName || 'Staff';

          if (s.paymentMethod === 'return') {
            flags.push({
              id: `ret-${docSnap.id}`,
              severity: 'medium' as const,
              kind: 'return',
              title: `Return / Refund Bill #${docSnap.id.slice(-5).toUpperCase()}`,
              detail: `Refunded Rs ${Number(s.totalAmount || 0).toLocaleString()}`,
              actorName,
              date: dateLabel,
              saleId: docSnap.id,
            });
            return;
          }

          if (Number(s.totalProfit) < 0) {
            flags.push({
              id: `loss-${docSnap.id}`,
              severity: 'high' as const,
              kind: 'below_cost',
              title: `Below-Cost Sale #${docSnap.id.slice(-5).toUpperCase()}`,
              detail: `Bill Rs ${Number(s.totalAmount || 0).toLocaleString()} lost Rs ${Math.abs(Math.round(Number(s.totalProfit) || 0)).toLocaleString()} vs cost`,
              actorName,
              date: dateLabel,
              saleId: docSnap.id,
            });
          }

          for (const it of Array.isArray(s.items) ? s.items : []) {
            if ((Number(it.totalPrice) || 0) < (Number(it.totalCost) || 0)) {
              flags.push({
                id: `itemloss-${docSnap.id}-${it.productId}`,
                severity: 'high' as const,
                kind: 'item_loss',
                title: `Item Sold Under Cost: ${it.productName}`,
                detail: `Sold Rs ${it.totalPrice} (Cost Rs ${Math.round(it.totalCost)})`,
                actorName,
                date: dateLabel,
                saleId: docSnap.id,
              });
            }
          }
        });

        logsSnap.docs.forEach((docSnap) => {
          const l = docSnap.data() as any;
          const dt = toJsDate(l.createdAt || l.createdAtClient);
          if (dt.getTime() < cutoffMs) return;
          if (l.action === 'deduction' || l.action === 'deletion' || l.action === 'sale_reversal') {
            flags.push({
              id: `log-${docSnap.id}`,
              severity: l.action === 'sale_reversal' ? ('high' as const) : ('medium' as const),
              kind: l.action,
              title: `Manual ${String(l.action).replace('_', ' ')}: ${l.productName || 'Item'}`,
              detail: `${l.change || l.mlChange || 0} change • ${l.reason || 'No reason noted'}`,
              actorName: l.actorName || 'Staff',
              date: dt.toLocaleDateString(),
            });
          }
        });

        flags.sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1));
        return {
          ok: true,
          summary: `Leakage audit checked last ${lookbackDays}d (${flags.length} flag(s))`,
          data: { lookbackDays, count: flags.length, flags: flags.slice(0, 20) },
          visualCard: {
            type: 'leakage_audit',
            title: 'Margin & Leakage Audit',
            lookbackDays,
            flags: flags.slice(0, 15),
          },
        };
      }

      case 'reconcile_day_closing': {
        const closing = await computeDayClosingMetrics(ctx.shopId, args.date, ctx.products);
        return {
          ok: true,
          summary: `Galla (${closing.date}): Expected Cash Rs ${closing.expectedCashInDrawer.toLocaleString()}`,
          data: closing,
          visualCard: {
            type: 'day_closing_audit',
            title: 'End-of-Day Cash Drawer (Galla)',
            ...closing,
            saved: false,
          },
        };
      }

      case 'search_customers': {
        const q = (args.query || '').toLowerCase().trim();
        const onlyDebt = Boolean(args.onlyWithDebt);
        let list = ctx.customers.filter((c) => {
          if (onlyDebt && (Number(c.creditBalance) || 0) <= 0) return false;
          if (q) {
            const n = (c.name || '').toLowerCase();
            const ph = (c.phone || '').toLowerCase();
            if (!n.includes(q) && !ph.includes(q)) return false;
          }
          return true;
        });
        if (onlyDebt) {
          list = [...list].sort((a, b) => (Number(b.creditBalance) || 0) - (Number(a.creditBalance) || 0));
        }
        const totalUdhaar = list.reduce((acc, c) => acc + (Number(c.creditBalance) || 0), 0);
        const topCusts = list.slice(0, 25).map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone || '',
          creditBalance: Number(c.creditBalance) || 0,
        }));
        return {
          ok: true,
          summary: `Found ${list.length} customers`,
          data: {
            count: list.length,
            totalUdhaar,
            customers: topCusts,
          },
          ...(topCusts.length > 0 && (onlyDebt || topCusts.length <= 8)
            ? {
                visualCard: {
                  type: 'customer_khata' as const,
                  title: onlyDebt ? 'Outstanding Udhaar Ledger' : q ? `Customer Match: "${args.query}"` : 'Customer Khata Summary',
                  totalUdhaar,
                  customers: topCusts.slice(0, 8),
                },
              }
            : {}),
        };
      }

      case 'get_customer_credit_history': {
        const cust = findBestMatch(ctx.customers, args.customerId, args.customerName);
        if (!cust) return { ok: false, summary: 'Customer not found', error: 'No matching customer found.' };
        const snap = await getDocs(
          query(collection(db, 'credits'), where('shopId', '==', ctx.shopId), where('customerId', '==', cust.id))
        );
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => toJsDate(b.createdAt || b.createdAtClient).getTime() - toJsDate(a.createdAt || a.createdAtClient).getTime())
          .slice(0, 20)
          .map((r: any) => ({
            id: r.id,
            transactionType: r.transactionType,
            amount: r.amount,
            description: r.description || '',
            date: toJsDate(r.createdAt || r.createdAtClient).toISOString().split('T')[0],
          }));
        const custPayload = { id: cust.id, name: cust.name, phone: cust.phone || '', creditBalance: Number(cust.creditBalance) || 0 };
        return {
          ok: true,
          summary: `${rows.length} credit records for ${cust.name}`,
          data: { customer: custPayload, transactions: rows },
          visualCard: {
            type: 'customer_khata',
            title: `Khata Profile: ${cust.name}`,
            customer: custPayload,
            transactions: rows.slice(0, 6),
          },
        };
      }

      case 'query_sales': {
        const { start, end } = resolveDateRange(args.dateRange, args.startDate, args.endDate);
        const snap = await getDocs(query(collection(db, 'sales'), where('shopId', '==', ctx.shopId)));
        const custFilter = (args.customerName || '').toLowerCase().trim();
        const pmFilter = args.paymentMethod && args.paymentMethod !== 'all' ? args.paymentMethod : null;

        let filtered = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as any))
          .filter((s) => {
            const d = toJsDate(s.saleDate || s.saleDateClient || s.createdAt);
            if (d < start || d > end) return false;
            if (pmFilter && s.paymentMethod !== pmFilter) return false;
            if (custFilter && !(s.customerName || '').toLowerCase().includes(custFilter)) return false;
            return true;
          })
          .sort((a, b) => toJsDate(b.saleDate || b.saleDateClient).getTime() - toJsDate(a.saleDate || a.saleDateClient).getTime());

        let totalRevenue = 0;
        let totalProfit = 0;
        let cashTotal = 0;
        let onlineTotal = 0;
        let creditTotal = 0;

        for (const s of filtered) {
          const amt = Number(s.totalAmount) || 0;
          totalRevenue += amt;
          totalProfit += Number(s.totalProfit) || 0;
          if (s.paymentMethod === 'cash') cashTotal += amt;
          else if (s.paymentMethod === 'online') onlineTotal += amt;
          else if (s.paymentMethod === 'credit') creditTotal += amt;
          else if (s.paymentMethod === 'split' && s.splitAmounts) {
            cashTotal += Number(s.splitAmounts.cash) || 0;
            onlineTotal += Number(s.splitAmounts.online) || 0;
            creditTotal += Number(s.splitAmounts.credit) || 0;
          }
        }

        const max = Math.min(30, Math.max(1, Number(args.limitCount) || 15));
        const recent = filtered.slice(0, max).map((s) => {
          const entry: any = {
            id: s.id,
            shortId: s.id.slice(-6).toUpperCase(),
            date: toJsDate(s.saleDate || s.saleDateClient).toLocaleString(),
            totalAmount: s.totalAmount,
            paymentMethod: s.paymentMethod,
            customerName: s.customerName || 'Walk-in',
            items: (s.items || []).map((it: any) =>
              it.saleType === 'refill'
                ? `${it.refillAmount}ml ${it.productName} (${it.totalPrice})`
                : `${it.quantity}x ${it.productName} (${it.totalPrice})`
            ),
          };
          if (ctx.userRole !== 'cashier') {
            entry.totalProfit = s.totalProfit || 0;
          }
          return entry;
        });

        const summaryData: any = {
          salesCount: filtered.length,
          totalRevenue,
          cashTotal,
          onlineTotal,
          creditTotal,
          recentSales: recent,
        };
        if (ctx.userRole !== 'cashier') {
          summaryData.totalProfit = totalProfit;
        }

        return {
          ok: true,
          summary: `${filtered.length} sales totaling Rs ${totalRevenue}`,
          data: summaryData,
          visualCard: {
            type: 'sales_pulse',
            title: `Sales Pulse (${args.dateRange || 'today'})`,
            salesCount: filtered.length,
            totalRevenue,
            cashTotal,
            onlineTotal,
            creditTotal,
            ...(ctx.userRole !== 'cashier' ? { totalProfit } : {}),
            recentSales: recent.slice(0, 5),
          },
        };
      }

      case 'query_expenses': {
        const { start, end } = resolveDateRange(args.dateRange || 'thisMonth', args.startDate, args.endDate);
        const catFilter = (args.category || '').toLowerCase().trim();
        const snap = await getDocs(query(collection(db, 'expenses'), where('shopId', '==', ctx.shopId)));
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as any))
          .filter((e) => {
            const d = toJsDate(e.expenseDate || e.createdAt);
            if (d < start || d > end) return false;
            if (catFilter && !(e.category || '').toLowerCase().includes(catFilter)) return false;
            return true;
          })
          .sort((a, b) => toJsDate(b.expenseDate || b.createdAt).getTime() - toJsDate(a.expenseDate || a.createdAt).getTime());

        const totalAmount = list.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
        return {
          ok: true,
          summary: `${list.length} expenses totaling Rs ${totalAmount}`,
          data: {
            count: list.length,
            totalAmount,
            expenses: list.slice(0, 25).map((e) => ({
              id: e.id,
              amount: e.amount,
              category: e.category,
              description: e.description,
              date: toJsDate(e.expenseDate || e.createdAt).toISOString().split('T')[0],
            })),
          },
        };
      }

      case 'get_finance_summary': {
        const { accounts } = await getAggregatedFinancialData(ctx.shopId);
        const mappedAccounts = accounts.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          balance: a.balance,
        }));
        return {
          ok: true,
          summary: `Loaded ${accounts.length} financial ledger accounts`,
          data: { accounts: mappedAccounts },
          visualCard: {
            type: 'finance_overview',
            title: 'Shop Financial Ledger & Drawers',
            accounts: mappedAccounts,
          },
        };
      }

      case 'get_inventory_logs': {
        const pFilter = (args.productName || '').toLowerCase().trim();
        const max = Math.min(30, Math.max(1, Number(args.limitCount) || 15));
        const snap = await getDocs(
          query(collection(db, 'inventoryLogs'), where('shopId', '==', ctx.shopId), orderBy('createdAt', 'desc'), limit(50))
        );
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as any))
          .filter((r) => (!pFilter ? true : (r.productName || '').toLowerCase().includes(pFilter)))
          .slice(0, max)
          .map((r) => ({
            id: r.id,
            productName: r.productName,
            action: r.action || r.type,
            change: r.mlChange ?? r.change ?? r.quantityChange,
            reason: r.reason || '',
            actor: r.actorName || '',
            date: toJsDate(r.createdAt || r.createdAtClient).toLocaleString(),
          }));
        return { ok: true, summary: `Fetched ${rows.length} inventory logs`, data: { logs: rows } };
      }

      case 'navigate_to_page': {
        const rawPage = String(args.page || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
        const map: Record<string, string> = {
          new_sale: '/sales/new',
          pos: '/sales/new',
          stock: '/stock',
          inventory: '/stock',
          products: '/stock',
          sales_history: '/sales',
          sales: '/sales',
          customers: '/customers',
          udhaar: '/customers',
          expenses: '/expenses',
          inventory_logs: '/inventory-logs',
          logs: '/inventory-logs',
          reports: '/reports/detailed',
          detailed_reports: '/reports/detailed',
          settings: '/settings',
        };
        const path = map[rawPage];
        if (!path) return { ok: false, summary: 'Invalid page', error: `Unknown page "${args.page}".` };
        if (ctx.userRole === 'cashier' && (rawPage === 'reports' || rawPage === 'detailed_reports' || rawPage === 'settings')) {
          return {
            ok: false,
            blocked: true,
            summary: `Blocked navigation to ${args.page}`,
            error: `Permission denied: "${args.page}" requires Admin role.`,
          };
        }
        ctx.navigate(path);
        return { ok: true, summary: `Navigated to ${path}`, data: { navigatedTo: path } };
      }

      case 'scan_attached_roughbook_image': {
        if (!ctx.attachedImageFile) {
          return {
            ok: false,
            summary: 'No image attached',
            error: 'No roughbook photo is attached to this message. Please attach or paste an image first.',
          };
        }
        const scanResult = await scanRoughbookImage(ctx.attachedImageFile, ctx.products, ctx.customers);
        return {
          ok: true,
          summary: `Extracted ${scanResult.lines.length} lines from roughbook image`,
          data: scanResult,
          visualCard: {
            type: 'roughbook_scan',
            title: 'AI Roughbook Vision Extraction',
            summary: scanResult.summary,
            lines: scanResult.lines,
          },
        };
      }

      // ==================== WRITE / MUTATION TOOLS ====================
      case 'create_sale': {
        const rawItems: any[] = Array.isArray(args.items) ? args.items : [];
        if (rawItems.length === 0) {
          return { ok: false, summary: 'No items provided', error: 'At least one sale item is required.' };
        }

        const paymentMethod = args.paymentMethod || 'cash';
        let customer: any = null;
        if (args.customerId || args.customerName) {
          customer = findBestMatch(ctx.customers, args.customerId, args.customerName);
          if (!customer && paymentMethod === 'credit') {
            return {
              ok: false,
              summary: 'Customer not found for Udhaar',
              error: `Could not find customer "${args.customerName || args.customerId}" for credit sale. Add customer first.`,
            };
          }
        }
        if ((paymentMethod === 'credit' || (paymentMethod === 'split' && (args.splitAmounts?.credit || 0) > 0)) && !customer) {
          return { ok: false, summary: 'Customer required for Udhaar', error: 'Please specify an existing customer for credit/Udhaar sales.' };
        }
        if (customer?.udhaarBlocked && (paymentMethod === 'credit' || (paymentMethod === 'split' && (args.splitAmounts?.credit || 0) > 0))) {
          return {
            ok: false,
            blocked: true,
            summary: `Udhaar frozen for ${customer.name}`,
            error: `Udhaar is frozen for "${customer.name}". Only Cash or Online payment is allowed until unfrozen.`,
          };
        }

        const batch = writeBatch(db);
        const saleItems: any[] = [];
        let totalAmount = 0;

        let finalSaleDate: any = serverTimestamp();
        let finalSaleDateClient = new Date();
        if (args.saleDate) {
          const [y, m, d] = args.saleDate.split('-').map(Number);
          if (y && m && d) {
            const custom = new Date(y, m - 1, d, 12, 0, 0);
            finalSaleDate = custom;
            finalSaleDateClient = custom;
          }
        }

        for (const reqItem of rawItems) {
          const product = findBestMatch(ctx.products, reqItem.productId, reqItem.productName);
          if (!product) {
            return {
              ok: false,
              summary: `Product not found: ${reqItem.productName || reqItem.productId}`,
              error: `Product "${reqItem.productName || reqItem.productId}" was not found in catalog.`,
            };
          }

          const qty = Math.max(1, Number(reqItem.quantity) || 1);
          const saleType: 'regular' | 'refill' | 'full_bottle' =
            reqItem.saleType || (product.category === 'e-liquid' ? 'refill' : 'regular');
          const productRef = doc(db, 'products', product.id);

          if (saleType === 'refill') {
            const refillMl = Math.max(0.5, Number(reqItem.refillAmount) || 10);
            const mlNeeded = refillMl * qty;
            const bottleSizeMl = parseBottleSizeMl(product.bottleSize, 30);
            const defaultPerMl = Number(product.pricePerMl) || Math.round((Number(product.sellingPrice) || 3000) / bottleSizeMl) || 100;
            const baseUnitPrice = Number(reqItem.unitPrice) > 0 ? Number(reqItem.unitPrice) : Math.round(defaultPerMl * refillMl);
            const itemDiscountPct = Number(reqItem.unitPrice) > 0 ? 0 : getProductDiscountPercent(product);
            const unitPrice = itemDiscountPct > 0 ? getDiscountedUnitPrice(baseUnitPrice, itemDiscountPct) : baseUnitPrice;
            const lineTotal = Math.round(unitPrice * qty);
            const unitCostPrice = ((Number(product.costPrice) || 0) / bottleSizeMl) * refillMl;
            const totalCost = unitCostPrice * qty;

            const bottlesSnap = await getDocs(
              query(collection(db, `products/${product.id}/bottles`), where('shopId', '==', ctx.shopId))
            );
            const bottles: BottleDoc[] = bottlesSnap.docs.map((d) => {
              const data: any = d.data();
              return {
                id: d.id,
                bottleSize: Number(data.bottleSize) || bottleSizeMl,
                remainingMl: Number(data.remainingMl) || 0,
                status: data.status,
                createdAt: data.createdAt,
                openedDate: data.openedDate,
                updatedAt: data.updatedAt,
              };
            });

            const activeBottles = bottles.filter((b) => b.status !== 'sold');
            const availableMl = getAvailableMl(activeBottles);
            const bottleChanges: any[] = [];

            if (availableMl >= mlNeeded) {
              const ordered = orderBottlesForRefill(bottles);
              const { plans } = applyRefillToBottles({
                orderedBottles: ordered,
                mlNeeded,
                openedDateValue: serverTimestamp(),
              });
              for (const p of plans) {
                const bottleRef = doc(db, `products/${product.id}/bottles`, p.bottleId);
                batch.update(bottleRef, {
                  remainingMl: p.after.remainingMl,
                  status: p.after.status,
                  ...(p.after.openedDate ? { openedDate: p.after.openedDate } : {}),
                  updatedAt: serverTimestamp(),
                });
                bottleChanges.push({
                  bottleId: p.bottleId,
                  beforeRemainingMl: p.before.remainingMl,
                  afterRemainingMl: p.after.remainingMl,
                  beforeStatus: p.before.status,
                  afterStatus: p.after.status,
                });
              }
            }

            batch.update(productRef, { stockQuantity: increment(-mlNeeded) });
            totalAmount += lineTotal;

            saleItems.push({
              productId: product.id,
              productName: product.name,
              quantity: qty,
              unitPrice,
              originalUnitPrice: baseUnitPrice,
              discountPercent: itemDiscountPct,
              discountAmount: Math.max(0, Math.round((baseUnitPrice - unitPrice) * qty)),
              costPrice: unitCostPrice,
              totalPrice: lineTotal,
              totalCost,
              profit: lineTotal - totalCost,
              saleType: 'refill',
              refillAmount: refillMl,
              bottleSize: bottleSizeMl,
              ...(bottleChanges.length > 0 ? { bottleChanges } : {}),
            });

            const logRef = doc(collection(db, 'inventoryLogs'));
            batch.set(logRef, {
              productId: product.id,
              productName: product.name,
              shopId: ctx.shopId,
              action: 'sale',
              type: 'sale',
              mlChange: -mlNeeded,
              change: -mlNeeded,
              quantityChange: 0,
              reason: 'AI Agent Sale: Refill',
              notes: `${mlNeeded}ml refill via AI Agent`,
              ...ctx.actorMeta,
              createdAt: finalSaleDate,
              createdAtClient: finalSaleDateClient,
            });
          } else if (saleType === 'full_bottle') {
            const bottleSizeMl = parseBottleSizeMl(product.bottleSize, 30);
            const baseUnitPrice = Number(reqItem.unitPrice) > 0 ? Number(reqItem.unitPrice) : Number(product.sellingPrice) || 0;
            const itemDiscountPct = Number(reqItem.unitPrice) > 0 ? 0 : getProductDiscountPercent(product);
            const unitPrice = itemDiscountPct > 0 ? getDiscountedUnitPrice(baseUnitPrice, itemDiscountPct) : baseUnitPrice;
            const lineTotal = Math.round(unitPrice * qty);
            const itemCostPrice = Number(product.costPrice) || 0;
            const totalCost = itemCostPrice * qty;

            const closedSnap = await getDocs(
              query(
                collection(db, `products/${product.id}/bottles`),
                where('shopId', '==', ctx.shopId),
                where('status', '==', 'closed'),
                orderBy('createdAt', 'asc'),
                limit(qty)
              )
            );
            const bottleChanges: any[] = [];
            closedSnap.docs.forEach((bDoc) => {
              const bData: any = bDoc.data();
              batch.update(bDoc.ref, { status: 'sold', remainingMl: 0, updatedAt: serverTimestamp() });
              bottleChanges.push({
                bottleId: bDoc.id,
                beforeRemainingMl: Number(bData.remainingMl) || bottleSizeMl,
                afterRemainingMl: 0,
                beforeStatus: 'closed',
                afterStatus: 'sold',
              });
            });

            batch.update(productRef, { stockQuantity: increment(-(bottleSizeMl * qty)) });
            totalAmount += lineTotal;

            saleItems.push({
              productId: product.id,
              productName: product.name,
              quantity: qty,
              unitPrice,
              originalUnitPrice: baseUnitPrice,
              discountPercent: itemDiscountPct,
              discountAmount: Math.max(0, Math.round((baseUnitPrice - unitPrice) * qty)),
              costPrice: itemCostPrice,
              totalPrice: lineTotal,
              totalCost,
              profit: lineTotal - totalCost,
              saleType: 'full_bottle',
              bottleSize: bottleSizeMl,
              ...(bottleChanges.length > 0 ? { bottleChanges } : {}),
            });

            const logRef = doc(collection(db, 'inventoryLogs'));
            batch.set(logRef, {
              productId: product.id,
              productName: product.name,
              shopId: ctx.shopId,
              action: 'sale',
              type: 'sale',
              mlChange: -(bottleSizeMl * qty),
              change: -(bottleSizeMl * qty),
              quantityChange: -qty,
              reason: 'AI Agent Sale: Full Bottle',
              notes: `${qty} full bottle(s) via AI Agent`,
              ...ctx.actorMeta,
              createdAt: finalSaleDate,
              createdAtClient: finalSaleDateClient,
            });
          } else {
            const baseUnitPrice = Number(reqItem.unitPrice) > 0 ? Number(reqItem.unitPrice) : Number(product.sellingPrice) || 0;
            const itemDiscountPct = Number(reqItem.unitPrice) > 0 ? 0 : getProductDiscountPercent(product);
            const unitPrice = itemDiscountPct > 0 ? getDiscountedUnitPrice(baseUnitPrice, itemDiscountPct) : baseUnitPrice;
            const lineTotal = Math.round(unitPrice * qty);
            const itemCostPrice = Number(product.costPrice) || 0;
            const totalCost = itemCostPrice * qty;

            batch.update(productRef, { stockQuantity: increment(-qty) });
            totalAmount += lineTotal;

            saleItems.push({
              productId: product.id,
              productName: product.name,
              quantity: qty,
              unitPrice,
              originalUnitPrice: baseUnitPrice,
              discountPercent: itemDiscountPct,
              discountAmount: Math.max(0, Math.round((baseUnitPrice - unitPrice) * qty)),
              costPrice: itemCostPrice,
              totalPrice: lineTotal,
              totalCost,
              profit: lineTotal - totalCost,
              saleType: 'regular',
              refillAmount: null,
            });

            const logRef = doc(collection(db, 'inventoryLogs'));
            batch.set(logRef, {
              productId: product.id,
              productName: product.name,
              shopId: ctx.shopId,
              action: 'sale',
              type: 'sale',
              change: -qty,
              quantityChange: -qty,
              reason: 'AI Agent Sale: Regular',
              notes: `${qty} unit(s) via AI Agent`,
              ...ctx.actorMeta,
              createdAt: finalSaleDate,
              createdAtClient: finalSaleDateClient,
            });
          }
        }

        const totalCOGS = saleItems.reduce((acc, it) => acc + (it.totalCost || 0), 0);
        const totalDiscount = saleItems.reduce((acc, it) => acc + (Number(it.discountAmount) || 0), 0);
        const totalProfit = totalAmount - totalCOGS;
        const saleRef = doc(collection(db, 'sales'));

        const saleDoc: any = {
          shopId: ctx.shopId,
          customerId: customer?.id || null,
          customerName: customer?.name || null,
          items: saleItems,
          subtotalBeforeDiscount: totalAmount + totalDiscount,
          discountAmount: totalDiscount,
          totalAmount,
          totalCOGS,
          totalProfit,
          paymentMethod,
          saleDate: finalSaleDate,
          saleDateClient: finalSaleDateClient,
          ...ctx.actorMeta,
          source: 'ai_agent',
        };
        if (paymentMethod === 'split' && args.splitAmounts) {
          saleDoc.splitAmounts = args.splitAmounts;
        }
        batch.set(saleRef, saleDoc);

        const creditInc =
          paymentMethod === 'credit'
            ? totalAmount
            : paymentMethod === 'split'
            ? Number(args.splitAmounts?.credit) || 0
            : 0;
        if (creditInc > 0 && customer) {
          batch.update(doc(db, 'customers', customer.id), { creditBalance: increment(creditInc) });
        }

        await batch.commit();
        return {
          ok: true,
          summary: `Sale #${saleRef.id.slice(-6).toUpperCase()} recorded for Rs ${totalAmount} (${paymentMethod})`,
          data: { saleId: saleRef.id, totalAmount, paymentMethod, customerName: customer?.name || 'Walk-in', itemsCount: saleItems.length },
        };
      }

      case 'add_product': {
        if (ctx.userRole === 'cashier' && args.costPrice !== undefined) {
          return {
            ok: false,
            blocked: true,
            summary: 'Blocked costPrice edit by cashier',
            error: 'Permission denied: Cashiers cannot set product costPrice.',
          };
        }
        const isELiquid = args.category === 'e-liquid';
        const bottleSizeMl = isELiquid ? parseBottleSizeMl(args.bottleSizeMl, 30) : null;
        const bottleCount = isELiquid ? Math.max(0, Number(args.bottleCount) || (args.stockQuantity ? Math.round(Number(args.stockQuantity) / (bottleSizeMl || 30)) : 1)) : 0;
        const stockQuantity = isELiquid ? (bottleSizeMl || 30) * bottleCount : Math.max(0, Number(args.stockQuantity) || 0);
        const costPrice = ctx.userRole === 'cashier' ? 0 : Math.max(0, Number(args.costPrice) || 0);
        const minStock = Number(args.minStockLevel) || (isELiquid ? (bottleSizeMl || 30) * 2 : 2);

        const productRef = await addDoc(collection(db, 'products'), {
          name: String(args.name).trim(),
          category: args.category || 'other',
          sellingPrice: Number(args.sellingPrice) || 0,
          costPrice,
          stockQuantity,
          minStockLevel: minStock,
          lowStockAlert: minStock,
          ...(isELiquid
            ? {
                bottleSize: String(bottleSizeMl),
                unitCostPerMl: costPrice / (bottleSizeMl || 1),
              }
            : {}),
          shopId: ctx.shopId,
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });

        if (isELiquid && bottleCount > 0) {
          for (let i = 0; i < bottleCount; i++) {
            await addDoc(collection(db, `products/${productRef.id}/bottles`), {
              shopId: ctx.shopId,
              bottleSize: bottleSizeMl,
              remainingMl: bottleSizeMl,
              status: 'closed',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        await addDoc(collection(db, 'inventoryLogs'), {
          productId: productRef.id,
          productName: args.name,
          shopId: ctx.shopId,
          action: 'addition',
          type: 'addition',
          ...(isELiquid ? { mlChange: stockQuantity, change: stockQuantity } : { change: stockQuantity, quantityChange: stockQuantity }),
          reason: 'Added via AI Agent',
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });

        return {
          ok: true,
          summary: `Added product "${args.name}" (${stockQuantity}${isELiquid ? 'ml' : ' pcs'})`,
          data: { productId: productRef.id, name: args.name, stockQuantity },
        };
      }

      case 'update_product': {
        const product = findBestMatch(ctx.products, args.productId, args.productName);
        if (!product) {
          return { ok: false, summary: 'Product not found', error: `Could not find product "${args.productName || args.productId}".` };
        }
        if (ctx.userRole === 'cashier' && args.costPrice !== undefined) {
          return {
            ok: false,
            blocked: true,
            summary: 'Blocked costPrice edit by cashier',
            error: 'Permission denied: Cashiers cannot view or edit costPrice.',
          };
        }

        const updates: any = { shopId: ctx.shopId, updatedAt: serverTimestamp() };
        if (args.newName) updates.name = String(args.newName).trim();
        if (args.sellingPrice !== undefined) updates.sellingPrice = Number(args.sellingPrice);
        if (args.costPrice !== undefined) updates.costPrice = Number(args.costPrice);
        if (args.minStockLevel !== undefined) {
          updates.minStockLevel = Number(args.minStockLevel);
          updates.lowStockAlert = Number(args.minStockLevel);
        }

        const isELiquid = product.category === 'e-liquid';
        const bottleSizeMl = parseBottleSizeMl(product.bottleSize, 30);
        const bottlesToAdd = isELiquid ? Math.max(0, Number(args.bottlesToAdd) || 0) : 0;
        let stockDelta = Number(args.stockDelta) || 0;

        if (bottlesToAdd > 0) {
          for (let i = 0; i < bottlesToAdd; i++) {
            await addDoc(collection(db, `products/${product.id}/bottles`), {
              shopId: ctx.shopId,
              bottleSize: bottleSizeMl,
              remainingMl: bottleSizeMl,
              status: 'closed',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          stockDelta += bottlesToAdd * bottleSizeMl;
        }

        if (stockDelta !== 0) {
          updates.stockQuantity = increment(stockDelta);
          await addDoc(collection(db, 'inventoryLogs'), {
            productId: product.id,
            productName: args.newName || product.name,
            shopId: ctx.shopId,
            action: stockDelta > 0 ? 'addition' : 'deduction',
            type: stockDelta > 0 ? 'addition' : 'deduction',
            ...(isELiquid ? { mlChange: stockDelta, change: stockDelta } : { change: stockDelta, quantityChange: stockDelta }),
            reason: args.reason || 'Stock adjusted via AI Agent',
            ...ctx.actorMeta,
            createdAt: serverTimestamp(),
            createdAtClient: new Date(),
          });
        }

        await updateDoc(doc(db, 'products', product.id), updates);
        return {
          ok: true,
          summary: `Updated "${product.name}"`,
          data: { productId: product.id, name: args.newName || product.name },
        };
      }

      case 'apply_product_sale': {
        const rawList =
          Array.isArray(args.items) && args.items.length > 0
            ? args.items
            : args.productId || args.productName
            ? [{ productId: args.productId, productName: args.productName, discountPercent: args.discountPercent ?? 10 }]
            : [];

        if (rawList.length === 0) {
          return { ok: false, summary: 'No products specified', error: 'Specify at least one product to put on sale.' };
        }

        const batch = writeBatch(db);
        const updated: Array<{ id: string; name: string; basePrice: number; discountPercent: number; saleCheckoutPrice: number }> = [];
        const missing: string[] = [];

        for (const entry of rawList) {
          const product = findBestMatch(ctx.products, entry.productId, entry.productName);
          if (!product) {
            missing.push(entry.productName || entry.productId || 'Unknown');
            continue;
          }
          const pct = Math.min(90, Math.max(0, Number(entry.discountPercent ?? args.discountPercent ?? 10) || 0));
          const basePrice = Number(product.sellingPrice) || 0;
          const saleCheckoutPrice = getDiscountedUnitPrice(basePrice, pct);

          batch.update(doc(db, 'products', product.id), {
            onSale: pct > 0,
            saleDiscountPercent: pct,
            saleLabel: pct > 0 ? `Clearance -${pct}%` : '',
            updatedAt: serverTimestamp(),
          });

          const logRef = doc(collection(db, 'inventoryLogs'));
          batch.set(logRef, {
            productId: product.id,
            productName: product.name,
            shopId: ctx.shopId,
            action: 'promo_sale',
            type: 'promo_sale',
            change: 0,
            reason: pct > 0 ? `Special Checkout Sale -${pct}%` : 'Clearance Sale Ended',
            notes: pct > 0
              ? `Checkout discount ${pct}% (Rs ${basePrice} -> Rs ${saleCheckoutPrice}, base price unchanged)`
              : 'Removed special checkout discount',
            ...ctx.actorMeta,
            createdAt: serverTimestamp(),
            createdAtClient: new Date(),
          });

          updated.push({
            id: product.id,
            name: product.name,
            basePrice,
            discountPercent: pct,
            saleCheckoutPrice,
          });
        }

        if (updated.length === 0) {
          return {
            ok: false,
            summary: 'No matching products found',
            error: `Could not match products: ${missing.join(', ')}`,
          };
        }

        await batch.commit();
        return {
          ok: true,
          summary: updated[0].discountPercent > 0
            ? `Put special checkout sale on ${updated.length} item(s) (${updated[0].discountPercent}% off at checkout)`
            : `Removed sale on ${updated.length} item(s)`,
          data: { updated, missing },
        };
      }

      case 'receive_restock': {
        const reqList: any[] = Array.isArray(args.items) ? args.items : [];
        if (reqList.length === 0) return { ok: false, summary: 'No restock items', error: 'Specify at least one item to restock.' };

        const batch = writeBatch(db);
        const applied: string[] = [];

        for (const entry of reqList) {
          const product = findBestMatch(ctx.products, entry.productId, entry.productName);
          const qtyToAdd = Math.max(0, Math.floor(Number(entry.quantityToAdd) || 0));
          if (!product || qtyToAdd <= 0) continue;

          const isLiquid = product.category === 'e-liquid';
          const bottleSizeMl = parseBottleSizeMl(product.bottleSize, 30);
          const productRef = doc(db, 'products', product.id);
          const deltaStock = isLiquid ? qtyToAdd * bottleSizeMl : qtyToAdd;

          const updates: any = {
            stockQuantity: increment(deltaStock),
            updatedAt: serverTimestamp(),
          };

          if (Number(entry.unitCost) > 0) {
            const oldStockUnits = isLiquid
              ? (Number(product.stockQuantity) || 0) / Math.max(1, bottleSizeMl)
              : Number(product.stockQuantity) || 0;
            const oldCost = Number(product.costPrice) || 0;
            const totalUnits = oldStockUnits + qtyToAdd;
            updates.costPrice = totalUnits > 0
              ? Math.round(((oldStockUnits * oldCost + qtyToAdd * Number(entry.unitCost)) / totalUnits) * 100) / 100
              : Number(entry.unitCost);
          }

          batch.update(productRef, updates);

          if (isLiquid) {
            for (let i = 0; i < qtyToAdd; i++) {
              const bRef = doc(collection(db, `products/${product.id}/bottles`));
              batch.set(bRef, {
                shopId: ctx.shopId,
                bottleSize: bottleSizeMl,
                remainingMl: bottleSizeMl,
                status: 'closed',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }

          const logRef = doc(collection(db, 'inventoryLogs'));
          batch.set(logRef, {
            productId: product.id,
            productName: product.name,
            shopId: ctx.shopId,
            action: 'addition',
            type: 'addition',
            ...(isLiquid ? { mlChange: deltaStock, change: deltaStock, quantityChange: qtyToAdd } : { change: deltaStock, quantityChange: deltaStock }),
            reason: args.reason || 'AI Restock Autopilot Received',
            ...ctx.actorMeta,
            createdAt: serverTimestamp(),
            createdAtClient: new Date(),
          });

          applied.push(`${product.name} (+${qtyToAdd} ${isLiquid ? 'btl' : 'pcs'})`);
        }

        if (applied.length === 0) return { ok: false, summary: 'No matching items', error: 'Could not match restock products.' };
        await batch.commit();
        return {
          ok: true,
          summary: `Restocked ${applied.length} item(s): ${applied.join(', ')}`,
          data: { applied },
        };
      }

      case 'set_customer_udhaar_freeze': {
        const list = Array.isArray(args.items) && args.items.length > 0
          ? args.items
          : args.customerId || args.customerName
          ? [{ customerId: args.customerId, customerName: args.customerName, blocked: Boolean(args.blocked ?? true), reason: args.reason }]
          : [];
        if (list.length === 0) return { ok: false, summary: 'No customer specified', error: 'Specify at least one customer.' };

        const batch = writeBatch(db);
        const updatedNames: string[] = [];

        for (const item of list) {
          const cust = findBestMatch(ctx.customers, item.customerId, item.customerName);
          if (!cust) continue;
          const blocked = Boolean(item.blocked);
          batch.update(doc(db, 'customers', cust.id), {
            udhaarBlocked: blocked,
            udhaarBlockedReason: blocked ? (item.reason || args.reason || 'Overdue Udhaar freeze') : '',
            updatedAt: serverTimestamp(),
          });
          updatedNames.push(cust.name);
        }

        if (updatedNames.length === 0) return { ok: false, summary: 'Customer not found', error: 'No matching customer found.' };
        await batch.commit();
        const frozenFlag = Boolean(list[0].blocked);
        return {
          ok: true,
          summary: `${frozenFlag ? 'Frozen' : 'Unfrozen'} Udhaar for ${updatedNames.join(', ')}`,
          data: { updatedNames, blocked: frozenFlag },
        };
      }

      case 'pin_priority_push': {
        const list = Array.isArray(args.items) ? args.items : [];
        if (list.length === 0) return { ok: false, summary: 'No products specified', error: 'Specify items to pin.' };

        const batch = writeBatch(db);
        const updatedNames: string[] = [];

        for (const item of list) {
          const prod = findBestMatch(ctx.products, item.productId, item.productName);
          if (!prod) continue;
          const patch: any = {
            priorityRefill: Boolean(item.priorityRefill),
            updatedAt: serverTimestamp(),
          };
          if (item.discountPercent !== undefined) {
            const pct = Math.min(90, Math.max(0, Number(item.discountPercent) || 0));
            patch.onSale = pct > 0;
            patch.saleDiscountPercent = pct;
            patch.saleLabel = pct > 0 ? `Open Bottle Push -${pct}%` : '';
          }
          batch.update(doc(db, 'products', prod.id), patch);
          updatedNames.push(prod.name);
        }

        if (updatedNames.length === 0) return { ok: false, summary: 'No matching products', error: 'Could not find products to pin.' };
        await batch.commit();
        return {
          ok: true,
          summary: `Pinned PUSH REFILL badge on ${updatedNames.length} product(s): ${updatedNames.join(', ')}`,
          data: { updatedNames },
        };
      }

      case 'create_combo_deal': {
        const p1 = findBestMatch(ctx.products, args.primaryProductId, args.primaryProductName);
        const p2 = findBestMatch(ctx.products, args.secondaryProductId, args.secondaryProductName);
        if (!p1 || !p2) {
          return {
            ok: false,
            summary: 'Combo products not found',
            error: `Could not match both products (${args.primaryProductName}, ${args.secondaryProductName}).`,
          };
        }
        const discountPercent = Math.min(50, Math.max(5, Number(args.discountPercent) || 12));
        const regularTotal = Math.round((Number(p1.sellingPrice) || 0) + (Number(p2.sellingPrice) || 0));
        const comboPrice = getDiscountedUnitPrice(regularTotal, discountPercent);
        const title = args.title ? String(args.title).trim() : `${p1.name} + ${p2.name}`;

        const docRef = await addDoc(collection(db, 'combos'), {
          shopId: ctx.shopId,
          title,
          primaryProductId: p1.id,
          primaryProductName: p1.name,
          secondaryProductId: p2.id,
          secondaryProductName: p2.name,
          discountPercent,
          regularTotal,
          comboPrice,
          active: true,
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });

        return {
          ok: true,
          summary: `Published live POS combo "${title}" (-${discountPercent}%, Rs ${comboPrice})`,
          data: { comboId: docRef.id, title, regularTotal, comboPrice, discountPercent },
          visualCard: {
            type: 'combo_deals',
            title: 'Active POS Combo Deal',
            mode: 'active',
            combos: [
              {
                id: docRef.id,
                title,
                primaryProductId: p1.id,
                primaryProductName: p1.name,
                secondaryProductId: p2.id,
                secondaryProductName: p2.name,
                regularTotal,
                comboPrice,
                discountPercent,
              },
            ],
          },
        };
      }

      case 'delete_combo_deal': {
        const combosSnap = await getDocs(query(collection(db, 'combos'), where('shopId', '==', ctx.shopId)));
        const combos = combosSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        const match = args.comboId
          ? combos.find((c) => c.id === args.comboId)
          : combos.find((c) => String(c.title || '').toLowerCase().includes(String(args.title || '').toLowerCase()));
        if (!match) return { ok: false, summary: 'Combo not found', error: 'No matching combo deal found.' };
        await deleteDoc(doc(db, 'combos', match.id));
        return { ok: true, summary: `Removed combo "${match.title}"`, data: { deletedComboId: match.id } };
      }

      case 'save_day_closing': {
        const closing = await computeDayClosingMetrics(ctx.shopId, args.date, ctx.products);
        const docRef = await addDoc(collection(db, 'day_closings'), {
          shopId: ctx.shopId,
          ...closing,
          notes: args.notes || '',
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });
        return {
          ok: true,
          summary: `Saved Galla day closing (${closing.date}) — Expected Cash Rs ${closing.expectedCashInDrawer.toLocaleString()}`,
          data: { id: docRef.id, ...closing },
          visualCard: {
            type: 'day_closing_audit',
            title: 'Verified Galla Day Closing',
            ...closing,
            saved: true,
          },
        };
      }

      case 'add_customer': {
        const docRef = await addDoc(collection(db, 'customers'), {
          name: String(args.name).trim(),
          phone: args.phone || '',
          email: args.email || '',
          creditBalance: Number(args.creditBalance) || 0,
          shopId: ctx.shopId,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });
        return {
          ok: true,
          summary: `Added customer "${args.name}"`,
          data: { customerId: docRef.id, name: args.name },
        };
      }

      case 'record_credit_transaction': {
        const cust = findBestMatch(ctx.customers, args.customerId, args.customerName);
        if (!cust) {
          return { ok: false, summary: 'Customer not found', error: `Could not find customer "${args.customerName || args.customerId}".` };
        }
        const txType = args.transactionType === 'given' ? 'given' : 'taken';
        const amount = Math.abs(Number(args.amount) || 0);
        if (amount <= 0) {
          return { ok: false, summary: 'Invalid amount', error: 'Amount must be greater than 0.' };
        }

        await addDoc(collection(db, 'credits'), {
          creditType: 'customer',
          customerId: cust.id,
          entityName: cust.name,
          transactionType: txType,
          amount,
          description: args.description || `${txType === 'taken' ? 'Payment received' : 'Credit added'} via AI Agent`,
          shopId: ctx.shopId,
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });

        const delta = getCreditBalanceDelta(txType, amount);
        await updateDoc(doc(db, 'customers', cust.id), {
          creditBalance: increment(delta),
        });

        return {
          ok: true,
          summary: `${txType === 'taken' ? 'Received Rs ' + amount + ' from' : 'Added Rs ' + amount + ' debt to'} ${cust.name}`,
          data: { customerId: cust.id, customerName: cust.name, transactionType: txType, amount },
        };
      }

      case 'add_expense': {
        const amount = Math.abs(Number(args.amount) || 0);
        if (amount <= 0) return { ok: false, summary: 'Invalid amount', error: 'Expense amount must be > 0.' };
        const expDate = args.expenseDate ? new Date(`${args.expenseDate}T12:00:00`) : new Date();
        const docRef = await addDoc(collection(db, 'expenses'), {
          amount,
          category: args.category || 'Other',
          description: args.description || 'Shop Expense',
          expenseDate: expDate,
          shopId: ctx.shopId,
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });
        return {
          ok: true,
          summary: `Recorded Rs ${amount} expense (${args.category})`,
          data: { expenseId: docRef.id, amount, category: args.category, description: args.description },
        };
      }

      case 'export_backup': {
        await exportBackup(ctx.shopId);
        return {
          ok: true,
          summary: 'Backup file downloaded',
          data: { downloaded: true },
        };
      }

      // ==================== DESTRUCTIVE TOOLS ====================
      case 'reverse_and_delete_sale': {
        const targetId = String(args.saleId || '').trim();
        let saleSnap = await getDoc(doc(db, 'sales', targetId));
        let saleData: any = saleSnap.exists() ? { id: saleSnap.id, ...saleSnap.data() } : null;

        if (!saleData) {
          // Support matching by shortId (last 6 chars)
          const allSales = await getDocs(query(collection(db, 'sales'), where('shopId', '==', ctx.shopId)));
          const match = allSales.docs.find((d) => d.id.toUpperCase().endsWith(targetId.toUpperCase()));
          if (match) saleData = { id: match.id, ...match.data() };
        }

        if (!saleData) {
          return { ok: false, summary: 'Sale not found', error: `No sale found matching ID "${targetId}".` };
        }
        await deleteSaleWithReversal(saleData, ctx.shopId, ctx.actorMeta);
        return {
          ok: true,
          summary: `Reversed & deleted sale #${saleData.id.slice(-6).toUpperCase()} (Rs ${saleData.totalAmount})`,
          data: { deletedSaleId: saleData.id, restoredAmount: saleData.totalAmount },
        };
      }

      case 'delete_product': {
        const product = findBestMatch(ctx.products, args.productId, args.productName);
        if (!product) return { ok: false, summary: 'Product not found', error: 'Could not find product to delete.' };

        await addDoc(collection(db, 'inventoryLogs'), {
          productId: product.id,
          productName: product.name,
          shopId: ctx.shopId,
          action: 'deletion',
          type: 'deletion',
          change: -(Number(product.stockQuantity) || 0),
          reason: args.reason || 'Deleted via AI Agent',
          ...ctx.actorMeta,
          createdAt: serverTimestamp(),
          createdAtClient: new Date(),
        });
        await deleteDoc(doc(db, 'products', product.id));
        return { ok: true, summary: `Deleted product "${product.name}"`, data: { deletedProductId: product.id } };
      }

      case 'delete_expense': {
        await deleteDoc(doc(db, 'expenses', args.expenseId));
        return { ok: true, summary: `Deleted expense #${args.expenseId}`, data: { deletedExpenseId: args.expenseId } };
      }

      case 'delete_customer': {
        const cust = findBestMatch(ctx.customers, args.customerId, args.customerName);
        if (!cust) return { ok: false, summary: 'Customer not found', error: 'Could not find customer.' };
        if ((Number(cust.creditBalance) || 0) > 0) {
          return {
            ok: false,
            blocked: true,
            summary: 'Customer has unpaid Udhaar',
            error: `Cannot delete "${cust.name}" because they still owe Rs ${cust.creditBalance}. Clear their debt first.`,
          };
        }
        await deleteDoc(doc(db, 'customers', cust.id));
        return { ok: true, summary: `Deleted customer "${cust.name}"`, data: { deletedCustomerId: cust.id } };
      }

      default:
        return { ok: false, summary: `Unhandled tool ${name}`, error: `Tool "${name}" is not implemented.` };
    }
  } catch (err: any) {
    console.error(`[AgentTool:${name}] Error:`, err);
    return {
      ok: false,
      summary: `Error running ${name}`,
      error: err?.message || 'Unexpected execution error.',
    };
  }
}
