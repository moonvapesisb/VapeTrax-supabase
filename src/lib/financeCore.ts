import type {
  Customer,
  ExpenseRow,
  FinanceAccountRow,
  FinanceLocalRollback,
  FinanceTransactionRow,
  FinanceTxRollbackEffect,
  LinkedShopFinanceSummary,
  SyncOperation,
} from './db';

export type FinanceAccountType = 'shopCash' | 'primaryOnline' | 'secondaryBank';

export type FinanceTransactionType =
  | 'sale'
  | 'saleReversal'
  | 'transferIn'
  | 'transferOut'
  | 'payout'
  | 'expense'
  | 'expenseReversal'
  | 'creditPayment'
  | 'opening'
  | 'adjustment';

export type FinanceDirection = 'in' | 'out';

export type PayoutCategory =
  | 'supplierPayment'
  | 'ownerWithdrawal'
  | 'staffAdvance'
  | 'generalPayout';

export interface ActorMeta {
  createdBy: string | null;
  actorRole: 'admin' | 'cashier';
  actorName: string;
}

export interface FinanceReconciliationMismatch {
  accountId: string;
  accountName: string;
  ownerShopId: string;
  cachedBalance: number;
  ledgerBalance: number;
  difference: number;
}

export interface FinanceLocalStore {
  getAccount(id: string): Promise<FinanceAccountRow | undefined>;
  getAccounts(ids: ReadonlyArray<string>): Promise<Array<FinanceAccountRow | undefined>>;
  putAccounts(rows: FinanceAccountRow[]): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  getTransactions(ids: ReadonlyArray<string>): Promise<Array<FinanceTransactionRow | undefined>>;
  putTransactions(rows: FinanceTransactionRow[]): Promise<void>;
  deleteTransactions(ids: ReadonlyArray<string>): Promise<void>;
  putExpense(row: ExpenseRow): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  getCustomer(id: string): Promise<Customer | undefined>;
  updateCustomerCredit(id: string, creditBalance: number): Promise<void>;
  enqueueOperation?(op: Omit<SyncOperation, 'id'>): Promise<number>;
  markQueueRolledBack(opId: number, rb: FinanceLocalRollback): Promise<void>;
  runTransaction<T>(fn: () => Promise<T>): Promise<T>;
}

export const PAYOUT_CATEGORIES: ReadonlyArray<{ value: PayoutCategory; label: string }> = [
  { value: 'supplierPayment', label: 'Supplier Payment' },
  { value: 'ownerWithdrawal', label: 'Owner Withdrawal' },
  { value: 'staffAdvance', label: 'Staff Advance' },
  { value: 'generalPayout', label: 'General Payout' },
];

export const FINANCE_ACCOUNT_TYPE_LABELS: Readonly<Record<FinanceAccountType, string>> = {
  shopCash: 'Shop Cash',
  primaryOnline: 'Primary Online',
  secondaryBank: 'Bank Account',
};

export const FINANCE_TX_TYPE_LABELS: Readonly<Record<FinanceTransactionType, string>> = {
  sale: 'Sale',
  saleReversal: 'Sale Reversal',
  transferIn: 'Transfer In',
  transferOut: 'Transfer Out',
  payout: 'Payout',
  expense: 'Expense',
  expenseReversal: 'Expense Reversal',
  creditPayment: 'Credit Payment',
  opening: 'Opening Balance',
  adjustment: 'Adjustment',
};

const MAX_RUPEE_AMOUNT = 1_000_000_000_000;
export const NON_REVERSIBLE_TX_TYPES = new Set<string>(['adjustment', 'saleReversal', 'expenseReversal']);

/** Generates a collision-resistant client ID for offline finance accounts and ledger entries. */
export function newFinanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Validates that a rupee amount is a finite integer within allowed bounds. */
export function assertWholeRupees(
  amount: number,
  options: { allowZero?: boolean; label?: string } = {},
): number {
  const label = options.label ?? 'Amount';
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new Error(`${label} must be a whole number of rupees (no decimals).`);
  }
  if (options.allowZero ? amount < 0 : amount <= 0) {
    throw new Error(
      options.allowZero
        ? `${label} cannot be negative.`
        : `${label} must be greater than zero.`,
    );
  }
  if (amount >= MAX_RUPEE_AMOUNT) {
    throw new Error(`${label} is outside allowed bounds.`);
  }
  return amount;
}

