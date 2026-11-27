import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Customer,
  ExpenseRow,
  FinanceAccountRow,
  FinanceLocalRollback,
  FinanceTransactionRow,
  LinkedShopFinanceSummary,
  SyncOperation,
} from '../db';
import {
  buildOptimisticCheckoutLedger,
  computeCombinedTotal,
  deriveAccountBalance,
  reapplyOptimisticLocalOp,
  reconcileFinanceAccounts,
  referencedAccountIds,
  revertOptimisticLocalOp,
  sendableNow,
  summarizeVisibleFinanceView,
  transferFundsInStore,
  type FinanceLocalStore,
} from '../financeCore';

const NOW = '2026-11-27T04:00:00.000Z';

function makeAccount(overrides: Partial<FinanceAccountRow> & { id: string }): FinanceAccountRow {
  return {
    shopId: 'shop-a',
    ownerShopId: 'shop-a',
    name: 'Account',
    type: 'shopCash',
    bankName: null,
    accountNumber: null,
    balance: 0,
    isOverdrawn: false,
    isArchived: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTx(
  overrides: Partial<FinanceTransactionRow> & {
    id: string;
    accountId: string;
    direction: 'in' | 'out';
    amount: number;
  },
): FinanceTransactionRow {
  return {
    shopId: 'shop-a',
    ownerShopId: 'shop-a',
    counterpartyAccountId: null,
    type: 'sale',
    transferId: null,
    category: null,
    paidTo: null,
    description: null,
    notes: null,
    referenceId: null,
    referenceType: null,
    actorName: 'Admin',
    actorRole: 'admin',
    createdBy: 'shop-a',
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMemoryStore(seed: {
  accounts?: FinanceAccountRow[];
  txs?: FinanceTransactionRow[];
  expenses?: ExpenseRow[];
  customers?: Customer[];
  queue?: SyncOperation[];
} = {}) {
  const accounts = new Map((seed.accounts ?? []).map((a) => [a.id, { ...a }]));
  const txs = new Map((seed.txs ?? []).map((t) => [t.id, { ...t }]));
  const expenses = new Map((seed.expenses ?? []).map((e) => [e.id, { ...e }]));
  const customers = new Map((seed.customers ?? []).map((c) => [c.id, { ...c }]));
  const queue = new Map((seed.queue ?? []).map((q) => [q.id ?? 1, { ...q }]));

  let nextQueueId = Math.max(0, ...(seed.queue ?? []).map((q) => q.id ?? 0)) + 1;
  const store: FinanceLocalStore = {
    getAccount: async (id) => accounts.get(id),
    getAccounts: async (ids) => ids.map((id) => accounts.get(id)),
    putAccounts: async (rows) => {
      for (const r of rows) accounts.set(r.id, { ...r });
    },
    deleteAccount: async (id) => {
      accounts.delete(id);
    },
    getTransactions: async (ids) => ids.map((id) => txs.get(id)),
    putTransactions: async (rows) => {
      for (const r of rows) txs.set(r.id, { ...r });
    },
    deleteTransactions: async (ids) => {
      for (const id of ids) txs.delete(id);
    },
    putExpense: async (row) => {
      expenses.set(row.id, { ...row });
    },
    deleteExpense: async (id) => {
      expenses.delete(id);
    },
    getCustomer: async (id) => customers.get(id),
    updateCustomerCredit: async (id, creditBalance) => {
      const c = customers.get(id);
      if (c) customers.set(id, { ...c, creditBalance });
    },
    enqueueOperation: async (op) => {
      const id = nextQueueId++;
      queue.set(id, { ...op, id });
      return id;
    },
    markQueueRolledBack: async (opId, rb: FinanceLocalRollback) => {
      const op = queue.get(opId);
      if (op) queue.set(opId, { ...op, localRollback: rb });
    },
    runTransaction: (fn) => fn(),
  };

  return { store, accounts, txs, expenses, customers, queue };
}

test('deriveAccountBalance sums only matching account transactions and allows negative balances', () => {
  const txs: FinanceTransactionRow[] = [
    makeTx({ id: 't1', accountId: 'acc-1', direction: 'in', amount: 1500 }),
    makeTx({ id: 't2', accountId: 'acc-1', direction: 'out', amount: 2200 }),
    makeTx({ id: 't3', accountId: 'acc-2', direction: 'in', amount: 9000 }),
    makeTx({ id: 't4', accountId: 'acc-1', direction: 'in', amount: 200 }),
  ];

  assert.equal(deriveAccountBalance(txs, 'acc-1'), -500);
  assert.equal(deriveAccountBalance(txs, 'acc-2'), 9000);
  assert.equal(deriveAccountBalance(txs, 'missing'), 0);
});

test('reconcileFinanceAccounts flags balance mismatches and ignores accounts with active pending ops', () => {
  const accounts = [
    makeAccount({ id: 'cash', name: 'Shop Cash', balance: 1000 }),
    makeAccount({ id: 'bank-1', name: 'Meezan', type: 'secondaryBank', balance: 5000 }),
    makeAccount({ id: 'bank-pending', name: 'HBL', type: 'secondaryBank', balance: 2500 }),
  ];
  const txs = [
    makeTx({ id: 't1', accountId: 'cash', direction: 'in', amount: 1000 }),
    makeTx({ id: 't2', accountId: 'bank-1', direction: 'in', amount: 4200 }), // 800 mismatch!
    makeTx({ id: 't3', accountId: 'bank-pending', direction: 'in', amount: 2000 }),
  ];
  const queueOps: SyncOperation[] = [
    {
      id: 1,
      type: 'record_opening_balance',
      payload: { p_account_id: 'bank-pending' },
      localRollback: {
        txEffects: [{ txId: 't-pend', accountId: 'bank-pending', direction: 'in', amount: 500 }],
      },
      status: 'pending',
      createdAt: NOW,
      retryCount: 0,
    },
  ];

  const mismatches = reconcileFinanceAccounts(accounts, txs, queueOps);
  assert.equal(mismatches.length, 1);
  assert.deepEqual(mismatches[0], {
    accountId: 'bank-1',
    accountName: 'Meezan',
    ownerShopId: 'shop-a',
    cachedBalance: 5000,
    ledgerBalance: 4200,
    difference: 800,
  });

  // Once marked failed+rolledBack, bank-pending is no longer excluded from reconcile check
  const failedOps: SyncOperation[] = [
    { ...queueOps[0], status: 'failed', localRollback: { ...queueOps[0].localRollback, rolledBack: true } },
  ];
  assert.equal(reconcileFinanceAccounts(accounts, txs, failedOps).length, 2);
});

test('computeCombinedTotal dedupes shared accounts, excludes archived, and enforces cashier visibility', () => {
  const accounts = [
    makeAccount({ id: 'cash-a', ownerShopId: 'shop-a', type: 'shopCash', balance: 1000 }),
    makeAccount({ id: 'pri-a', ownerShopId: 'shop-a', type: 'primaryOnline', balance: 2500 }),
    makeAccount({ id: 'bank-a', ownerShopId: 'shop-a', type: 'secondaryBank', balance: 4000 }),
    makeAccount({ id: 'bank-b', shopId: 'shop-b', ownerShopId: 'shop-b', type: 'secondaryBank', balance: 3000 }),
    makeAccount({ id: 'bank-b', shopId: 'shop-a', ownerShopId: 'shop-b', type: 'secondaryBank', balance: 3000 }), // duplicate id
    makeAccount({ id: 'bank-arch', ownerShopId: 'shop-a', type: 'secondaryBank', balance: 9999, isArchived: true }),
    makeAccount({ id: 'cash-b', shopId: 'shop-b', ownerShopId: 'shop-b', type: 'shopCash', balance: 50000 }), // not direct table row for another shop
  ];
  const linked: LinkedShopFinanceSummary[] = [
    {
      shopId: 'shop-b',
      shopName: 'Branch B',
      shopCashBalance: 600,
      shopCashOverdrawn: false,
      primaryOnlineBalance: 1400,
      primaryOnlineName: 'Branch B Online',
      primaryOnlineOverdrawn: false,
      fetchedAt: NOW,
    },
    {
      shopId: 'shop-b',
      shopName: 'Branch B dup',
      shopCashBalance: 600,
      shopCashOverdrawn: false,
      primaryOnlineBalance: 1400,
      primaryOnlineName: 'Branch B Online',
      primaryOnlineOverdrawn: false,
      fetchedAt: NOW,
    },
  ];

  const adminTotal = computeCombinedTotal(accounts, linked, 'shop-a', true);
  assert.deepEqual(adminTotal, {
    ownCash: 1000,
    ownPrimary: 2500,
    accessibleBanks: 7000, // 4000 + 3000 counted once
    linkedCashAndPrimary: 2000, // 600 + 1400 counted once
    combinedTotal: 12500,
  });

  const cashierTotal = computeCombinedTotal(accounts, linked, 'shop-a', false);
  assert.deepEqual(cashierTotal, {
    ownCash: 1000,
    ownPrimary: 0,
    accessibleBanks: 0,
    linkedCashAndPrimary: 0,
    combinedTotal: 1000,
  });
});

test('revertOptimisticLocalOp and reapplyOptimisticLocalOp cleanly reverse and restore account, ledger, expense, and credit state', async () => {
  const acc = makeAccount({ id: 'cash-a', balance: -200, isOverdrawn: true });
  const tx = makeTx({ id: 'tx-pay-1', accountId: 'cash-a', direction: 'out', amount: 500, type: 'payout' });
  const expense: ExpenseRow = {
    id: 'exp-1',
    shopId: 'shop-a',
    category: 'Tea',
    description: 'Tea',
    amount: 500,
    expenseDate: NOW,
    paidFromAccountId: 'cash-a',
    createdAtClient: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    actorName: 'Admin',
    actorRole: 'admin',
    createdBy: 'shop-a',
  };
  const customer: Customer = {
    id: 'cust-1',
    shopId: 'shop-a',
    name: 'Ali',
    phone: null,
    email: null,
    creditBalance: 350,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: NOW,
    createdAtClient: NOW,
    updatedAt: NOW,
  };

  const op: SyncOperation = {
    id: 42,
    type: 'record_expense',
    payload: { p_expense_id: 'exp-1', p_account_id: 'cash-a', p_amount: 500 },
    localRollback: {
      addedExpenseId: 'exp-1',
      addedTxs: [tx],
      txEffects: [{ txId: 'tx-pay-1', accountId: 'cash-a', direction: 'out', amount: 500 }],
      creditCustomerId: 'cust-1',
      creditPaymentAmount: 150,
    },
    status: 'failed',
    createdAt: NOW,
    retryCount: 10,
  };

  const mem = makeMemoryStore({
    accounts: [acc],
    txs: [tx],
    expenses: [expense],
    customers: [customer],
    queue: [op],
  });

  await revertOptimisticLocalOp(op, {}, mem.store);
  assert.equal(mem.accounts.get('cash-a')?.balance, 300);
  assert.equal(mem.accounts.get('cash-a')?.isOverdrawn, false);
  assert.equal(mem.txs.has('tx-pay-1'), false);
  assert.equal(mem.expenses.has('exp-1'), false);
  assert.equal(mem.customers.get('cust-1')?.creditBalance, 500);
  assert.equal(mem.queue.get(42)?.localRollback?.rolledBack, true);

  // Calling revert twice does not double-adjust balances
  await revertOptimisticLocalOp(mem.queue.get(42)!, {}, mem.store);
  assert.equal(mem.accounts.get('cash-a')?.balance, 300);
  assert.equal(mem.customers.get('cust-1')?.creditBalance, 500);

  // Retry re-applies the optimistic tx, balance delta, and customer adjustment cleanly
  await reapplyOptimisticLocalOp(mem.queue.get(42)!, mem.store);
  assert.equal(mem.accounts.get('cash-a')?.balance, -200);
  assert.equal(mem.accounts.get('cash-a')?.isOverdrawn, true);
  assert.equal(mem.txs.has('tx-pay-1'), true);
  assert.equal(mem.customers.get('cust-1')?.creditBalance, 350);
  assert.equal(mem.queue.get(42)?.localRollback?.rolledBack, false);
});

test('sendableNow holds back operations referencing an earlier pending or failed create_finance_account', () => {
  const createOp: SyncOperation = {
    id: 1,
    type: 'create_finance_account',
    payload: { p_id: 'bank-new', p_shop_id: 'shop-a', p_name: 'SadaPay', p_type: 'secondaryBank' },
    status: 'pending',
    nextAttemptAt: Date.now() + 30_000, // temporarily refused & resting on backoff
    lastOutcome: 'refused',
    createdAt: NOW,
    retryCount: 1,
  };
  const dependentExpense: SyncOperation = {
    id: 2,
    type: 'record_expense',
    payload: { p_expense_id: 'exp-new', p_shop_id: 'shop-a', p_account_id: 'bank-new', p_amount: 100 },
    status: 'pending',
    createdAt: NOW,
    retryCount: 0,
  };
  const independentCheckout: SyncOperation = {
    id: 3,
    type: 'process_checkout',
    payload: { p_shop_id: 'shop-a', p_sale_data: { id: 'sale-1' } },
    status: 'pending',
    createdAt: NOW,
    retryCount: 0,
  };

  const ready = sendableNow([createOp, dependentExpense, independentCheckout], Date.now());
  assert.deepEqual(ready.map((o) => o.id), [3]);
  assert.deepEqual(referencedAccountIds(dependentExpense), ['bank-new']);

  // Also holds back if create_finance_account is already marked failed in full queue
  const failedCreate = { ...createOp, status: 'failed' as const, nextAttemptAt: 0 };
  const readyWithFailed = sendableNow(
    [dependentExpense, independentCheckout],
    Date.now(),
    [failedCreate, dependentExpense, independentCheckout],
  );
  assert.deepEqual(readyWithFailed.map((o) => o.id), [3]);
});

test('revertOptimisticLocalOp handles partial apply without double-reversing missing transactions', async () => {
  const cashAcc = makeAccount({ id: 'cash-a', balance: 1500 });
  const bankAcc = makeAccount({ id: 'bank-a', type: 'secondaryBank', balance: 5000 });
  // Only the inflow tx ('tx-in') exists locally; 'tx-out' was not applied / already absent
  const inTx = makeTx({ id: 'tx-in', accountId: 'bank-a', direction: 'in', amount: 400, type: 'transferIn' });
  const op: SyncOperation = {
    id: 77,
    type: 'transfer_funds',
    payload: { p_transfer_id: 'tr-partial' },
    localRollback: {
      txEffects: [
        { txId: 'tx-out', accountId: 'cash-a', direction: 'out', amount: 400 },
        { txId: 'tx-in', accountId: 'bank-a', direction: 'in', amount: 400 },
      ],
    },
    status: 'failed',
    createdAt: NOW,
    retryCount: 10,
  };

  const mem = makeMemoryStore({ accounts: [cashAcc, bankAcc], txs: [inTx], queue: [op] });
  await revertOptimisticLocalOp(op, {}, mem.store);

  // cash-a was NOT touched since tx-out was missing; bank-a had tx-in reversed cleanly
  assert.equal(mem.accounts.get('cash-a')?.balance, 1500);
  assert.equal(mem.accounts.get('bank-a')?.balance, 4600);
  assert.equal(mem.txs.has('tx-in'), false);
  assert.equal(mem.queue.get(77)?.localRollback?.rolledBack, true);
});

test('retry after rollback restores created account with opening balance and edited expense snapshot', async () => {
  const createdBank = makeAccount({ id: 'bank-new', name: 'Easypaisa', type: 'secondaryBank', balance: 2500 });
  const openTx = makeTx({
    id: 'bank-new:opening',
    accountId: 'bank-new',
    direction: 'in',
    amount: 2500,
    type: 'opening',
  });
  const createOp: SyncOperation = {
    id: 88,
    type: 'create_finance_account',
    payload: { p_id: 'bank-new', p_opening_balance: 2500 },
    localRollback: {
      addedAccount: { ...createdBank, balance: 0, isOverdrawn: false },
      addedTxs: [openTx],
      txEffects: [{ txId: 'bank-new:opening', accountId: 'bank-new', direction: 'in', amount: 2500 }],
    },
    status: 'failed',
    createdAt: NOW,
    retryCount: 10,
  };

  const origExp: ExpenseRow = {
    id: 'exp-edit',
    shopId: 'shop-a',
    category: 'Utilities',
    description: 'Old bill',
    amount: 300,
    expenseDate: NOW,
    paidFromAccountId: 'cash-a',
    createdAtClient: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    actorName: 'Admin',
    actorRole: 'admin',
    createdBy: 'shop-a',
  };
  const editedExp: ExpenseRow = { ...origExp, description: 'New bill', amount: 450 };
  const editOp: SyncOperation = {
    id: 89,
    type: 'update_expense',
    payload: { p_expense_id: 'exp-edit' },
    localRollback: {
      expenseBackup: origExp,
      updatedExpense: editedExp,
    },
    status: 'failed',
    createdAt: NOW,
    retryCount: 10,
  };

  const mem = makeMemoryStore({
    accounts: [createdBank],
    txs: [openTx],
    expenses: [editedExp],
    queue: [createOp, editOp],
  });

  await revertOptimisticLocalOp(mem.queue.get(88)!, {}, mem.store);
  await revertOptimisticLocalOp(mem.queue.get(89)!, {}, mem.store);
  assert.equal(mem.accounts.has('bank-new'), false);
  assert.equal(mem.txs.has('bank-new:opening'), false);
  assert.equal(mem.expenses.get('exp-edit')?.amount, 300);

  await reapplyOptimisticLocalOp(mem.queue.get(88)!, mem.store);
  await reapplyOptimisticLocalOp(mem.queue.get(89)!, mem.store);
  assert.equal(mem.accounts.get('bank-new')?.balance, 2500);
  assert.equal(mem.txs.has('bank-new:opening'), true);
  assert.equal(mem.expenses.get('exp-edit')?.amount, 450);
  assert.equal(mem.queue.get(88)?.localRollback?.rolledBack, false);
  assert.equal(mem.queue.get(89)?.localRollback?.rolledBack, false);
});

test('transferFundsInStore transfers from own shopCash to a shared secondaryBank and updates combined total', async () => {
  const cashA = makeAccount({ id: 'cash-a', ownerShopId: 'shop-a', name: 'Shop Cash', type: 'shopCash', balance: 5000 });
  const sharedBankB = makeAccount({
    id: 'bank-b',
    shopId: 'shop-a',
    ownerShopId: 'shop-b',
    name: 'Shared Alfalah',
    type: 'secondaryBank',
    balance: 2000,
  });

  const mem = makeMemoryStore({ accounts: [cashA, sharedBankB] });
  const { transferId, queueId } = await transferFundsInStore(
    {
      shopId: 'shop-a',
      fromAccountId: 'cash-a',
      toAccountId: 'bank-b',
      amount: 1200,
      description: 'Cash deposit to shared bank',
      actor: { createdBy: 'shop-a', actorRole: 'admin', actorName: 'Owner A' },
    },
    mem.store,
  );

  assert.ok(transferId);
  assert.equal(queueId, 1);
  assert.equal(mem.accounts.get('cash-a')?.balance, 3800);
  assert.equal(mem.accounts.get('bank-b')?.balance, 3200);

  const txList = [...mem.txs.values()];
  const outTx = txList.find((t) => t.direction === 'out');
  const inTx = txList.find((t) => t.direction === 'in');
  assert.equal(outTx?.ownerShopId, 'shop-a');
  assert.equal(outTx?.accountId, 'cash-a');
  assert.equal(inTx?.ownerShopId, 'shop-b');
  assert.equal(inTx?.accountId, 'bank-b');
  assert.equal(outTx?.transferId, transferId);
  assert.equal(inTx?.transferId, transferId);

  const totals = computeCombinedTotal([...mem.accounts.values()], [], 'shop-a', true);
  assert.equal(totals.ownCash, 3800);
  assert.equal(totals.accessibleBanks, 3200);
  assert.equal(totals.combinedTotal, 7000);

  // Overdraft blocked locally in transferFundsInStore
  await assert.rejects(
    () =>
      transferFundsInStore(
        {
          shopId: 'shop-a',
          fromAccountId: 'cash-a',
          toAccountId: 'bank-b',
          amount: 4000,
          actor: { createdBy: 'shop-a', actorRole: 'admin', actorName: 'Owner A' },
        },
        mem.store,
      ),
    /Insufficient balance/,
  );

  // Local checkout rounding matches SQL round(greatest(x, 0))
  const checkout = buildOptimisticCheckoutLedger({
    shopId: 'shop-a',
    saleId: 'sale-round-1',
    paymentMethod: 'split',
    totalAmount: 100.6,
    splitAmounts: { cash: 40.5, online: 60.4 },
    actor: { createdBy: 'shop-a', actorRole: 'admin', actorName: 'Owner A' },
    cashAccount: cashA,
    primaryOnlineAccount: makeAccount({ id: 'pri-a', type: 'primaryOnline', balance: 0 }),
    occurredAt: NOW,
  });
  assert.equal(checkout.txs.find((t) => t.id === 'sale-round-1:cash')?.amount, 41);
  assert.equal(checkout.txs.find((t) => t.id === 'sale-round-1:online')?.amount, 60);
});

test('summarizeVisibleFinanceView gives identical Dashboard and Manage Cash combinedTotal and shared bank owner names', () => {
  const accounts: FinanceAccountRow[] = [
    makeAccount({ id: 'cash-a', ownerShopId: 'shop-a', name: 'Shop Cash', type: 'shopCash', balance: 1500 }),
    makeAccount({ id: 'pri-a', ownerShopId: 'shop-a', name: 'Primary Online', type: 'primaryOnline', balance: 3500 }),
    makeAccount({ id: 'bank-a', ownerShopId: 'shop-a', name: 'Own Bank', type: 'secondaryBank', balance: 2000 }),
    makeAccount({ id: 'bank-arch', ownerShopId: 'shop-a', name: 'Old Bank', type: 'secondaryBank', balance: 9000, isArchived: true }),
    makeAccount({ id: 'bank-b', shopId: 'shop-b', ownerShopId: 'shop-b', name: 'Meezan Shared', type: 'secondaryBank', balance: -300, isOverdrawn: true }),
  ];
  const txs: FinanceTransactionRow[] = [
    makeTx({ id: 't1', accountId: 'cash-a', direction: 'in', amount: 1500 }),
    makeTx({ id: 't2', accountId: 'pri-a', direction: 'in', amount: 3500 }),
    makeTx({ id: 't3', accountId: 'bank-a', direction: 'in', amount: 2000 }),
    makeTx({ id: 't4', accountId: 'bank-b', direction: 'out', amount: 300 }),
  ];
  const linked: LinkedShopFinanceSummary[] = [
    {
      shopId: 'shop-b',
      shopName: 'Lahore Branch',
      shopCashBalance: 800,
      shopCashOverdrawn: false,
      primaryOnlineBalance: 1200,
      primaryOnlineName: 'Lahore Online',
      primaryOnlineOverdrawn: false,
      fetchedAt: NOW,
    },
  ];

  // Simulate Dashboard passing raw Dexie data vs active-filtered subset
  const dashboardView = summarizeVisibleFinanceView({
    accounts,
    transactions: txs,
    linkedSummaries: linked,
    shopId: 'shop-a',
    isAdmin: true,
  });
  const manageCashView = summarizeVisibleFinanceView({
    accounts,
    transactions: txs,
    linkedSummaries: linked,
    shopId: 'shop-a',
    isAdmin: true,
  });
  const activeOnlyTotal = computeCombinedTotal(
    accounts.filter((a) => !a.isArchived),
    linked,
    'shop-a',
    true,
  );

  // 1500 + 3500 + 2000 - 300 + (800 + 1200) = 8700
  assert.equal(dashboardView.combinedTotals.combinedTotal, 8700);
  assert.equal(dashboardView.combinedTotals.combinedTotal, manageCashView.combinedTotals.combinedTotal);
  assert.equal(dashboardView.combinedTotals.combinedTotal, activeOnlyTotal.combinedTotal);
  assert.equal(dashboardView.shopLabelById.get('shop-b'), 'Lahore Branch');
  assert.equal(dashboardView.mismatches.length, 0);

  // Cashier view isolates Shop Cash only (1500)
  const cashierView = summarizeVisibleFinanceView({
    accounts,
    transactions: txs,
    linkedSummaries: linked,
    shopId: 'shop-a',
    isAdmin: false,
  });
  assert.equal(cashierView.combinedTotals.combinedTotal, 1500);
  assert.equal(cashierView.activeAccounts.length, 1);
  assert.equal(cashierView.linkedSummaries.length, 0);
});


