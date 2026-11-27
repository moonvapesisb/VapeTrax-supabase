import Dexie, { Table } from 'dexie';
import { Database } from '../types/supabase';

export type Product = Database['public']['Tables']['products']['Row'];
export type Bottle = Database['public']['Tables']['bottles']['Row'];
export type Customer = Database['public']['Tables']['customers']['Row'];
export type FinanceAccountRow = Database['public']['Tables']['finance_accounts']['Row'];
export type FinanceTransactionRow = Database['public']['Tables']['finance_transactions']['Row'];
export type ExpenseRow = Database['public']['Tables']['expenses']['Row'];

export interface LinkedShopFinanceSummary {
  shopId: string;
  shopName: string;
  shopCashBalance: number;
  shopCashOverdrawn: boolean;
  primaryOnlineBalance: number;
  primaryOnlineName: string;
  primaryOnlineOverdrawn: boolean;
  fetchedAt: string;
}

export type SyncOperationType =
  | 'process_checkout'
  | 'process_sale'
  | 'process_stock_adjustment'
  | 'insert_customer'
  | 'update_product'
  | 'create_finance_account'
  | 'update_finance_account'
  | 'archive_finance_account'
  | 'record_opening_balance'
  | 'transfer_funds'
  | 'record_payout'
  | 'record_expense'
  | 'update_expense'
  | 'delete_expense'
  | 'record_credit_payment'
  | 'reverse_finance_transaction';

export interface FinanceTxRollbackEffect {
  txId: string;
  accountId: string;
  direction: 'in' | 'out';
  amount: number;
}

export interface FinanceLocalRollback {
  rolledBack?: boolean;
  addedTxs?: FinanceTransactionRow[];
  txEffects?: FinanceTxRollbackEffect[];
  addedAccount?: FinanceAccountRow;
  accountBackup?: Pick<
    FinanceAccountRow,
    'id' | 'name' | 'bankName' | 'accountNumber' | 'isArchived' | 'archivedAt'
  >;
  addedExpenseId?: string;
  expenseBackup?: ExpenseRow;
  updatedExpense?: ExpenseRow;
  creditCustomerId?: string;
  creditPaymentAmount?: number;
}

export interface SyncOperation {
  id?: number; // Auto-incremented by Dexie
  type: SyncOperationType;
  payload: Record<string, unknown>;
  /** Optimistic local finance/expense/credit snapshot so failed or discarded items can be cleanly rolled back (and re-applied on Retry). */
  localRollback?: FinanceLocalRollback;
  /** 'failed' after 10 refusals by the server; it waits for Retry, Export or Discard. */
  status: 'pending' | 'failed';
  error?: string;
  /** The server's error code from the last failed attempt (or 'network', 'http_503' ...). */
  lastErrorCode?: string;
  createdAt: string;
  /** Times the server itself refused this item. Network failures are not counted. */
  retryCount: number;
  /** Every attempt, network failures included; only used to space retries. */
  attempts?: number;
  nextAttemptAt?: number; // epoch ms; failed items wait before the next retry
  /**
   * How the last attempt ended. 'unreached' (no internet, or the server was busy)
   * holds back every later item, so sales reach the server in the order they were made.
   */
  lastOutcome?: 'unreached' | 'refused';
  /** "Busy" answers from the server (timeouts, 503 ...); past a limit they count as refusals. */
  busyAnswers?: number;
  /**
   * Bottles that a later sale from this device has already sent to the server. That
   * sale's bottle levels already include this one, so these bottles are left out when
   * this item is sent (sending them would roll the bottles back).
   */
  overtakenBottleIds?: string[];
}

export class VapeTraxDB extends Dexie {
  products!: Table<Product, string>;
  bottles!: Table<Bottle, string>;
  customers!: Table<Customer, string>;
  syncQueue!: Table<SyncOperation, number>;
  financeAccounts!: Table<FinanceAccountRow, string>;
  financeTransactions!: Table<FinanceTransactionRow, string>;
  expenses!: Table<ExpenseRow, string>;
  linkedShopSummaries!: Table<LinkedShopFinanceSummary, string>;

  constructor() {
    super('VapeTraxDB');

    this.version(1).stores({
      // Primary key is &id. We also index shopId, category, and name for fast queries.
      products: '&id, shopId, category, name',

      // Index by id, shopId, productId, and status.
      bottles: '&id, shopId, productId, status, createdAt',

      customers: '&id, shopId, fullName, phone',

      // Auto-incremented id. Index by status and createdAt.
      syncQueue: '++id, type, status, createdAt'
    });

    this.version(2).stores({
      products: '&id, shopId, category, name',
      bottles: '&id, shopId, productId, status, createdAt',
      customers: '&id, shopId, name, phone',
      syncQueue: '++id, type, status, createdAt',
      financeAccounts: '&id, shopId, ownerShopId, type, isArchived',
      financeTransactions: '&id, shopId, ownerShopId, accountId, occurredAt, type, referenceId, transferId',
      expenses: '&id, shopId, expenseDate, paidFromAccountId',
      linkedShopSummaries: '&shopId, fetchedAt',
    });
  }
}

export const db = new VapeTraxDB();

// ---------------------------------------------------------------------------
// A newer build opened in another tab wants to upgrade the device database.
// This tab lets go of it straight away (so the upgrade is never blocked and
// this old code never writes to the new layout) and covers the page with a
// "Reload required" notice. When the cart is empty it reloads by itself; a
// cart in progress is kept in localStorage, so the reload never loses it.
// ---------------------------------------------------------------------------

const CART_KEY = 'vapetrax_cart';
const RELOAD_NOTICE_ID = 'vapetrax-reload-required';

const cartIsEmpty = (): boolean => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return true;
    const cart = JSON.parse(raw);
    return !Array.isArray(cart) || cart.length === 0;
  } catch {
    return false; // can't tell: let the person reload when ready
  }
};

const showReloadRequired = () => {
  if (typeof document === 'undefined' || document.getElementById(RELOAD_NOTICE_ID)) return;

  const overlay = document.createElement('div');
  overlay.id = RELOAD_NOTICE_ID;
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', `${RELOAD_NOTICE_ID}-title`);
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
    'padding:16px;background:rgba(15,23,42,0.85);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';

  const box = document.createElement('div');
  box.style.cssText =
    'max-width:420px;width:100%;background:#fff;color:#0f172a;border-radius:16px;padding:24px;' +
    'box-shadow:0 20px 40px rgba(0,0,0,0.3);text-align:center;';

  const title = document.createElement('h2');
  title.id = `${RELOAD_NOTICE_ID}-title`;
  title.textContent = 'Reload required';
  title.style.cssText = 'margin:0 0 8px;font-size:20px;font-weight:700;';

  const text = document.createElement('p');
  text.textContent =
    'A newer version of VapeTrax was opened on this device. This window has stopped saving so it cannot ' +
    'damage your data. Your cart and unsynced sales are kept. Reload to continue.';
  text.style.cssText = 'margin:0 0 20px;font-size:14px;line-height:1.5;color:#475569;';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reload now';
  button.style.cssText =
    'border:0;border-radius:12px;padding:12px 24px;background:#7c3aed;color:#fff;font-size:14px;' +
    'font-weight:700;cursor:pointer;';
  button.addEventListener('click', () => window.location.reload());

  box.append(title, text, button);
  overlay.append(box);
  (document.body || document.documentElement).append(overlay);
  button.focus();
};

db.on('versionchange', () => {
  db.close();
  showReloadRequired();
  if (cartIsEmpty()) window.location.reload();
  return false; // already closed above
});
