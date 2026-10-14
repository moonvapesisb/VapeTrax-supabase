import { supabase } from './supabase';
import { FinanceAccount, FinanceTransaction, AccountCategory } from '../types/finance';

const defaultDates = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

const SYS_ACCOUNTS: FinanceAccount[] = [
  { id: 'SYS_CASH', shopId: 'system', name: 'Cash Drawer', category: 'ASSET', balance: 0, ...defaultDates },
  { id: 'SYS_BANK', shopId: 'system', name: 'Bank Account', category: 'ASSET', balance: 0, ...defaultDates },
  { id: 'SYS_REV', shopId: 'system', name: 'Sales Revenue', category: 'REVENUE', balance: 0, ...defaultDates },
  { id: 'SYS_EXP', shopId: 'system', name: 'Shop Expenses', category: 'EXPENSE', balance: 0, ...defaultDates },
  { id: 'SYS_REC', shopId: 'system', name: 'Accounts Receivable', category: 'ASSET', balance: 0, ...defaultDates }
];

export const getAggregatedFinancialData = async (shopId: string) => {
  // 1. Fetch Manual Accounts
  const { data: accData } = await supabase.from('finance_accounts').select('*').eq('shopId', shopId);
  const manualAccounts = (accData || []).map(d => ({ id: d.id, ...d } as FinanceAccount));
  
  const allAccounts = [...SYS_ACCOUNTS.map(a => ({...a, shopId})), ...manualAccounts];
  const balances: Record<string, number> = {};
  allAccounts.forEach(a => balances[a.id] = 0);

  // 2. Fetch Sales
  const { data: salesData } = await supabase.from('sales').select('*').eq('shopId', shopId);
  const salesSnap = salesData || [];
  
  // 3. Fetch App Expenses
  const { data: expData } = await supabase.from('expenses').select('*').eq('shopId', shopId);
  const expSnap = expData || [];

  // 4. Fetch Manual Finance Transactions
  const { data: txData } = await supabase.from('finance_transactions').select('*').eq('shopId', shopId);
  const txSnap = txData || [];

  const allTransactions: FinanceTransaction[] = [];

  // Generate Virtual TX for Sales
  salesSnap.forEach(sale => {
    const id = sale.id;
    const date = sale.saleDate;
    
    if (sale.paymentMethod === 'split') {
       const split = sale.splitAmounts;
       if (split.cash > 0) allTransactions.push({ id: `vt_s_cash_${id}`, shopId, date, description: `Split Sale (Cash)`, type: 'SALE', amount: split.cash, fromAccountId: 'SYS_REV', toAccountId: 'SYS_CASH', createdAt: date });
       if (split.online > 0) allTransactions.push({ id: `vt_s_bank_${id}`, shopId, date, description: `Split Sale (Online)`, type: 'SALE', amount: split.online, fromAccountId: 'SYS_REV', toAccountId: 'SYS_BANK', createdAt: date });
       if (split.credit > 0) allTransactions.push({ id: `vt_s_cred_${id}`, shopId, date, description: `Split Sale (Credit)`, type: 'SALE', amount: split.credit, fromAccountId: 'SYS_REV', toAccountId: 'SYS_REC', createdAt: date });
    } else {
       let toId = 'SYS_CASH';
       if (sale.paymentMethod === 'online') toId = 'SYS_BANK';
       if (sale.paymentMethod === 'credit') toId = 'SYS_REC';
       allTransactions.push({
         id: `vt_s_${id}`, shopId, date,
         description: `Sale #${id.slice(-6).toUpperCase()}`,
         type: 'SALE', amount: sale.totalAmount || 0,
         fromAccountId: 'SYS_REV', toAccountId: toId, createdAt: date
       });
    }
  });

  // Generate Virtual TX for App Expenses
  expSnap.forEach(exp => {
    const id = exp.id;
    allTransactions.push({
      id: `vt_e_${id}`, shopId, date: exp.expenseDate,
      description: exp.description || `App Expense`,
      type: 'EXPENSE', amount: exp.amount || 0,
      fromAccountId: 'SYS_CASH', toAccountId: 'SYS_EXP', createdAt: exp.expenseDate
    });
  });

  // Add Manual Transactions (Vendors, Loans, etc.)
  txSnap.forEach(d => {
    allTransactions.push({ ...d } as FinanceTransaction);
  });

  // Compute Balances
  allTransactions.forEach(tx => {
    const fromAcc = allAccounts.find(a => a.id === tx.fromAccountId);
    const toAcc = allAccounts.find(a => a.id === tx.toAccountId);

    if (fromAcc) {
      if (fromAcc.category === 'ASSET' || fromAcc.category === 'EXPENSE') {
        balances[fromAcc.id] -= tx.amount;
      } else {
        balances[fromAcc.id] += tx.amount;
      }
    }

    if (toAcc) {
      if (toAcc.category === 'ASSET' || toAcc.category === 'EXPENSE') {
        balances[toAcc.id] += tx.amount;
      } else {
        balances[toAcc.id] -= tx.amount;
      }
    }
  });

  allAccounts.forEach(a => {
    a.balance = balances[a.id] || 0;
  });

  allTransactions.sort((a, b) => {
    const timeA = new Date(a.date).getTime();
    const timeB = new Date(b.date).getTime();
    return timeB - timeA;
  });

  return { accounts: allAccounts, transactions: allTransactions };
};

export const createAccount = async (account: Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>) => {
  const timestampIso = new Date().toISOString();
  const newId = crypto.randomUUID();
  await supabase.from('finance_accounts').insert({
    id: newId,
    ...account,
    createdAt: timestampIso,
    updatedAt: timestampIso,
  });
  return newId;
};

export const createFinanceTransaction = async (
  tx: Omit<FinanceTransaction, 'id' | 'createdAt'>
) => {
  const timestampIso = new Date().toISOString();
  const newId = crypto.randomUUID();
  await supabase.from('finance_transactions').insert({
    id: newId,
    ...tx,
    createdAt: timestampIso
  });
  return newId;
};