/** True when an account has a negative balance or is flagged overdrawn. */
export function isOverdrawn(
  account: Pick<FinanceAccountRow, 'balance' | 'isOverdrawn'>,
): boolean {
  return Boolean(account.isOverdrawn) || Number(account.balance) < 0;
}

/** Visibility rule matching server RLS: cashiers see only their shop's shopCash account. */
export function canSeeFinanceAccount(
  account: Pick<FinanceAccountRow, 'ownerShopId' | 'type'>,
  shopId: string,
  isAdmin: boolean,
): boolean {
  if (!shopId) return false;
  if (!isAdmin) {
    return account.ownerShopId === shopId && account.type === 'shopCash';
  }
  return account.ownerShopId === shopId || account.type === 'secondaryBank';
}

/** Write permission rule matching server checks (UI/Dexie guard before queueing). */
export function canWriteFinanceAccount(
  account: Pick<FinanceAccountRow, 'ownerShopId' | 'type' | 'isArchived'>,
  shopId: string,
  isAdmin: boolean,
): boolean {
  if (!shopId || account.isArchived) return false;
  if (!isAdmin) {
    return account.ownerShopId === shopId && account.type === 'shopCash';
  }
  return account.ownerShopId === shopId || account.type === 'secondaryBank';
}

/** Derives an account's balance purely by summing its ledger transactions. */
export function deriveAccountBalance(
  transactions: ReadonlyArray<Pick<FinanceTransactionRow, 'accountId' | 'direction' | 'amount'>>,
  accountId: string,
): number {
  let sum = 0;
  for (const tx of transactions) {
    if (tx.accountId !== accountId) continue;
    const amt = Number(tx.amount) || 0;
    sum += tx.direction === 'in' ? amt : -amt;
  }
  return Math.round(sum);
}

/** Collects account IDs touched by pending sync queue items (whose local/server state is in-flight). */
function pendingQueueAccountIds(ops: ReadonlyArray<SyncOperation>): Set<string> {
  const touched = new Set<string>();
  for (const op of ops) {
    if (op.status !== 'pending' || op.localRollback?.rolledBack) continue;
    for (const eff of op.localRollback?.txEffects ?? []) {
      touched.add(eff.accountId);
    }
    if (op.localRollback?.addedAccount) {
      touched.add(op.localRollback.addedAccount.id);
    }
  }
  return touched;
}

/**
 * Compares each account's cached balance against the sum of its local ledger entries.
 * Accounts with in-flight pending queue operations are skipped until synced.
 */
export function reconcileFinanceAccounts(
  accounts: ReadonlyArray<FinanceAccountRow>,
  transactions: ReadonlyArray<FinanceTransactionRow>,
  queueOps: ReadonlyArray<SyncOperation> = [],
): FinanceReconciliationMismatch[] {
  const inFlightAccounts = pendingQueueAccountIds(queueOps);
  const totalsByAccount = new Map<string, number>();
  for (const tx of transactions) {
    const amt = Number(tx.amount) || 0;
    const prev = totalsByAccount.get(tx.accountId) ?? 0;
    totalsByAccount.set(tx.accountId, prev + (tx.direction === 'in' ? amt : -amt));
  }

  const mismatches: FinanceReconciliationMismatch[] = [];
  for (const acc of accounts) {
    if (inFlightAccounts.has(acc.id)) continue;
    const cachedBalance = Math.round(Number(acc.balance) || 0);
    const ledgerBalance = Math.round(totalsByAccount.get(acc.id) ?? 0);
    if (cachedBalance !== ledgerBalance) {
      mismatches.push({
        accountId: acc.id,
        accountName: acc.name,
        ownerShopId: acc.ownerShopId,
        cachedBalance,
        ledgerBalance,
        difference: cachedBalance - ledgerBalance,
      });
    }
  }
  return mismatches;
}

/**
 * Computes combined cash, primary online, accessible secondary bank (deduped by id),
 * and read-only linked-shop cash+primary totals for dashboard/management cards.
 */
