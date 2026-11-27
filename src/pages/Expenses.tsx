import React, { useState, useMemo, useEffect } from 'react';
import {
  DollarSign,
  Search,
  Plus,
  Edit2,
  Trash2,
  Tag,
  X,
  Clock,
  TrendingDown,
  Wallet,
  Building2,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, cn } from '../lib/utils';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { buildActorMeta } from '../lib/actor';
import { toDisplayDate } from '../lib/dates';
import ConfirmBulkDeleteModal from '../components/ui/ConfirmBulkDeleteModal';
import { reauthenticateForSensitiveAction, requiresPasswordReauth } from '../lib/secureAction';
import { friendlyError } from '../lib/errors';
import { MAX_DELETE_AT_ONCE, REASONS, useShopPermissions } from '../lib/permissions';
import { db, type ExpenseRow, type FinanceAccountRow } from '../lib/db';
import { syncFinanceFromCloud } from '../lib/sync';
import {
  canWriteFinanceAccount,
  deleteExpenseWithAccount,
  recordExpenseWithAccount,
  updateExpenseWithAccount,
  type ActorMeta,
} from '../lib/financeAccounts';

const MASS_DELETE_MESSAGE =
  `For safety, at most ${MAX_DELETE_AT_ONCE} expenses can be deleted at once. Nothing was deleted: select ${MAX_DELETE_AT_ONCE} or fewer and try again.`;

