import { supabase } from './supabase';
import {
  db,
  Customer,
  ExpenseRow,
  FinanceAccountRow,
  FinanceLocalRollback,
  FinanceTransactionRow,
  FinanceTxRollbackEffect,
  LinkedShopFinanceSummary,
  SyncOperation,
} from './db';
import {
  adjustAccountBalancesInStore,
  assertWholeRupees,
  canReverseFinanceTransaction,
  canSeeFinanceAccount,
  canWriteFinanceAccount,
  computeCombinedTotal,
  deriveAccountBalance,
  FINANCE_ACCOUNT_TYPE_LABELS,
  FINANCE_TX_TYPE_LABELS,
  isOverdrawn,
  newFinanceId,
  NON_REVERSIBLE_TX_TYPES,
  PAYOUT_CATEGORIES,
  reapplyOptimisticLocalOp as reapplyOptimisticLocalOpWithStore,
  reconcileFinanceAccounts,
  revertOptimisticLocalOp as revertOptimisticLocalOpWithStore,
  summarizeVisibleFinanceView,
  transferFundsInStore,
  type ActorMeta,
  type FinanceAccountType,
  type FinanceDirection,
  type FinanceLocalStore,
  type FinanceReconciliationMismatch,
  type FinanceTransactionType,
  type PayoutCategory,
  type VisibleFinanceSummary,
} from './financeCore';

export {
  assertWholeRupees,
  buildOptimisticCheckoutLedger,
  canReverseFinanceTransaction,
  canSeeFinanceAccount,
  canWriteFinanceAccount,
  computeCombinedTotal,
  deriveAccountBalance,
  FINANCE_ACCOUNT_TYPE_LABELS,
  FINANCE_TX_TYPE_LABELS,
  isOverdrawn,
  newFinanceId,
  PAYOUT_CATEGORIES,
  reconcileFinanceAccounts,
  summarizeVisibleFinanceView,
  type ActorMeta,
  type FinanceAccountType,
  type FinanceDirection,
  type FinanceLocalStore,
  type FinanceReconciliationMismatch,
  type FinanceTransactionType,
  type PayoutCategory,
  type VisibleFinanceSummary,
} from './financeCore';

export const dexieFinanceStore: FinanceLocalStore = {
  getAccount: (id) => db.financeAccounts.get(id),
  getAccounts: (ids) => db.financeAccounts.bulkGet([...ids]),
  putAccounts: async (rows) => {
    await db.financeAccounts.bulkPut(rows);
  },
  deleteAccount: (id) => db.financeAccounts.delete(id),
  getTransactions: (ids) => db.financeTransactions.bulkGet([...ids]),
  putTransactions: async (rows) => {
    await db.financeTransactions.bulkPut(rows);
  },
  deleteTransactions: (ids) => db.financeTransactions.bulkDelete([...ids]),
  putExpense: async (row) => {
    await db.expenses.put(row);
  },
  deleteExpense: (id) => db.expenses.delete(id),
  getCustomer: (id) => db.customers.get(id),
  updateCustomerCredit: async (id, creditBalance) => {
    await db.customers.update(id, { creditBalance });
  },
  enqueueOperation: (op) => db.syncQueue.add(op),
  markQueueRolledBack: async (opId, rb) => {
    await db.syncQueue.update(opId, { localRollback: rb });
  },
  runTransaction: (fn) =>
    db.transaction(
      'rw',
      [db.financeAccounts, db.financeTransactions, db.expenses, db.customers, db.syncQueue],
      fn,
    ),
};

async function adjustAccountBalancesInTx(
  effects: ReadonlyArray<FinanceTxRollbackEffect>,
  sign: 1 | -1,
): Promise<void> {
  await adjustAccountBalancesInStore(dexieFinanceStore, effects, sign);
}

/** Reverses optimistic local mutations in Dexie when a queue item permanently fails or is discarded. */
export async function revertOptimisticLocalOp(
  op: SyncOperation,
  options: { deleteQueueRow?: boolean } = {},
  store: FinanceLocalStore = dexieFinanceStore,
): Promise<void> {
  await revertOptimisticLocalOpWithStore(op, options, store);
}