export function computeCombinedTotal(
  accounts: ReadonlyArray<FinanceAccountRow>,
  linkedSummaries: ReadonlyArray<LinkedShopFinanceSummary>,
  ownShopId: string,
  isAdmin: boolean,
): {
  ownCash: number;
  ownPrimary: number;
  accessibleBanks: number;
  linkedCashAndPrimary: number;
  combinedTotal: number;
} {
  const seenIds = new Set<string>();
  let ownCash = 0;
  let ownPrimary = 0;
  let accessibleBanks = 0;

  for (const acc of accounts) {
    if (acc.isArchived || seenIds.has(acc.id) || !canSeeFinanceAccount(acc, ownShopId, isAdmin)) {
      continue;
    }
    seenIds.add(acc.id);
    const bal = Math.round(Number(acc.balance) || 0);
    if (acc.ownerShopId === ownShopId && acc.type === 'shopCash') {
      ownCash += bal;
    } else if (acc.ownerShopId === ownShopId && acc.type === 'primaryOnline') {
      ownPrimary += bal;
    } else if (acc.type === 'secondaryBank') {
      accessibleBanks += bal;
    }
  }

  let linkedCashAndPrimary = 0;
  if (isAdmin) {
    const seenShops = new Set<string>();
    for (const s of linkedSummaries) {
      if (!s.shopId || s.shopId === ownShopId || seenShops.has(s.shopId)) continue;
      seenShops.add(s.shopId);
      linkedCashAndPrimary +=
        Math.round(Number(s.shopCashBalance) || 0) +
        Math.round(Number(s.primaryOnlineBalance) || 0);
    }
  }

  return {
    ownCash,
    ownPrimary,
    accessibleBanks,
    linkedCashAndPrimary,
    combinedTotal: ownCash + ownPrimary + accessibleBanks + linkedCashAndPrimary,
  };
}

export interface VisibleFinanceSummary {
  visibleAccounts: FinanceAccountRow[];
  activeAccounts: FinanceAccountRow[];
  archivedAccounts: FinanceAccountRow[];
  writableAccounts: FinanceAccountRow[];
  accessibleBanks: FinanceAccountRow[];
  ownCashAccount?: FinanceAccountRow;
  ownPrimaryAccount?: FinanceAccountRow;
  linkedSummaries: LinkedShopFinanceSummary[];
  shopLabelById: Map<string, string>;
  combinedTotals: ReturnType<typeof computeCombinedTotal>;
  mismatches: FinanceReconciliationMismatch[];
}

/**
 * Single shared selector used by both Dashboard and Manage Cash so account filtering,
 * shared-bank owning-shop labels, combined totals, and reconciliation warnings match identically.
 */