const Expenses: React.FC = () => {
  const { shopId, currentUser, userRole } = useAuth();
  // A cashier adds expenses (from Shop Cash only); editing and deleting them is for the admin.
  const isCashier = !useShopPermissions().canEditExpenses;
  const needsPassword = requiresPasswordReauth(currentUser);

  const expensesRaw = useLiveQuery(
    () => (shopId ? db.expenses.where('shopId').equals(shopId).toArray() : Promise.resolve([])),
    [shopId],
  );
  const allAccounts = useLiveQuery(() => db.financeAccounts.toArray(), []);

  useEffect(() => {
    if (!shopId || !navigator.onLine) return;
    void syncFinanceFromCloud(shopId);
  }, [shopId]);

  const expenses = useMemo(() => {
    const list = expensesRaw || [];
    return [...list].sort((a, b) => {
      const ta = toDisplayDate(a.expenseDate, a.createdAtClient)?.getTime() ?? 0;
      const tb = toDisplayDate(b.expenseDate, b.createdAtClient)?.getTime() ?? 0;
      return tb - ta;
    });
  }, [expensesRaw]);

  const accountById = useMemo(
    () => new Map<string, FinanceAccountRow>((allAccounts || []).map((a) => [a.id, a])),
    [allAccounts],
  );

  const writableAccounts = useMemo(() => {
    if (!shopId) return [];
    const order: Record<string, number> = { shopCash: 0, primaryOnline: 1, secondaryBank: 2 };
    return (allAccounts || [])
      .filter((a) => !a.isArchived && canWriteFinanceAccount(a, shopId, !isCashier))
      .sort((a, b) => {
        const ownDiff = Number(a.ownerShopId !== shopId) - Number(b.ownerShopId !== shopId);
        if (ownDiff !== 0) return ownDiff;
        const typeDiff = (order[a.type] ?? 9) - (order[b.type] ?? 9);
        if (typeDiff !== 0) return typeDiff;
        return a.name.localeCompare(b.name);
      });
  }, [allAccounts, shopId, isCashier]);

  const loading = expensesRaw === undefined || allAccounts === undefined;
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e =>
      (e.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
       e.category?.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (categoryFilter === 'all' || e.category === categoryFilter)
    );
  }, [expenses, searchTerm, categoryFilter]);

  const buildActor = (): ActorMeta => {
    const raw = buildActorMeta({ currentUser, userRole });
    return {
      createdBy: raw.createdBy,
      actorRole: raw.actorRole === 'cashier' ? 'cashier' : 'admin',
      actorName: raw.actorName,
    };
  };

  const handleDelete = async (expense: ExpenseRow) => {
    if (isCashier) {
      toast.error(REASONS.editExpenses);
      return;
    }
    if (!shopId) return;
    if (window.confirm('Are you sure you want to delete this expense? Any linked account debit will be refunded.')) {
      try {
        await deleteExpenseWithAccount({
          shopId,
          expenseId: expense.id,
          actor: buildActor(),
          existingExpense: expense,
        });
        toast.success('Expense deleted and account refunded');
      } catch (error: unknown) {
        console.error('Expense delete error:', error);
        toast.error(friendlyError(error, 'The expense could not be deleted. Please try again.'));
      }
    }
  };

  const categories = ['Rent', 'Electricity', 'Salary', 'Miscellaneous', 'Utilities', 'Maintenance'];
  const toggleSelectAll = (checked: boolean) => setSelectedIds(checked ? filteredExpenses.map((e) => e.id) : []);
  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id));
  };

  const handleBulkDelete = async () => {
    if (isCashier || !shopId) return;
    if (!selectedIds.length) return;
    if (selectedIds.length > MAX_DELETE_AT_ONCE) {
      toast.error(MASS_DELETE_MESSAGE);
      return;
    }
    const ids = [...selectedIds];
    setBulkDeleting(true);
    try {
      if (needsPassword && currentUser) {
        await reauthenticateForSensitiveAction(currentUser, deletePassword);
      }
      const actor = buildActor();
      for (const id of ids) {
        const exp = expenses.find((e) => e.id === id);
        await deleteExpenseWithAccount({ shopId, expenseId: id, actor, existingExpense: exp });
      }
      toast.success(`Deleted ${ids.length} expense(s)`);
      setSelectedIds([]);
      setShowBulkDeleteModal(false);
      setDeleteTyped('');
      setDeletePassword('');
    } catch (error: unknown) {
      console.error('Expense bulk delete error:', error);
      toast.error(friendlyError(error, 'The selected expenses could not be deleted. Please try again.'));
    } finally {
      setBulkDeleting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/20">
            <DollarSign size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Expense Management</h1>
            <p className="text-slate-500 text-sm">Track your operating costs and miscellaneous shop expenses</p>
            {isCashier && <p className="text-slate-400 text-xs mt-0.5">{REASONS.editExpenses}</p>}
          </div>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-violet-600/20 uppercase tracking-wider text-sm"
        >
          <Plus size={20} />
          Add Expense
        </button>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="metric-card-orange rounded-2xl p-6 shadow-lg shadow-orange-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <TrendingDown size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Expenses</p>
            <p className="text-3xl font-bold text-white">{expenses.length}</p>
          </div>
        </div>
        <div className="metric-card-red rounded-2xl p-6 shadow-lg shadow-rose-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <Wallet size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Procurement Cost</p>
            <p className="text-3xl font-bold text-white">
              {formatCurrency(expenses.reduce((acc, e) => acc + (e.amount || 0), 0))}
            </p>
          </div>
        </div>
        <div className="metric-card-pink rounded-2xl p-6 shadow-lg shadow-fuchsia-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <Tag size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Highest Category</p>
            <p className="text-3xl font-bold text-white">
              {categories[0]}
            </p>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search by description or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
          />
        </div>
        <div className="flex gap-2">
          <select 
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>

        </div>
        {!isCashier && selectedIds.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              disabled={selectedIds.length > MAX_DELETE_AT_ONCE}
              title={selectedIds.length > MAX_DELETE_AT_ONCE ? REASONS.tooManyToDelete : undefined}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Selected ({selectedIds.length})
            </button>
            {selectedIds.length > MAX_DELETE_AT_ONCE && (
              <span className="text-[11px] font-semibold text-rose-600">{REASONS.tooManyToDelete} Select fewer.</span>
            )}
          </div>
        )}
      </div>

      {/* Expenses Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Category</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Description</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid From</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">By</th>
                {!isCashier && (
                  <th className="px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">
                    <input
                      type="checkbox"
                      checked={filteredExpenses.length > 0 && selectedIds.length === filteredExpenses.length}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.map((expense) => (
                <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Tag size={14} className="text-slate-400" />
                      <span className="text-slate-900 font-bold">{expense.category}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{expense.description}</td>
                  <td className="px-6 py-4 text-sm text-red-600 font-bold">{formatCurrency(expense.amount)}</td>
                  <td className="px-6 py-4 text-xs font-semibold text-slate-600">
                    {expense.paidFromAccountId ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">
                        <Building2 size={12} className="text-slate-400" />
                        {accountById.get(expense.paidFromAccountId)?.name ?? 'Account'}
                      </span>
                    ) : (
                      <span className="text-slate-400">Legacy (Unlinked)</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    <div className="flex items-center gap-1">
                      <Clock size={14} className="text-slate-400" />
                      {(toDisplayDate(expense.expenseDate, expense.createdAtClient) || new Date()).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                        expense.actorRole === 'cashier' ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                      )}>
                        {expense.actorRole === 'cashier' ? 'Cashier' : 'Admin'}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">{expense.actorName || 'System'}</span>
                    </div>
                  </td>
                  {!isCashier && (
                    <td className="px-3 py-4 text-right">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(expense.id)}
                        onChange={(e) => toggleSelectOne(expense.id, e.target.checked)}
                      />
                    </td>
                  )}
                  <td className="px-6 py-4 text-right">
                    {!isCashier && (
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => setEditingExpense(expense)}
                          className="p-2 hover:bg-violet-50 rounded-lg text-slate-400 hover:text-violet-600 transition-all" 
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => handleDelete(expense)}
                          className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-all" 
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredExpenses.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <DollarSign className="text-slate-300" size={40} />
            </div>
            <p className="text-slate-400 font-medium">No expenses found matching your search.</p>
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {(showAddModal || (!isCashier && editingExpense)) && (
        <AddExpenseModal
          categories={categories}
          accounts={writableAccounts}
          isCashier={isCashier}
          shopId={shopId}
          expense={isCashier ? undefined : editingExpense ?? undefined}
          onClose={() => {
            setShowAddModal(false);
            setEditingExpense(null);
          }}
        />
      )}
      {!isCashier && (
        <ConfirmBulkDeleteModal
          open={showBulkDeleteModal}
          count={selectedIds.length}
          title="Delete selected expenses?"
          busy={bulkDeleting}
          typedConfirm={deleteTyped}
          onTypedConfirmChange={setDeleteTyped}
          requirePassword={needsPassword}
          password={deletePassword}
          onPasswordChange={setDeletePassword}
          onClose={() => {
            if (bulkDeleting) return;
            setShowBulkDeleteModal(false);
            setDeleteTyped('');
            setDeletePassword('');
          }}
          onConfirm={handleBulkDelete}
        />
      )}
    </div>
  );
};

const AddExpenseModal: React.FC<{
  categories: string[];
  accounts: FinanceAccountRow[];
  isCashier: boolean;
  shopId: string | null;
  expense?: ExpenseRow;
  onClose: () => void;
}> = ({ categories, accounts, isCashier, shopId, expense, onClose }) => {
  const { currentUser, userRole } = useAuth();
  const isEditing = !!expense;
  const shopCashAccount = accounts.find((a) => a.type === 'shopCash' && a.ownerShopId === shopId) ?? accounts[0];

  const [formData, setFormData] = useState({
    category: expense?.category || 'Miscellaneous',
    description: expense?.description || '',
    amount: isEditing ? (expense?.amount || 0) : '' as number | string,
    accountId: isEditing ? (expense?.paidFromAccountId ?? '') : (shopCashAccount?.id ?? ''),
    expenseDate: expense?.expenseDate
      ? new Date(expense.expenseDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === formData.accountId) ?? null;
  const oldAmount = isEditing ? Math.round(Number(expense?.amount) || 0) : 0;
  const parsedAmount = Number(formData.amount) || 0;
  const effectiveAvailable = selectedAccount
    ? Math.round(Number(selectedAccount.balance) || 0) +
      (isEditing && expense?.paidFromAccountId === selectedAccount.id ? oldAmount : 0)
    : 0;
  const needsDebitCheck =
    Boolean(selectedAccount) &&
    (!isEditing ||
      expense?.paidFromAccountId == null ||
      expense.paidFromAccountId !== formData.accountId ||
      parsedAmount !== oldAmount);
  const exceedsAvailable = needsDebitCheck && parsedAmount > effectiveAvailable;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait a moment and try again.');
      return;
    }
    const amount = Number(formData.amount);
    if (!(amount > 0)) {
      toast.error('Expense amount must be greater than 0');
      return;
    }
    if (!Number.isInteger(amount)) {
      toast.error('Amounts are in whole rupees (no paisa).');
      return;
    }
    if (!isEditing && !formData.accountId) {
      toast.error('Please select a payment account.');
      return;
    }
    if (isCashier && selectedAccount && selectedAccount.type !== 'shopCash') {
      toast.error('Cashiers can only choose Shop Cash for expenses.');
      return;
    }
    if (exceedsAvailable && selectedAccount) {
      toast.error(`Insufficient balance in ${selectedAccount.name} (available: ${formatCurrency(effectiveAvailable)}).`);
      return;
    }

    setSaving(true);
    try {
      const rawActor = buildActorMeta({ currentUser, userRole });
      const actor: ActorMeta = {
        createdBy: rawActor.createdBy,
        actorRole: rawActor.actorRole === 'cashier' ? 'cashier' : 'admin',
        actorName: rawActor.actorName,
      };
      const expenseDateIso = new Date(formData.expenseDate).toISOString();
      if (isEditing && expense) {
        await updateExpenseWithAccount({
          shopId,
          expenseId: expense.id,
          category: formData.category,
          description: formData.description,
          amount,
          expenseDate: expenseDateIso,
          accountId: formData.accountId || null,
          actor,
          existingExpense: expense,
        });
        toast.success('Expense updated successfully');
      } else {
        await recordExpenseWithAccount({
          shopId,
          category: formData.category,
          description: formData.description,
          amount,
          expenseDate: expenseDateIso,
          accountId: formData.accountId,
          actor,
        });
        toast.success('Expense recorded successfully');
      }
      onClose();
    } catch (error: unknown) {
      console.error('Expense save error:', error);
      toast.error(friendlyError(error, 'The expense could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in duration-300 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-900">{isEditing ? 'Edit Expense' : 'Record New Expense'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Paid From</label>
            <select
              required={!isEditing}
              disabled={isCashier}
              value={formData.accountId}
              onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
              className={cn(
                "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all",
                isCashier && "opacity-75 cursor-not-allowed"
              )}
            >
              {isEditing && expense?.paidFromAccountId == null && (
                <option value="">Legacy (Unlinked — no ledger entry)</option>
              )}
              {accounts.map((acc) => {
                const avail =
                  Math.round(Number(acc.balance) || 0) +
                  (isEditing && expense?.paidFromAccountId === acc.id ? oldAmount : 0);
                const sharedTag = acc.ownerShopId !== shopId ? ' · Shared' : '';
                return (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}{sharedTag} (Avail: {formatCurrency(avail)})
                  </option>
                );
              })}
            </select>
            {isCashier && (
              <p className="text-[11px] font-medium text-slate-500 ml-1">
                Cashiers can only record expenses from Shop Cash.
              </p>
            )}
            {exceedsAvailable && selectedAccount && (
              <p className="text-xs font-semibold text-rose-600 ml-1">
                Amount exceeds {selectedAccount.name} available balance ({formatCurrency(effectiveAvailable)}).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Category</label>
            <select 
              required
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
            >
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Amount (Rs)</label>
            <input 
              required
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value === '' ? '' : parseFloat(e.target.value)})}
              onFocus={(e) => e.target.select()}
              placeholder="0"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Description</label>
            <textarea 
              required
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all h-24 resize-none"
              placeholder="What was this expense for?"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Expense Date</label>
            <input 
              required
              type="date" 
              value={formData.expenseDate}
              onChange={(e) => setFormData({...formData, expenseDate: e.target.value})}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-4 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all uppercase tracking-widest text-xs"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={saving || !shopId || exceedsAvailable || (!isEditing && !formData.accountId)}
              className="flex-1 py-4 px-4 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-lg shadow-violet-600/20 transition-all uppercase tracking-widest text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : isEditing ? 'Update Expense' : 'Record Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Expenses;