/** Re-applies optimistic local mutations in Dexie when a failed item is retried. */
export async function reapplyOptimisticLocalOp(
  op: SyncOperation,
  store: FinanceLocalStore = dexieFinanceStore,
): Promise<void> {
  await reapplyOptimisticLocalOpWithStore(op, store);
}

/** Ensures default shopCash and primaryOnline accounts exist on the server when online. */
export async function ensureShopFinanceAccounts(shopId?: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const { error } = await supabase.rpc(
    'ensure_shop_finance_accounts',
    shopId ? { p_shop_id: shopId } : {},
  );
  if (error) {
    console.warn('[Finance] ensure_shop_finance_accounts failed', error);
    return false;
  }
  return true;
}

/**
 * Fetches read-only cash & primary balances of directly linked shops (admin only)
 * and caches them in Dexie with an explicit fetchedAt timestamp.
 */
export async function fetchLinkedShopsFinanceSummary(
  ownShopId: string,
  isAdmin: boolean,
): Promise<LinkedShopFinanceSummary[]> {
  if (!isAdmin || !ownShopId) {
    await db.linkedShopSummaries.clear();
    return [];
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return db.linkedShopSummaries.toArray();
  }

  const { data, error } = await supabase.rpc('get_linked_shops_finance_summary');
  if (error) {
    console.warn('[Finance] get_linked_shops_finance_summary failed', error);
    return db.linkedShopSummaries.toArray();
  }

  const fetchedAt = new Date().toISOString();
  const rows: LinkedShopFinanceSummary[] = (Array.isArray(data) ? data : []).map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      shopId: String(item.shopId ?? ''),
      shopName: String(item.shopName ?? 'Linked Shop'),
      shopCashBalance: Math.round(Number(item.shopCashBalance) || 0),
      shopCashOverdrawn: Boolean(item.shopCashOverdrawn),
      primaryOnlineBalance: Math.round(Number(item.primaryOnlineBalance) || 0),
      primaryOnlineName: String(item.primaryOnlineName ?? 'Primary Online'),
      primaryOnlineOverdrawn: Boolean(item.primaryOnlineOverdrawn),
      fetchedAt,
    };
  }).filter((row) => Boolean(row.shopId) && row.shopId !== ownShopId);

  await db.transaction('rw', db.linkedShopSummaries, async () => {
    await db.linkedShopSummaries.clear();
    if (rows.length) await db.linkedShopSummaries.bulkPut(rows);
  });

  return rows;
}