export function summarizeVisibleFinanceView(params: {
  accounts: ReadonlyArray<FinanceAccountRow>;
  transactions: ReadonlyArray<FinanceTransactionRow>;
  linkedSummaries: ReadonlyArray<LinkedShopFinanceSummary>;
  queueOps?: ReadonlyArray<SyncOperation>;
  shopId: string;
  isAdmin: boolean;
}): VisibleFinanceSummary {
  const { accounts, transactions, linkedSummaries, queueOps = [], shopId, isAdmin } = params;
  const scopedLinkedSummaries = isAdmin ? [...linkedSummaries] : [];
  const seen = new Set<string>();
  const order: Record<string, number> = { shopCash: 0, primaryOnline: 1, secondaryBank: 2 };

  const visibleAccounts = shopId
    ? accounts
        .filter((acc) => {
          if (seen.has(acc.id) || !canSeeFinanceAccount(acc, shopId, isAdmin)) return false;
          seen.add(acc.id);
          return true;
        })
        .sort((a, b) => {
          const archDiff = Number(a.isArchived) - Number(b.isArchived);
          if (archDiff !== 0) return archDiff;
          const ownDiff = Number(a.ownerShopId !== shopId) - Number(b.ownerShopId !== shopId);
          if (ownDiff !== 0) return ownDiff;
          const typeDiff = (order[a.type] ?? 9) - (order[b.type] ?? 9);
          if (typeDiff !== 0) return typeDiff;
          return a.name.localeCompare(b.name);
        })
    : [];

  const activeAccounts = visibleAccounts.filter((a) => !a.isArchived);
  const archivedAccounts = visibleAccounts.filter((a) => a.isArchived);
  const writableAccounts = shopId
    ? activeAccounts.filter((a) => canWriteFinanceAccount(a, shopId, isAdmin))
    : [];

  const shopLabelById = new Map<string, string>();
  if (shopId) shopLabelById.set(shopId, 'This Shop');
  for (const s of scopedLinkedSummaries) {
    if (s.shopId) shopLabelById.set(s.shopId, s.shopName);
  }

  const visibleIds = new Set(visibleAccounts.map((a) => a.id));
  const visibleTxs = transactions.filter((tx) => visibleIds.has(tx.accountId));
  const combinedTotals = computeCombinedTotal(activeAccounts, scopedLinkedSummaries, shopId, isAdmin);
  const mismatches = reconcileFinanceAccounts(activeAccounts, visibleTxs, queueOps);

  return {
    visibleAccounts,
    activeAccounts,
    archivedAccounts,
    writableAccounts,
    accessibleBanks: activeAccounts.filter((a) => a.type === 'secondaryBank'),
    ownCashAccount: activeAccounts.find((a) => a.ownerShopId === shopId && a.type === 'shopCash'),
    ownPrimaryAccount: activeAccounts.find((a) => a.ownerShopId === shopId && a.type === 'primaryOnline'),
    linkedSummaries: scopedLinkedSummaries,
    shopLabelById,
    combinedTotals,
    mismatches,
  };
}

/** True if a transaction may still be reversed via reverse_finance_transaction. */
export function canReverseFinanceTransaction(
  tx: Pick<FinanceTransactionRow, 'id' | 'type'>,
  allTransactions: ReadonlyArray<Pick<FinanceTransactionRow, 'referenceType' | 'referenceId'>>,
  isShopAdmin: boolean,
): boolean {
  if (!isShopAdmin || NON_REVERSIBLE_TX_TYPES.has(tx.type)) return false;
  return !allTransactions.some(
    (other) => other.referenceType === 'adjustment' && other.referenceId === tx.id,
  );
}

/** Builds optimistic sale ledger rows and rollback descriptor matching SQL process_checkout. */
export function buildOptimisticCheckoutLedger(params: {
  shopId: string;
  saleId: string;
  ledgerEpoch?: string | null;
  paymentMethod: string;
  totalAmount: number;
  splitAmounts?: { cash?: number; online?: number; credit?: number } | null;
  actor: ActorMeta;
  cashAccount: FinanceAccountRow | null;
  primaryOnlineAccount: FinanceAccountRow | null;
  occurredAt: string;
}): { txs: FinanceTransactionRow[]; rollback: FinanceLocalRollback } {
  const finiteNonNeg = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const pm = params.paymentMethod.trim().toLowerCase();
  const total = Math.round(finiteNonNeg(params.totalAmount));
  const cashAmt =
    pm === 'cash'
      ? total
      : pm === 'split'
        ? Math.round(finiteNonNeg(params.splitAmounts?.cash))
        : 0;
  const onlineAmt =
    pm === 'online'
      ? total
      : pm === 'split'
        ? Math.round(finiteNonNeg(params.splitAmounts?.online))
        : 0;

  const epoch = params.ledgerEpoch?.trim();
  const txPrefix = epoch ? `${params.saleId}:${epoch}` : params.saleId;
  const saleTag = params.saleId.slice(-6).toUpperCase();
  const now = new Date().toISOString();
  const txs: FinanceTransactionRow[] = [];
  const txEffects: FinanceTxRollbackEffect[] = [];

  if (cashAmt > 0 && params.cashAccount) {
    const txId = `${txPrefix}:cash`;
    txs.push({
      id: txId,
      shopId: params.shopId,
      ownerShopId: params.cashAccount.ownerShopId,
      accountId: params.cashAccount.id,
      counterpartyAccountId: null,
      type: 'sale',
      direction: 'in',
      amount: cashAmt,
      transferId: null,
      category: null,
      paidTo: null,
      description: `Sale #${saleTag}${pm === 'split' ? ' (Cash)' : ''}`,
      notes: null,
      referenceId: params.saleId,
      referenceType: 'sale',
      actorName: params.actor.actorName,
      actorRole: params.actor.actorRole,
      createdBy: params.actor.createdBy,
      occurredAt: params.occurredAt,
      createdAt: now,
      updatedAt: now,
    });
    txEffects.push({ txId, accountId: params.cashAccount.id, direction: 'in', amount: cashAmt });
  }

  if (onlineAmt > 0 && params.primaryOnlineAccount) {
    const txId = `${txPrefix}:online`;
    txs.push({
      id: txId,
      shopId: params.shopId,
      ownerShopId: params.primaryOnlineAccount.ownerShopId,
      accountId: params.primaryOnlineAccount.id,
      counterpartyAccountId: null,
      type: 'sale',
      direction: 'in',
      amount: onlineAmt,
      transferId: null,
      category: null,
      paidTo: null,
      description: `Sale #${saleTag}${pm === 'split' ? ' (Online)' : ''}`,
      notes: null,
      referenceId: params.saleId,
      referenceType: 'sale',
      actorName: params.actor.actorName,
      actorRole: params.actor.actorRole,
      createdBy: params.actor.createdBy,
      occurredAt: params.occurredAt,
      createdAt: now,
      updatedAt: now,
    });
    txEffects.push({
      txId,
      accountId: params.primaryOnlineAccount.id,
      direction: 'in',
      amount: onlineAmt,
    });
  }

  return {
    txs,
    rollback: txs.length > 0 ? { addedTxs: txs, txEffects } : {},
  };
}

/** Applies ledger transaction effects to local accounts (positive or inverse delta). */
export async function adjustAccountBalancesInStore(
  store: FinanceLocalStore,
  effects: ReadonlyArray<FinanceTxRollbackEffect>,
  sign: 1 | -1,
): Promise<void> {
  if (!effects.length) return;
  const now = new Date().toISOString();
  const deltaByAccount = new Map<string, number>();
  for (const eff of effects) {
    const signedAmt = (eff.direction === 'in' ? 1 : -1) * sign * eff.amount;
    deltaByAccount.set(eff.accountId, (deltaByAccount.get(eff.accountId) ?? 0) + signedAmt);
  }
  const accountIds = [...deltaByAccount.keys()];
  const accounts = await store.getAccounts(accountIds);
  const updates: FinanceAccountRow[] = [];
  for (let i = 0; i < accountIds.length; i++) {
    const acc = accounts[i];
    if (!acc) continue;
    const nextBalance = Math.round((Number(acc.balance) || 0) + (deltaByAccount.get(accountIds[i]) ?? 0));
    updates.push({
      ...acc,
      balance: nextBalance,
      isOverdrawn: nextBalance < 0,
      updatedAt: now,
    });
  }
  if (updates.length) await store.putAccounts(updates);
}

/** Reverses optimistic local mutations when a queue item permanently fails or is discarded. */
export async function revertOptimisticLocalOp(
  op: SyncOperation,
  options: { deleteQueueRow?: boolean } = {},
  store: FinanceLocalStore,
): Promise<void> {
  const rb = op.localRollback;
  if (!rb || rb.rolledBack) return;

  await store.runTransaction(async () => {
    const txEffects = rb.txEffects ?? [];
    if (txEffects.length) {
      const existing = await store.getTransactions(txEffects.map((e) => e.txId));
      const presentEffects = txEffects.filter((_, idx) => Boolean(existing[idx]));
      if (presentEffects.length) {
        await store.deleteTransactions(presentEffects.map((e) => e.txId));
        await adjustAccountBalancesInStore(store, presentEffects, -1);
      }
    }

    if (rb.addedAccount) {
      await store.deleteAccount(rb.addedAccount.id);
    }

    if (rb.accountBackup) {
      const currentAcc = await store.getAccount(rb.accountBackup.id);
      if (currentAcc) {
        await store.putAccounts([{
          ...currentAcc,
          name: rb.accountBackup.name,
          bankName: rb.accountBackup.bankName,
          accountNumber: rb.accountBackup.accountNumber,
          isArchived: rb.accountBackup.isArchived,
          archivedAt: rb.accountBackup.archivedAt,
        }]);
      }
    }

    if (rb.addedExpenseId) {
      await store.deleteExpense(rb.addedExpenseId);
    }

    if (rb.expenseBackup) {
      await store.putExpense(rb.expenseBackup);
    }

    if (rb.creditCustomerId && rb.creditPaymentAmount) {
      const customer = await store.getCustomer(rb.creditCustomerId);
      if (customer) {
        const restored = Math.round((Number(customer.creditBalance) || 0) + rb.creditPaymentAmount);
        await store.updateCustomerCredit(customer.id, restored);
      }
    }

    if (!options.deleteQueueRow && op.id != null) {
      await store.markQueueRolledBack(op.id, { ...rb, rolledBack: true });
    }
  });
}