/** Creates a secondary bank account optimistically in Dexie and enqueues creation. */
export async function createSecondaryBankAccount(params: {
  shopId: string;
  name: string;
  bankName?: string | null;
  accountNumber?: string | null;
  openingBalance?: number;
  actor: ActorMeta;
}): Promise<{ accountId: string; queueId: number }> {
  const trimmedName = params.name.trim();
  if (!trimmedName) throw new Error('Account name is required.');
  const openAmt = assertWholeRupees(params.openingBalance ?? 0, {
    allowZero: true,
    label: 'Opening balance',
  });

  const accountId = newFinanceId();
  const openingTxId = openAmt > 0 ? `${accountId}:opening` : null;
  const now = new Date().toISOString();
  const bankName = params.bankName?.trim() || null;
  const accountNumber = params.accountNumber?.trim() || null;

  const newAccount: FinanceAccountRow = {
    id: accountId,
    shopId: params.shopId,
    ownerShopId: params.shopId,
    name: trimmedName,
    type: 'secondaryBank',
    bankName,
    accountNumber,
    balance: openAmt,
    isOverdrawn: false,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const addedTxs: FinanceTransactionRow[] = [];
  const txEffects: FinanceTxRollbackEffect[] = [];
  if (openAmt > 0 && openingTxId) {
    addedTxs.push({
      id: openingTxId,
      shopId: params.shopId,
      ownerShopId: params.shopId,
      accountId,
      counterpartyAccountId: null,
      type: 'opening',
      direction: 'in',
      amount: openAmt,
      transferId: null,
      category: null,
      paidTo: null,
      description: `Opening balance: ${trimmedName}`,
      notes: null,
      referenceId: accountId,
      referenceType: 'opening',
      actorName: params.actor.actorName,
      actorRole: params.actor.actorRole,
      createdBy: params.actor.createdBy,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    });
    txEffects.push({ txId: openingTxId, accountId, direction: 'in', amount: openAmt });
  }

  let queueId = 0;
  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.syncQueue],
    async () => {
      await db.financeAccounts.put(newAccount);
      if (addedTxs.length) await db.financeTransactions.bulkPut(addedTxs);
      queueId = await db.syncQueue.add({
        type: 'create_finance_account',
        payload: {
          p_id: accountId,
          p_shop_id: params.shopId,
          p_name: trimmedName,
          p_type: 'secondaryBank',
          p_bank_name: bankName,
          p_account_number: accountNumber,
          p_opening_balance: openAmt,
          p_opening_tx_id: openingTxId,
        },
        localRollback: {
          addedAccount: { ...newAccount, balance: 0, isOverdrawn: false },
          addedTxs,
          txEffects,
        },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return { accountId, queueId };
}

/** Updates an owned account's name/bank metadata in Dexie and enqueues the RPC. */
export async function updateFinanceAccountDetails(params: {
  accountId: string;
  shopId: string;
  name: string;
  bankName?: string | null;
  accountNumber?: string | null;
}): Promise<number> {
  const trimmedName = params.name.trim();
  if (!trimmedName) throw new Error('Account name is required.');
  const bankName = params.bankName?.trim() || null;
  const accountNumber = params.accountNumber?.trim() || null;
  const now = new Date().toISOString();

  let queueId = 0;
  await db.transaction('rw', [db.financeAccounts, db.syncQueue], async () => {
    const existing = await db.financeAccounts.get(params.accountId);
    if (!existing) throw new Error('Finance account not found.');
    if (existing.ownerShopId !== params.shopId) {
      throw new Error('Only the owning shop admin can edit this account.');
    }

    await db.financeAccounts.update(params.accountId, {
      name: trimmedName,
      bankName,
      accountNumber,
      updatedAt: now,
    });

    queueId = await db.syncQueue.add({
      type: 'update_finance_account',
      payload: {
        p_id: params.accountId,
        p_shop_id: params.shopId,
        p_name: trimmedName,
        p_bank_name: bankName,
        p_account_number: accountNumber,
      },
      localRollback: {
        accountBackup: {
          id: existing.id,
          name: existing.name,
          bankName: existing.bankName,
          accountNumber: existing.accountNumber,
          isArchived: existing.isArchived,
          archivedAt: existing.archivedAt,
        },
      },
      status: 'pending',
      createdAt: now,
      retryCount: 0,
    });
  });

  return queueId;
}

/** Archives an owned secondaryBank account whose balance is zero. */
export async function archiveFinanceAccount(params: {
  accountId: string;
  shopId: string;
}): Promise<number> {
  const now = new Date().toISOString();
  let queueId = 0;

  await db.transaction('rw', [db.financeAccounts, db.syncQueue], async () => {
    const existing = await db.financeAccounts.get(params.accountId);
    if (!existing) throw new Error('Finance account not found.');
    if (existing.ownerShopId !== params.shopId) {
      throw new Error('Only the owning shop admin can archive this account.');
    }
    if (existing.type !== 'secondaryBank') {
      throw new Error('Shop Cash and Primary Online accounts cannot be archived.');
    }
    if (Math.round(Number(existing.balance) || 0) !== 0) {
      throw new Error('Transfer or settle the remaining balance to zero before archiving.');
    }

    await db.financeAccounts.update(params.accountId, {
      isArchived: true,
      archivedAt: now,
      updatedAt: now,
    });

    queueId = await db.syncQueue.add({
      type: 'archive_finance_account',
      payload: {
        p_id: params.accountId,
        p_shop_id: params.shopId,
      },
      localRollback: {
        accountBackup: {
          id: existing.id,
          name: existing.name,
          bankName: existing.bankName,
          accountNumber: existing.accountNumber,
          isArchived: existing.isArchived,
          archivedAt: existing.archivedAt,
        },
      },
      status: 'pending',
      createdAt: now,
      retryCount: 0,
    });
  });

  return queueId;
}

/** Records a one-time opening balance entry for an account and updates its local balance. */
export async function recordOpeningBalance(params: {
  shopId: string;
  accountId: string;
  amount: number;
  notes?: string | null;
  occurredAt?: string;
  actor: ActorMeta;
}): Promise<{ txId: string; queueId: number }> {
  const amount = assertWholeRupees(params.amount, { label: 'Opening balance' });
  const txId = newFinanceId();
  const now = new Date().toISOString();
  const occurredAt = params.occurredAt || now;
  const notes = params.notes?.trim() || null;

  let queueId = 0;
  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.syncQueue],
    async () => {
      const acc = await db.financeAccounts.get(params.accountId);
      if (!acc || acc.isArchived) throw new Error('Finance account not found or archived.');
      if (!canWriteFinanceAccount(acc, params.shopId, params.actor.actorRole === 'admin')) {
        throw new Error('You do not have permission to write to this account.');
      }

      const tx: FinanceTransactionRow = {
        id: txId,
        shopId: params.shopId,
        ownerShopId: acc.ownerShopId,
        accountId: acc.id,
        counterpartyAccountId: null,
        type: 'opening',
        direction: 'in',
        amount,
        transferId: null,
        category: null,
        paidTo: null,
        description: `Opening balance: ${acc.name}`,
        notes,
        referenceId: txId,
        referenceType: 'opening',
        actorName: params.actor.actorName,
        actorRole: params.actor.actorRole,
        createdBy: params.actor.createdBy,
        occurredAt,
        createdAt: now,
        updatedAt: now,
      };
      const effects: FinanceTxRollbackEffect[] = [
        { txId, accountId: acc.id, direction: 'in', amount },
      ];

      await db.financeTransactions.put(tx);
      await adjustAccountBalancesInTx(effects, 1);

      queueId = await db.syncQueue.add({
        type: 'record_opening_balance',
        payload: {
          p_id: txId,
          p_shop_id: params.shopId,
          p_account_id: acc.id,
          p_amount: amount,
          p_notes: notes,
          p_occurred_at: occurredAt,
        },
        localRollback: { addedTxs: [tx], txEffects: effects },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return { txId, queueId };
}

/** Transfers whole rupees between two accessible accounts, blocking local overdrafts. */
export async function transferFunds(params: {
  shopId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string | null;
  notes?: string | null;
  occurredAt?: string;
  actor: ActorMeta;
}): Promise<{ transferId: string; queueId: number }> {
  return transferFundsInStore(params, dexieFinanceStore);
}

/** Records a non-expense payout / withdrawal, blocking local overdrafts. */
export async function recordPayout(params: {
  shopId: string;
  accountId: string;
  amount: number;
  paidTo: string;
  category: PayoutCategory;
  description?: string | null;
  notes?: string | null;
  occurredAt?: string;
  actor: ActorMeta;
}): Promise<{ txId: string; queueId: number }> {
  const paidTo = params.paidTo.trim();
  if (!paidTo) throw new Error('Recipient ("Paid To") is required.');
  const amount = assertWholeRupees(params.amount, { label: 'Payout amount' });
  const txId = newFinanceId();
  const now = new Date().toISOString();
  const occurredAt = params.occurredAt || now;
  const customDesc = params.description?.trim() || null;
  const notes = params.notes?.trim() || null;

  let queueId = 0;
  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.syncQueue],
    async () => {
      const acc = await db.financeAccounts.get(params.accountId);
      if (!acc || acc.isArchived) throw new Error('Source account not found or archived.');
      if (!canWriteFinanceAccount(acc, params.shopId, params.actor.actorRole === 'admin')) {
        throw new Error('You cannot pay out from the selected account.');
      }
      const available = Math.round(Number(acc.balance) || 0);
      if (amount > available) {
        throw new Error(
          `Insufficient balance in ${acc.name} (available: Rs ${available.toLocaleString()}).`,
        );
      }

      const tx: FinanceTransactionRow = {
        id: txId,
        shopId: params.shopId,
        ownerShopId: acc.ownerShopId,
        accountId: acc.id,
        counterpartyAccountId: null,
        type: 'payout',
        direction: 'out',
        amount,
        transferId: null,
        category: params.category,
        paidTo,
        description: customDesc ?? `Payout to ${paidTo}`,
        notes,
        referenceId: txId,
        referenceType: 'payout',
        actorName: params.actor.actorName,
        actorRole: params.actor.actorRole,
        createdBy: params.actor.createdBy,
        occurredAt,
        createdAt: now,
        updatedAt: now,
      };
      const effects: FinanceTxRollbackEffect[] = [
        { txId, accountId: acc.id, direction: 'out', amount },
      ];

      await db.financeTransactions.put(tx);
      await adjustAccountBalancesInTx(effects, 1);

      queueId = await db.syncQueue.add({
        type: 'record_payout',
        payload: {
          p_id: txId,
          p_shop_id: params.shopId,
          p_account_id: acc.id,
          p_amount: amount,
          p_paid_to: paidTo,
          p_category: params.category,
          p_description: customDesc,
          p_notes: notes,
          p_occurred_at: occurredAt,
        },
        localRollback: { addedTxs: [tx], txEffects: effects },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return { txId, queueId };
}

/** Creates an expense paid from a finance account, updating Dexie and queueing atomically. */
export async function recordExpenseWithAccount(params: {
  shopId: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  accountId: string;
  actor: ActorMeta;
}): Promise<{ expenseId: string; txId: string; queueId: number }> {
  const amount = assertWholeRupees(params.amount, { label: 'Expense amount' });
  const expenseId = newFinanceId();
  const txId = newFinanceId();
  const now = new Date().toISOString();
  const expDate = params.expenseDate || now;

  let queueId = 0;
  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.expenses, db.syncQueue],
    async () => {
      const acc = await db.financeAccounts.get(params.accountId);
      if (!acc || acc.isArchived) throw new Error('Payment account not found or archived.');
      if (!canWriteFinanceAccount(acc, params.shopId, params.actor.actorRole === 'admin')) {
        throw new Error('You cannot pay expenses from the selected account.');
      }
      const available = Math.round(Number(acc.balance) || 0);
      if (amount > available) {
        throw new Error(
          `Insufficient balance in ${acc.name} (available: Rs ${available.toLocaleString()}).`,
        );
      }

      const expenseRow: ExpenseRow = {
        id: expenseId,
        shopId: params.shopId,
        category: params.category,
        description: params.description,
        amount,
        expenseDate: expDate,
        paidFromAccountId: acc.id,
        createdAtClient: expDate,
        createdAt: now,
        updatedAt: now,
        actorName: params.actor.actorName,
        actorRole: params.actor.actorRole,
        createdBy: params.actor.createdBy,
      };
      const tx: FinanceTransactionRow = {
        id: txId,
        shopId: params.shopId,
        ownerShopId: acc.ownerShopId,
        accountId: acc.id,
        counterpartyAccountId: null,
        type: 'expense',
        direction: 'out',
        amount,
        transferId: null,
        category: params.category,
        paidTo: null,
        description: params.description.trim() || `Expense: ${params.category || 'General'}`,
        notes: null,
        referenceId: expenseId,
        referenceType: 'expense',
        actorName: params.actor.actorName,
        actorRole: params.actor.actorRole,
        createdBy: params.actor.createdBy,
        occurredAt: expDate,
        createdAt: now,
        updatedAt: now,
      };
      const effects: FinanceTxRollbackEffect[] = [
        { txId, accountId: acc.id, direction: 'out', amount },
      ];

      await db.expenses.put(expenseRow);
      await db.financeTransactions.put(tx);
      await adjustAccountBalancesInTx(effects, 1);

      queueId = await db.syncQueue.add({
        type: 'record_expense',
        payload: {
          p_expense_id: expenseId,
          p_tx_id: txId,
          p_shop_id: params.shopId,
          p_category: params.category,
          p_description: params.description,
          p_amount: amount,
          p_expense_date: expDate,
          p_account_id: acc.id,
        },
        localRollback: {
          addedExpenseId: expenseId,
          addedTxs: [tx],
          txEffects: effects,
        },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return { expenseId, txId, queueId };
}

/** Updates an expense (including account reassignment or legacy unlinked expenses). */
export async function updateExpenseWithAccount(params: {
  shopId: string;
  expenseId: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  accountId: string | null;
  actor: ActorMeta;
  existingExpense?: ExpenseRow;
}): Promise<number> {
  const amount = assertWholeRupees(params.amount, { label: 'Expense amount' });
  const now = new Date().toISOString();
  const expDate = params.expenseDate || now;

  let queueId = 0;
  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.expenses, db.syncQueue],
    async () => {
      const existing =
        (await db.expenses.get(params.expenseId)) ?? params.existingExpense;
      if (!existing) throw new Error('Expense not found locally.');

      const oldAccId = existing.paidFromAccountId ?? null;
      const requestedAccId = params.accountId?.trim() || null;
      const targetAccId = requestedAccId ?? oldAccId;
      const oldAmt = Math.round(Number(existing.amount) || 0);
      const ledgerChanged = oldAccId !== targetAccId || oldAmt !== amount;

      const addedTxs: FinanceTransactionRow[] = [];
      const txEffects: FinanceTxRollbackEffect[] = [];
      let revTxId: string | null = null;
      let newTxId: string | null = null;

      if (oldAccId && ledgerChanged) {
        const oldAcc = await db.financeAccounts.get(oldAccId);
        revTxId = newFinanceId();
        if (oldAcc) {
          addedTxs.push({
            id: revTxId,
            shopId: params.shopId,
            ownerShopId: oldAcc.ownerShopId,
            accountId: oldAcc.id,
            counterpartyAccountId: null,
            type: 'expenseReversal',
            direction: 'in',
            amount: oldAmt,
            transferId: null,
            category: existing.category,
            paidTo: null,
            description: `Expense edited (reversed): ${existing.description || existing.category || ''}`,
            notes: null,
            referenceId: existing.id,
            referenceType: 'expenseReversal',
            actorName: params.actor.actorName,
            actorRole: params.actor.actorRole,
            createdBy: params.actor.createdBy,
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
          });
          txEffects.push({
            txId: revTxId,
            accountId: oldAcc.id,
            direction: 'in',
            amount: oldAmt,
          });
        }
      }

      if (targetAccId && (oldAccId === null || ledgerChanged)) {
        const targetAcc = await db.financeAccounts.get(targetAccId);
        if (!targetAcc || targetAcc.isArchived) {
          throw new Error('Target payment account not found or archived.');
        }
        if (!canWriteFinanceAccount(targetAcc, params.shopId, params.actor.actorRole === 'admin')) {
          throw new Error('You cannot assign expenses to the selected account.');
        }
        const effectiveAvailable =
          Math.round(Number(targetAcc.balance) || 0) +
          (oldAccId === targetAccId ? oldAmt : 0);
        if (amount > effectiveAvailable) {
          throw new Error(
            `Insufficient balance in ${targetAcc.name} (available: Rs ${effectiveAvailable.toLocaleString()}).`,
          );
        }

        newTxId = newFinanceId();
        addedTxs.push({
          id: newTxId,
          shopId: params.shopId,
          ownerShopId: targetAcc.ownerShopId,
          accountId: targetAcc.id,
          counterpartyAccountId: null,
          type: 'expense',
          direction: 'out',
          amount,
          transferId: null,
          category: params.category,
          paidTo: null,
          description: params.description.trim() || `Expense: ${params.category || 'General'}`,
          notes: null,
          referenceId: existing.id,
          referenceType: 'expense',
          actorName: params.actor.actorName,
          actorRole: params.actor.actorRole,
          createdBy: params.actor.createdBy,
          occurredAt: expDate,
          createdAt: now,
          updatedAt: now,
        });
        txEffects.push({
          txId: newTxId,
          accountId: targetAcc.id,
          direction: 'out',
          amount,
        });
      }

      const updatedExpense: ExpenseRow = {
        ...existing,
        category: params.category,
        description: params.description,
        amount,
        expenseDate: expDate,
        paidFromAccountId: targetAccId,
        actorName: params.actor.actorName,
        actorRole: params.actor.actorRole,
        updatedAt: now,
      };

      await db.expenses.put(updatedExpense);
      if (addedTxs.length) await db.financeTransactions.bulkPut(addedTxs);
      if (txEffects.length) await adjustAccountBalancesInTx(txEffects, 1);

      queueId = await db.syncQueue.add({
        type: 'update_expense',
        payload: {
          p_expense_id: existing.id,
          p_shop_id: params.shopId,
          p_category: params.category,
          p_description: params.description,
          p_amount: amount,
          p_expense_date: expDate,
          p_account_id: targetAccId,
          p_rev_tx_id: revTxId,
          p_new_tx_id: newTxId,
        },
        localRollback: {
          expenseBackup: existing,
          updatedExpense,
          addedTxs,
          txEffects,
        },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return queueId;
}

/** Deletes an expense and refunds its paidFromAccountId (if linked) in Dexie and queue. */
export async function deleteExpenseWithAccount(params: {
  shopId: string;
  expenseId: string;
  actor: ActorMeta;
  existingExpense?: ExpenseRow;
}): Promise<number> {
  const now = new Date().toISOString();
  let queueId = 0;

  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.expenses, db.syncQueue],
    async () => {
      const existing =
        (await db.expenses.get(params.expenseId)) ?? params.existingExpense;
      if (!existing) throw new Error('Expense not found locally.');

      const addedTxs: FinanceTransactionRow[] = [];
      const txEffects: FinanceTxRollbackEffect[] = [];
      let revTxId: string | null = null;

      if (existing.paidFromAccountId) {
        const acc = await db.financeAccounts.get(existing.paidFromAccountId);
        revTxId = `rev:exp:${existing.id}:${newFinanceId().slice(0, 8)}`;
        const amt = Math.round(Number(existing.amount) || 0);
        if (acc && amt > 0) {
          addedTxs.push({
            id: revTxId,
            shopId: params.shopId,
            ownerShopId: acc.ownerShopId,
            accountId: acc.id,
            counterpartyAccountId: null,
            type: 'expenseReversal',
            direction: 'in',
            amount: amt,
            transferId: null,
            category: existing.category,
            paidTo: null,
            description: `Expense deleted (reversed): ${existing.description || existing.category || ''}`,
            notes: null,
            referenceId: existing.id,
            referenceType: 'expenseReversal',
            actorName: params.actor.actorName,
            actorRole: params.actor.actorRole,
            createdBy: params.actor.createdBy,
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
          });
          txEffects.push({ txId: revTxId, accountId: acc.id, direction: 'in', amount: amt });
        }
      }

      await db.expenses.delete(existing.id);
      if (addedTxs.length) await db.financeTransactions.bulkPut(addedTxs);
      if (txEffects.length) await adjustAccountBalancesInTx(txEffects, 1);

      queueId = await db.syncQueue.add({
        type: 'delete_expense',
        payload: {
          p_expense_id: existing.id,
          p_shop_id: params.shopId,
          p_rev_tx_id: revTxId,
        },
        localRollback: {
          expenseBackup: existing,
          addedTxs,
          txEffects,
        },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return queueId;
}

/**
 * Records a whole-rupee customer credit payment offline/online:
 * updates customers.creditBalance + Shop Cash or Primary Online balance atomically,
 * and enqueues record_credit_payment.
 */
export async function recordCreditPayment(params: {
  shopId: string;
  customerId: string;
  amount: number;
  paymentMethod: 'cash' | 'online';
  description?: string | null;
  actor: ActorMeta;
  customerFallback?: Customer;
}): Promise<{ creditId: string; txId: string; queueId: number }> {
  const amount = assertWholeRupees(params.amount, { label: 'Payment amount' });
  const creditId = newFinanceId();
  const txId = newFinanceId();
  const now = new Date().toISOString();
  const targetType: FinanceAccountType =
    params.paymentMethod === 'online' ? 'primaryOnline' : 'shopCash';
  const desc = params.description?.trim() || null;

  let queueId = 0;
  await db.transaction(
    'rw',
    [db.customers, db.financeAccounts, db.financeTransactions, db.syncQueue],
    async () => {
      const customer =
        (await db.customers.get(params.customerId)) ?? params.customerFallback;
      if (!customer || customer.shopId !== params.shopId) {
        throw new Error('Customer not found locally.');
      }

      const nextBalance = Math.max(
        0,
        Math.round((Number(customer.creditBalance) || 0) - amount),
      );
      await db.customers.put({ ...customer, creditBalance: nextBalance, updatedAt: now });

      const targetAccount = await db.financeAccounts
        .where('ownerShopId')
        .equals(params.shopId)
        .filter((a) => a.type === targetType && !a.isArchived)
        .first();

      const addedTxs: FinanceTransactionRow[] = [];
      const txEffects: FinanceTxRollbackEffect[] = [];
      if (targetAccount) {
        const tx: FinanceTransactionRow = {
          id: txId,
          shopId: params.shopId,
          ownerShopId: targetAccount.ownerShopId,
          accountId: targetAccount.id,
          counterpartyAccountId: null,
          type: 'creditPayment',
          direction: 'in',
          amount,
          transferId: null,
          category: null,
          paidTo: null,
          description: desc ?? `Udhaar payment (${params.paymentMethod}): ${customer.name}`,
          notes: null,
          referenceId: creditId,
          referenceType: 'credit',
          actorName: params.actor.actorName,
          actorRole: params.actor.actorRole,
          createdBy: params.actor.createdBy,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        };
        addedTxs.push(tx);
        txEffects.push({ txId, accountId: targetAccount.id, direction: 'in', amount });
        await db.financeTransactions.put(tx);
        await adjustAccountBalancesInTx(txEffects, 1);
      }

      queueId = await db.syncQueue.add({
        type: 'record_credit_payment',
        payload: {
          p_credit_id: creditId,
          p_tx_id: txId,
          p_shop_id: params.shopId,
          p_customer_id: customer.id,
          p_amount: amount,
          p_payment_method: params.paymentMethod,
          p_description: desc,
        },
        localRollback: {
          creditCustomerId: customer.id,
          creditPaymentAmount: amount,
          addedTxs,
          txEffects,
        },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return { creditId, txId, queueId };
}

/** Appends a compensating adjustment entry reversing a prior finance transaction (admin only). */
export async function reverseFinanceTransaction(params: {
  shopId: string;
  originalTxId: string;
  reason: string;
  occurredAt?: string;
  actor: ActorMeta;
}): Promise<{ txId: string; queueId: number }> {
  if (params.actor.actorRole !== 'admin') {
    throw new Error('Only the shop admin can reverse finance transactions.');
  }
  const reason = params.reason.trim();
  if (!reason) throw new Error('A reason is required to reverse a transaction.');

  const txId = newFinanceId();
  const now = new Date().toISOString();
  const occurredAt = params.occurredAt || now;
  let queueId = 0;

  await db.transaction(
    'rw',
    [db.financeAccounts, db.financeTransactions, db.syncQueue],
    async () => {
      const orig = await db.financeTransactions.get(params.originalTxId);
      if (!orig) throw new Error('Original transaction not found.');
      if (NON_REVERSIBLE_TX_TYPES.has(orig.type)) {
        throw new Error(`Transaction type "${orig.type}" cannot be reversed.`);
      }

      const alreadyReversed = await db.financeTransactions
        .where('referenceId')
        .equals(orig.id)
        .filter((row) => row.referenceType === 'adjustment')
        .first();
      if (alreadyReversed) {
        throw new Error('This transaction has already been reversed.');
      }

      const acc = await db.financeAccounts.get(orig.accountId);
      if (!acc || acc.isArchived) throw new Error('Target account not found or archived.');
      if (!canWriteFinanceAccount(acc, params.shopId, true)) {
        throw new Error('You do not have permission to adjust this account.');
      }

      const reverseDir: FinanceDirection = orig.direction === 'in' ? 'out' : 'in';
      const amt = Math.round(Number(orig.amount) || 0);
      const adjTx: FinanceTransactionRow = {
        id: txId,
        shopId: params.shopId,
        ownerShopId: acc.ownerShopId,
        accountId: acc.id,
        counterpartyAccountId: null,
        type: 'adjustment',
        direction: reverseDir,
        amount: amt,
        transferId: null,
        category: null,
        paidTo: null,
        description: `Adjustment (reversal of ${orig.type}): ${orig.description || orig.id}`,
        notes: reason,
        referenceId: orig.id,
        referenceType: 'adjustment',
        actorName: params.actor.actorName,
        actorRole: params.actor.actorRole,
        createdBy: params.actor.createdBy,
        occurredAt,
        createdAt: now,
        updatedAt: now,
      };
      const effects: FinanceTxRollbackEffect[] = [
        { txId, accountId: acc.id, direction: reverseDir, amount: amt },
      ];

      await db.financeTransactions.put(adjTx);
      await adjustAccountBalancesInTx(effects, 1);

      queueId = await db.syncQueue.add({
        type: 'reverse_finance_transaction',
        payload: {
          p_id: txId,
          p_shop_id: params.shopId,
          p_original_tx_id: orig.id,
          p_reason: reason,
          p_occurred_at: occurredAt,
        },
        localRollback: { addedTxs: [adjTx], txEffects: effects },
        status: 'pending',
        createdAt: now,
        retryCount: 0,
      });
    },
  );

  return { txId, queueId };
}