/** Re-applies optimistic local mutations when a failed item is explicitly retried. */
export async function reapplyOptimisticLocalOp(
  op: SyncOperation,
  store: FinanceLocalStore,
): Promise<void> {
  const rb = op.localRollback;
  if (!rb || !rb.rolledBack) return;

  await store.runTransaction(async () => {
    if (rb.addedAccount) {
      const exists = await store.getAccount(rb.addedAccount.id);
      if (!exists) {
        await store.putAccounts([{ ...rb.addedAccount, balance: 0, isOverdrawn: false }]);
      }
    }

    if (rb.addedTxs?.length && rb.txEffects?.length) {
      const existing = await store.getTransactions(rb.txEffects.map((e) => e.txId));
      const missingTxs = rb.addedTxs.filter((_, idx) => !existing[idx]);
      const missingEffects = rb.txEffects.filter((_, idx) => !existing[idx]);
      if (missingTxs.length) {
        await store.putTransactions(missingTxs);
        await adjustAccountBalancesInStore(store, missingEffects, 1);
      }
    }

    if (rb.accountBackup && op.type === 'update_finance_account') {
      const acc = await store.getAccount(rb.accountBackup.id);
      if (acc) {
        await store.putAccounts([{
          ...acc,
          name: String(op.payload.p_name ?? acc.name),
          bankName: (op.payload.p_bank_name as string | null) ?? null,
          accountNumber: (op.payload.p_account_number as string | null) ?? null,
        }]);
      }
    } else if (rb.accountBackup && op.type === 'archive_finance_account') {
      const acc = await store.getAccount(rb.accountBackup.id);
      if (acc) {
        await store.putAccounts([{
          ...acc,
          isArchived: true,
          archivedAt: new Date().toISOString(),
        }]);
      }
    }

    if (rb.updatedExpense) {
      await store.putExpense(rb.updatedExpense);
    } else if (rb.expenseBackup && op.type === 'delete_expense') {
      await store.deleteExpense(rb.expenseBackup.id);
    }

    if (rb.creditCustomerId && rb.creditPaymentAmount) {
      const customer = await store.getCustomer(rb.creditCustomerId);
      if (customer) {
        const next = Math.max(
          0,
          Math.round((Number(customer.creditBalance) || 0) - rb.creditPaymentAmount),
        );
        await store.updateCustomerCredit(customer.id, next);
      }
    }

    if (op.id != null) {
      await store.markQueueRolledBack(op.id, { ...rb, rolledBack: false });
    }
  });
}

/** Transfers whole rupees between two accessible accounts using the provided local store. */
export async function transferFundsInStore(
  params: {
    shopId: string;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    description?: string | null;
    notes?: string | null;
    occurredAt?: string;
    actor: ActorMeta;
  },
  store: FinanceLocalStore,
): Promise<{ transferId: string; queueId: number }> {
  if (params.fromAccountId === params.toAccountId) {
    throw new Error('Source and destination accounts cannot be the same.');
  }
  const amount = assertWholeRupees(params.amount, { label: 'Transfer amount' });
  const transferId = newFinanceId();
  const outTxId = newFinanceId();
  const inTxId = newFinanceId();
  const now = new Date().toISOString();
  const occurredAt = params.occurredAt || now;
  const notes = params.notes?.trim() || null;
  const customDesc = params.description?.trim() || null;

  let queueId = 0;
  await store.runTransaction(async () => {
    const [fromAcc, toAcc] = await store.getAccounts([params.fromAccountId, params.toAccountId]);
    if (!fromAcc || fromAcc.isArchived) throw new Error('Source account not found or archived.');
    if (!toAcc || toAcc.isArchived) throw new Error('Destination account not found or archived.');
    const isAdmin = params.actor.actorRole === 'admin';
    if (!canWriteFinanceAccount(fromAcc, params.shopId, isAdmin)) {
      throw new Error('You cannot transfer from the selected source account.');
    }
    if (!canWriteFinanceAccount(toAcc, params.shopId, isAdmin)) {
      throw new Error('You cannot transfer to the selected destination account.');
    }
    const available = Math.round(Number(fromAcc.balance) || 0);
    if (amount > available) {
      throw new Error(
        `Insufficient balance in ${fromAcc.name} (available: Rs ${available.toLocaleString()}).`,
      );
    }

    const desc = customDesc ?? `Transfer: ${fromAcc.name} -> ${toAcc.name}`;
    const outTx: FinanceTransactionRow = {
      id: outTxId,
      shopId: params.shopId,
      ownerShopId: fromAcc.ownerShopId,
      accountId: fromAcc.id,
      counterpartyAccountId: toAcc.id,
      type: 'transferOut',
      direction: 'out',
      amount,
      transferId,
      category: null,
      paidTo: null,
      description: desc,
      notes,
      referenceId: transferId,
      referenceType: 'transfer',
      actorName: params.actor.actorName,
      actorRole: params.actor.actorRole,
      createdBy: params.actor.createdBy,
      occurredAt,
      createdAt: now,
      updatedAt: now,
    };
    const inTx: FinanceTransactionRow = {
      id: inTxId,
      shopId: params.shopId,
      ownerShopId: toAcc.ownerShopId,
      accountId: toAcc.id,
      counterpartyAccountId: fromAcc.id,
      type: 'transferIn',
      direction: 'in',
      amount,
      transferId,
      category: null,
      paidTo: null,
      description: desc,
      notes,
      referenceId: transferId,
      referenceType: 'transfer',
      actorName: params.actor.actorName,
      actorRole: params.actor.actorRole,
      createdBy: params.actor.createdBy,
      occurredAt,
      createdAt: now,
      updatedAt: now,
    };
    const effects: FinanceTxRollbackEffect[] = [
      { txId: outTxId, accountId: fromAcc.id, direction: 'out', amount },
      { txId: inTxId, accountId: toAcc.id, direction: 'in', amount },
    ];

    await store.putTransactions([outTx, inTx]);
    await adjustAccountBalancesInStore(store, effects, 1);

    if (store.enqueueOperation) {
      queueId = await store.enqueueOperation({
        type: 'transfer_funds',
        payload: {
          p_transfer_id: transferId,
          p_out_tx_id: outTxId,
          p_in_tx_id: inTxId,
          p_shop_id: params.shopId,
          p_from_account_id: fromAcc.id,
          p_to_account_id: toAcc.id,
          p_amount: amount,
          p_description: customDesc,
          p_notes: notes,
          p_occurred_at: occurredAt,
        },
        localRollback: { addedTxs: [outTx, inTx], txEffects: effects },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    }
  });

  return { transferId, queueId };
}

// ---------------------------------------------------------------------------
// Pure sync-queue dependency & backoff helpers
// ---------------------------------------------------------------------------

export const TRANSIENT_HTTP = new Set([0, 408, 425, 429, 502, 503, 504, 520, 521, 522, 523, 524]);
export const TRANSIENT_CODES = new Set([
  '40001', '40P01',
  '55P03', '57014',
  '53300', '57P01', '57P03',
  'PGRST301', 'PGRST303',
]);

export const isQueueItemDue = (item: SyncOperation, now: number): boolean =>
  !item.nextAttemptAt || item.nextAttemptAt <= now;

/** Is this item waiting for the network (or a busy server), rather than refused? */
export const waitsForNetwork = (item: SyncOperation): boolean => {
  if (item.lastOutcome) return item.lastOutcome === 'unreached';
  const code = item.lastErrorCode || '';
  if (!code) return false;
  if (code === 'network') return true;
  const http = /^http_(\d+)$/.exec(code);
  if (http) return TRANSIENT_HTTP.has(Number(http[1]));
  return TRANSIENT_CODES.has(code);
};

/** Returns account IDs that this queue operation reads or writes on the server. */
export const referencedAccountIds = (item: SyncOperation): string[] => {
  const p = item.payload || {};
  switch (item.type) {
    case 'update_finance_account':
    case 'archive_finance_account':
      return p.p_id ? [String(p.p_id)] : [];
    case 'record_opening_balance':
    case 'record_payout':
    case 'record_expense':
      return p.p_account_id ? [String(p.p_account_id)] : [];
    case 'update_expense':
      return p.p_account_id ? [String(p.p_account_id)] : [];
    case 'transfer_funds':
      return [p.p_from_account_id, p.p_to_account_id].filter(Boolean).map(String);
    default:
      return [];
  }
};

/** Returns transaction IDs created by this queue operation once synced. */
export const createdTxIdsOf = (item: SyncOperation): string[] => {
  const p = item.payload || {};
  switch (item.type) {
    case 'create_finance_account':
      return p.p_opening_tx_id ? [String(p.p_opening_tx_id)] : [];
    case 'record_opening_balance':
    case 'record_payout':
      return p.p_id ? [String(p.p_id)] : [];
    case 'transfer_funds':
      return [p.p_out_tx_id, p.p_in_tx_id].filter(Boolean).map(String);
    case 'record_expense':
    case 'record_credit_payment':
      return p.p_tx_id ? [String(p.p_tx_id)] : [];
    case 'update_expense':
      return p.p_new_tx_id ? [String(p.p_new_tx_id)] : [];
    case 'process_checkout':
      return (item.localRollback?.addedTxs ?? []).map((tx) => tx.id);
    default:
      return [];
  }
};

/** Returns true if `item` references an account or transaction still uncreated in earlier/failed queue entries. */
export const isBlockedByDependency = (
  item: SyncOperation,
  uncreatedAccountIds: ReadonlySet<string>,
  uncreatedTxIds: ReadonlySet<string>,
): boolean => {
  if (referencedAccountIds(item).some((id) => uncreatedAccountIds.has(id))) {
    return true;
  }
  if (
    item.type === 'reverse_finance_transaction' &&
    item.payload?.p_original_tx_id &&
    uncreatedTxIds.has(String(item.payload.p_original_tx_id))
  ) {
    return true;
  }
  return false;
};

/**
 * Which of these pending items (oldest first) may be sent now. Stops at the first one
 * waiting for the network; skips items resting on server-refusal backoff while holding back
 * later ops that depend on an earlier uncreated account or transaction.
 */
export const sendableNow = (
  pending: SyncOperation[],
  now: number,
  allQueue: ReadonlyArray<SyncOperation> = pending,
): SyncOperation[] => {
  const blockedAccounts = new Set<string>();
  const blockedTxs = new Set<string>();
  for (const op of allQueue) {
    if (op.status === 'failed') {
      if (op.type === 'create_finance_account' && op.payload?.p_id) {
        blockedAccounts.add(String(op.payload.p_id));
      }
      for (const txId of createdTxIdsOf(op)) blockedTxs.add(txId);
    }
  }

  const out: SyncOperation[] = [];
  for (const item of pending) {
    if (isQueueItemDue(item, now)) {
      if (!isBlockedByDependency(item, blockedAccounts, blockedTxs)) {
        out.push(item);
      } else {
        if (item.type === 'create_finance_account' && item.payload?.p_id) {
          blockedAccounts.add(String(item.payload.p_id));
        }
        for (const txId of createdTxIdsOf(item)) blockedTxs.add(txId);
      }
      continue;
    }
    if (item.type === 'create_finance_account' && item.payload?.p_id) {
      blockedAccounts.add(String(item.payload.p_id));
    }
    for (const txId of createdTxIdsOf(item)) blockedTxs.add(txId);
    if (waitsForNetwork(item)) break;
  }
  return out;
};
