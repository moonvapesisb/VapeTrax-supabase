import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Landmark,
  Plus,
  RotateCcw,
  Search,
  Send,
  Wallet,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { useShopPermissions } from '../lib/permissions';
import {
  db,
  type FinanceAccountRow,
  type FinanceTransactionRow,
} from '../lib/db';
import {
  archiveFinanceAccount,
  canReverseFinanceTransaction,
  createSecondaryBankAccount,
  FINANCE_ACCOUNT_TYPE_LABELS,
  FINANCE_TX_TYPE_LABELS,
  isOverdrawn,
  PAYOUT_CATEGORIES,
  recordOpeningBalance,
  recordPayout,
  reverseFinanceTransaction,
  summarizeVisibleFinanceView,
  transferFunds,
  updateFinanceAccountDetails,
  type ActorMeta,
  type FinanceAccountType,
  type FinanceTransactionType,
  type PayoutCategory,
} from '../lib/financeAccounts';
import { buildActorMeta } from '../lib/actor';
import { friendlyError } from '../lib/errors';
import { cn, formatCurrency } from '../lib/utils';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const TX_PAGE_SIZE = 25;

type ModalState =
  | { kind: 'none' }
  | { kind: 'createBank' }
  | { kind: 'editAccount'; account: FinanceAccountRow }
  | { kind: 'opening'; account: FinanceAccountRow }
  | { kind: 'transfer'; fromAccountId?: string }
  | { kind: 'payout'; accountId?: string }
  | { kind: 'reverseTx'; tx: FinanceTransactionRow };

const ManageCash: React.FC = () => {
  const { shopId, currentUser, userRole } = useAuth();
  const { isAdmin, isShopAdmin } = useShopPermissions();

  const accountsRaw = useLiveQuery(() => db.financeAccounts.toArray(), []);
  const transactionsRaw = useLiveQuery(
    () => db.financeTransactions.orderBy('occurredAt').reverse().toArray(),
    [],
  );
  const linkedSummariesRaw = useLiveQuery(() => db.linkedShopSummaries.toArray(), []);
  const queueOpsRaw = useLiveQuery(() => db.syncQueue.toArray(), []);

  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [showArchived, setShowArchived] = useState(false);

  // Transaction History Filters + Pagination
  const [filterAccountId, setFilterAccountId] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterShopId, setFilterShopId] = useState('all');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);

  const actor: ActorMeta = useMemo(() => {
    const raw = buildActorMeta({ currentUser, userRole });
    return {
      createdBy: raw.createdBy,
      actorRole: raw.actorRole === 'cashier' ? 'cashier' : 'admin',
      actorName: raw.actorName,
    };
  }, [currentUser, userRole]);

  const {
    visibleAccounts,
    activeAccounts,
    archivedAccounts,
    writableAccounts,
    linkedSummaries,
    shopLabelById,
    combinedTotals: totals,
    mismatches,
  } = useMemo(
    () =>
      summarizeVisibleFinanceView({
        accounts: accountsRaw || [],
        transactions: transactionsRaw || [],
        linkedSummaries: linkedSummariesRaw || [],
        queueOps: queueOpsRaw || [],
        shopId: shopId || '',
        isAdmin,
      }),
    [accountsRaw, transactionsRaw, linkedSummariesRaw, queueOpsRaw, shopId, isAdmin],
  );

  const accountById = useMemo(
    () => new Map<string, FinanceAccountRow>(visibleAccounts.map((a) => [a.id, a])),
    [visibleAccounts],
  );

  const visibleAccountIds = useMemo(
    () => new Set(visibleAccounts.map((a) => a.id)),
    [visibleAccounts],
  );

  const allTransactions = useMemo(
    () => (transactionsRaw || []).filter((tx) => visibleAccountIds.has(tx.accountId)),
    [transactionsRaw, visibleAccountIds],
  );

  const pendingFinanceCount = useMemo(
    () =>
      (queueOpsRaw || []).filter(
        (op) =>
          op.status === 'pending' &&
          !op.localRollback?.rolledBack &&
          [
            'create_finance_account',
            'update_finance_account',
            'archive_finance_account',
            'record_opening_balance',
            'transfer_funds',
            'record_payout',
            'reverse_finance_transaction',
          ].includes(op.type),
      ).length,
    [queueOpsRaw],
  );

  const shopFilterOptions = useMemo(() => {
    const ids = new Set<string>();
    if (shopId) ids.add(shopId);
    for (const a of visibleAccounts) ids.add(a.ownerShopId);
    for (const tx of allTransactions) {
      ids.add(tx.shopId);
      ids.add(tx.ownerShopId);
    }
    return [...ids];
  }, [shopId, visibleAccounts, allTransactions]);

  const filteredTransactions = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const fromTs = filterFromDate ? new Date(`${filterFromDate}T00:00:00`).getTime() : null;
    const toTs = filterToDate ? new Date(`${filterToDate}T23:59:59.999`).getTime() : null;

    return allTransactions.filter((tx) => {
      if (filterAccountId !== 'all' && tx.accountId !== filterAccountId) return false;
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (filterShopId !== 'all' && tx.shopId !== filterShopId && tx.ownerShopId !== filterShopId) {
        return false;
      }
      if (fromTs !== null || toTs !== null) {
        const ts = Date.parse(tx.occurredAt);
        if (fromTs !== null && (Number.isNaN(ts) || ts < fromTs)) return false;
        if (toTs !== null && (Number.isNaN(ts) || ts > toTs)) return false;
      }
      if (q) {
        const hay = `${tx.description || ''} ${tx.paidTo || ''} ${tx.notes || ''} ${tx.category || ''} ${tx.actorName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    allTransactions,
    filterAccountId,
    filterType,
    filterShopId,
    filterFromDate,
    filterToDate,
    searchText,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / TX_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedTransactions = useMemo(() => {
    const start = (safePage - 1) * TX_PAGE_SIZE;
    return filteredTransactions.slice(start, start + TX_PAGE_SIZE);
  }, [filteredTransactions, safePage]);

  const handleArchiveAccount = async (acc: FinanceAccountRow) => {
    if (!shopId) return;
    if (!window.confirm(`Archive bank account "${acc.name}"? Archived accounts are hidden from active pickers.`)) {
      return;
    }
    try {
      await archiveFinanceAccount({ accountId: acc.id, shopId });
      toast.success(`"${acc.name}" archived`);
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Could not archive account.'));
    }
  };

  if (accountsRaw === undefined || transactionsRaw === undefined || !shopId) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      {/* Header */}
      <header className="glass-card p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/20">
            <Landmark size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cash &amp; Bank Management</h1>
              {pendingFinanceCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                  {pendingFinanceCount} pending sync
                </span>
              )}
            </div>
            <p className="text-slate-500 text-sm">
              Track shop cash, primary online receipts, secondary bank accounts, transfers, payouts, and linked branch balances
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setModal({ kind: 'transfer' })}
            disabled={writableAccounts.length < 2}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50"
          >
            <ArrowLeftRight size={16} />
            Transfer Funds
          </button>
          <button
            onClick={() => setModal({ kind: 'payout' })}
            disabled={writableAccounts.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-50"
          >
            <Send size={16} />
            Record Payout
          </button>
          <button
            onClick={() => setModal({ kind: 'createBank' })}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-violet-600/20 transition-all"
          >
            <Plus size={16} />
            Add Bank Account
          </button>
        </div>
      </header>

      {/* Reconcile Mismatch Banner */}
      {mismatches.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">Balance vs. Ledger Reconciliation Warning</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {mismatches.map((m) => (
                <li key={m.accountId}>
                  <strong>{m.accountName}</strong>: cached {formatCurrency(m.cachedBalance)} vs derived ledger {formatCurrency(m.ledgerBalance)} (diff {formatCurrency(m.difference)})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Summary Totals */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="glass-card p-5 border-l-4 border-l-violet-600">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Combined Total (Own + Shared + Branches)</p>
          <p className="text-3xl font-black text-slate-900 mt-1">{formatCurrency(totals.combinedTotal)}</p>
        </div>
        <div className="glass-card p-5 border-l-4 border-l-emerald-500">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Own Shop Cash</p>
          <p className={cn("text-2xl font-black mt-1", totals.ownCash < 0 ? "text-rose-600" : "text-slate-900")}>
            {formatCurrency(totals.ownCash)}
          </p>
        </div>
        <div className="glass-card p-5 border-l-4 border-l-cyan-500">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Own Primary Online</p>
          <p className={cn("text-2xl font-black mt-1", totals.ownPrimary < 0 ? "text-rose-600" : "text-slate-900")}>
            {formatCurrency(totals.ownPrimary)}
          </p>
        </div>
        <div className="glass-card p-5 border-l-4 border-l-amber-500">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bank Accounts (Own &amp; Shared)</p>
          <p className={cn("text-2xl font-black mt-1", totals.accessibleBanks < 0 ? "text-rose-600" : "text-slate-900")}>
            {formatCurrency(totals.accessibleBanks)}
          </p>
        </div>
      </div>

      {/* Active Accounts Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Wallet size={20} className="text-violet-600" />
            Accounts ({activeAccounts.length})
          </h2>
          {archivedAccounts.length > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 underline"
            >
              {showArchived ? 'Hide' : 'Show'} Archived ({archivedAccounts.length})
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {activeAccounts.map((acc) => {
            const isOwned = acc.ownerShopId === shopId;
            const overdrawn = isOverdrawn(acc);
            const hasOpening = allTransactions.some(
              (tx) => tx.accountId === acc.id && tx.type === 'opening',
            );
            const canArchive =
              isOwned && acc.type === 'secondaryBank' && Math.round(Number(acc.balance) || 0) === 0;

            return (
              <div
                key={acc.id}
                className={cn(
                  "glass-card p-5 flex flex-col justify-between gap-4 border",
                  overdrawn ? "border-rose-300 bg-rose-50/30" : "border-slate-200",
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                          {FINANCE_ACCOUNT_TYPE_LABELS[acc.type as FinanceAccountType] ?? acc.type}
                        </span>
                        {!isOwned && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700">
                            Shared · {shopLabelById.get(acc.ownerShopId) ?? acc.ownerShopId.slice(0, 8)}
                          </span>
                        )}
                        {overdrawn && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700">
                            Overdrawn
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{acc.name}</h3>
                      {(acc.bankName || acc.accountNumber) && (
                        <p className="text-xs text-slate-500">
                          {[acc.bankName, acc.accountNumber].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <p className={cn("text-3xl font-black mt-3", overdrawn ? "text-rose-600" : "text-slate-900")}>
                    {formatCurrency(acc.balance)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setModal({ kind: 'transfer', fromAccountId: acc.id })}
                    disabled={Math.round(Number(acc.balance) || 0) <= 0 || writableAccounts.length < 2}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40"
                  >
                    Transfer Out
                  </button>
                  <button
                    onClick={() => setModal({ kind: 'payout', accountId: acc.id })}
                    disabled={Math.round(Number(acc.balance) || 0) <= 0}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 disabled:opacity-40"
                  >
                    Payout
                  </button>
                  {isOwned && !hasOpening && (
                    <button
                      onClick={() => setModal({ kind: 'opening', account: acc })}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                    >
                      Set Opening
                    </button>
                  )}
                  {isOwned && (
                    <button
                      onClick={() => setModal({ kind: 'editAccount', account: acc })}
                      className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50"
                      title="Edit account name / bank info"
                    >
                      <Edit2 size={15} />
                    </button>
                  )}
                  {isOwned && acc.type === 'secondaryBank' && (
                    <button
                      onClick={() => handleArchiveAccount(acc)}
                      disabled={!canArchive}
                      title={canArchive ? 'Archive bank account' : 'Balance must be 0 to archive'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                    >
                      <Archive size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {showArchived && archivedAccounts.length > 0 && (
          <div className="glass-card p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Archived Bank Accounts</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {archivedAccounts.map((acc) => (
                <div key={acc.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <p className="font-bold text-slate-700">{acc.name}</p>
                  <p className="text-slate-500">{[acc.bankName, acc.accountNumber].filter(Boolean).join(' · ') || 'No bank details'}</p>
                  <p className="text-slate-400 mt-1">Balance: {formatCurrency(acc.balance)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Linked Branches Read-Only Summary */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Building2 size={20} className="text-violet-600" />
            Linked Branches (Read-Only Cash &amp; Primary Online)
          </h2>
        </div>

        {linkedSummaries.length === 0 ? (
          <div className="glass-card p-5 text-sm text-slate-500">
            No directly linked shops right now. Link shops in Shop Transfers to see branch cash &amp; online totals and share secondary bank accounts.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {linkedSummaries.map((branch) => (
              <div key={branch.shopId} className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-900">{branch.shopName}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                    As of {new Date(branch.fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Shop Cash</span>
                      {branch.shopCashOverdrawn && (
                        <span className="text-[10px] font-black uppercase text-rose-600">Overdrawn</span>
                      )}
                    </div>
                    <p className={cn("text-lg font-black mt-1", branch.shopCashOverdrawn ? "text-rose-600" : "text-slate-900")}>
                      {formatCurrency(branch.shopCashBalance)}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold truncate">{branch.primaryOnlineName}</span>
                      {branch.primaryOnlineOverdrawn && (
                        <span className="text-[10px] font-black uppercase text-rose-600">Overdrawn</span>
                      )}
                    </div>
                    <p className={cn("text-lg font-black mt-1", branch.primaryOnlineOverdrawn ? "text-rose-600" : "text-slate-900")}>
                      {formatCurrency(branch.primaryOnlineBalance)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Transaction History with Filters & Pagination */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-bold text-slate-900">Ledger Transaction History</h2>
          <span className="text-xs font-semibold text-slate-500">
            {filteredTransactions.length} matching entr{filteredTransactions.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative lg:col-span-2">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
              placeholder="Search description, paid to, notes..."
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          <select
            aria-label="Filter by account"
            value={filterAccountId}
            onChange={(e) => { setFilterAccountId(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="all">All Accounts</option>
            {visibleAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.name}</option>
            ))}
          </select>

          <select
            aria-label="Filter by type"
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="all">All Types</option>
            {(Object.keys(FINANCE_TX_TYPE_LABELS) as FinanceTransactionType[]).map((t) => (
              <option key={t} value={t}>{FINANCE_TX_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <select
            aria-label="Filter by shop"
            value={filterShopId}
            onChange={(e) => { setFilterShopId(e.target.value); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="all">All Shops</option>
            {shopFilterOptions.map((sid) => (
              <option key={sid} value={sid}>{shopLabelById.get(sid) ?? sid.slice(0, 8)}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="From date"
              value={filterFromDate}
              onChange={(e) => { setFilterFromDate(e.target.value); setPage(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-700"
            />
            <input
              type="date"
              aria-label="To date"
              value={filterToDate}
              onChange={(e) => { setFilterToDate(e.target.value); setPage(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-700"
            />
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100">
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</th>
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Type</th>
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Description / Party</th>
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amount</th>
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">By</th>
                  <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {pagedTransactions.map((tx) => {
                  const acc = accountById.get(tx.accountId);
                  const canRev = canReverseFinanceTransaction(tx, allTransactions, isShopAdmin);
                  const alreadyReversed = allTransactions.some(
                    (o) => o.referenceType === 'adjustment' && o.referenceId === tx.id,
                  );

                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(tx.occurredAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-800 whitespace-nowrap">
                        {acc?.name ?? tx.accountId.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                          {FINANCE_TX_TYPE_LABELS[tx.type as FinanceTransactionType] ?? tx.type}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 max-w-xs">
                        <p className="truncate font-medium text-slate-800">{tx.description || '—'}</p>
                        {(tx.paidTo || tx.notes) && (
                          <p className="text-xs text-slate-400 truncate">
                            {[tx.paidTo ? `To: ${tx.paidTo}` : '', tx.notes || ''].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className={cn(
                        "px-5 py-3.5 font-black whitespace-nowrap",
                        tx.direction === 'in' ? "text-emerald-600" : "text-rose-600",
                      )}>
                        {tx.direction === 'in' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                        {tx.actorName || 'System'}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        {canRev ? (
                          <button
                            onClick={() => setModal({ kind: 'reverseTx', tx })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100"
                          >
                            <RotateCcw size={12} />
                            Reverse
                          </button>
                        ) : alreadyReversed ? (
                          <span className="text-[11px] font-semibold text-slate-400">Reversed</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {pagedTransactions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                      No ledger transactions match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filteredTransactions.length > TX_PAGE_SIZE && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40 text-xs">
              <span className="text-slate-500 font-medium">
                Page {safePage} of {totalPages} ({filteredTransactions.length} entries)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-700 disabled:opacity-40"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Modals */}
      {modal.kind === 'createBank' && (
        <CreateBankModal
          shopId={shopId}
          actor={actor}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'editAccount' && (
        <EditAccountModal
          shopId={shopId}
          account={modal.account}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'opening' && (
        <OpeningBalanceModal
          shopId={shopId}
          account={modal.account}
          actor={actor}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'transfer' && (
        <TransferModal
          shopId={shopId}
          accounts={writableAccounts}
          initialFromId={modal.fromAccountId}
          actor={actor}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'payout' && (
        <PayoutModal
          shopId={shopId}
          accounts={writableAccounts}
          initialAccountId={modal.accountId}
          actor={actor}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'reverseTx' && (
        <ReverseTxModal
          shopId={shopId}
          tx={modal.tx}
          account={accountById.get(modal.tx.accountId)}
          actor={actor}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal Subcomponents
// ---------------------------------------------------------------------------

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400">
          <X size={18} />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

const CreateBankModal: React.FC<{ shopId: string; actor: ActorMeta; onClose: () => void }> = ({
  shopId,
  actor,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const openVal = openingBalance.trim() === '' ? 0 : Number(openingBalance);
      await createSecondaryBankAccount({
        shopId,
        name,
        bankName: bankName || null,
        accountNumber: accountNumber || null,
        openingBalance: openVal,
        actor,
      });
      toast.success('Bank account created');
      onClose();
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Could not create bank account.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Add Bank Account" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Account Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Meezan Business"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Bank Name (optional)</label>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. Meezan Bank"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Account / IBAN (optional)</label>
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="e.g. 0123-4567890"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Opening Balance (Rs, optional)</label>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="0"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-xs uppercase text-slate-600">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white font-bold text-xs uppercase disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Account'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const EditAccountModal: React.FC<{ shopId: string; account: FinanceAccountRow; onClose: () => void }> = ({
  shopId,
  account,
  onClose,
}) => {
  const [name, setName] = useState(account.name);
  const [bankName, setBankName] = useState(account.bankName || '');
  const [accountNumber, setAccountNumber] = useState(account.accountNumber || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateFinanceAccountDetails({
        accountId: account.id,
        shopId,
        name,
        bankName: bankName || null,
        accountNumber: accountNumber || null,
      });
      toast.success('Account updated');
      onClose();
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Could not update account.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Edit ${account.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Account Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Bank / Wallet Name</label>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. SadaPay / HBL"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Account Number</label>
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-xs uppercase text-slate-600">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white font-bold text-xs uppercase disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const OpeningBalanceModal: React.FC<{
  shopId: string;
  account: FinanceAccountRow;
  actor: ActorMeta;
  onClose: () => void;
}> = ({ shopId, account, actor, onClose }) => {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await recordOpeningBalance({
        shopId,
        accountId: account.id,
        amount: Number(amount),
        notes: notes || null,
        actor,
      });
      toast.success('Opening balance recorded');
      onClose();
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Could not record opening balance.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Set Opening Balance · ${account.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Amount (Whole Rs)</label>
          <input
            required
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Initial cash count / statement balance"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-xs uppercase text-slate-600">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase disabled:opacity-50">
            {saving ? 'Saving...' : 'Record Opening'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const TransferModal: React.FC<{
  shopId: string;
  accounts: FinanceAccountRow[];
  initialFromId?: string;
  actor: ActorMeta;
  onClose: () => void;
}> = ({ shopId, accounts, initialFromId, actor, onClose }) => {
  const defaultFrom = initialFromId || accounts[0]?.id || '';
  const defaultTo = accounts.find((a) => a.id !== defaultFrom)?.id || '';
  const [fromAccountId, setFromAccountId] = useState(defaultFrom);
  const [toAccountId, setToAccountId] = useState(defaultTo);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fromAcc = accounts.find((a) => a.id === fromAccountId);
  const available = Math.round(Number(fromAcc?.balance) || 0);
  const parsedAmount = Number(amount) || 0;
  const exceedsBalance = parsedAmount > available;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exceedsBalance) {
      toast.error(`Insufficient balance in ${fromAcc?.name} (available: ${formatCurrency(available)}).`);
      return;
    }
    setSaving(true);
    try {
      await transferFunds({
        shopId,
        fromAccountId,
        toAccountId,
        amount: Number(amount),
        description: description || null,
        notes: notes || null,
        actor,
      });
      toast.success('Transfer recorded');
      onClose();
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Transfer failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Transfer Funds" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">From Account</label>
          <select
            value={fromAccountId}
            onChange={(e) => {
              const nextFrom = e.target.value;
              setFromAccountId(nextFrom);
              if (nextFrom === toAccountId) {
                setToAccountId(accounts.find((a) => a.id !== nextFrom)?.id || '');
              }
            }}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}{acc.ownerShopId !== shopId ? ' · Shared' : ''} (Avail: {formatCurrency(acc.balance)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">To Account</label>
          <select
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          >
            {accounts
              .filter((acc) => acc.id !== fromAccountId)
              .map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}{acc.ownerShopId !== shopId ? ' · Shared' : ''} ({formatCurrency(acc.balance)})
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Amount (Whole Rs)</label>
          <input
            required
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
          {exceedsBalance && (
            <p className="text-xs font-semibold text-rose-600 mt-1">
              Exceeds available balance ({formatCurrency(available)}).
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Daily cash deposit"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-xs uppercase text-slate-600">Cancel</button>
          <button type="submit" disabled={saving || exceedsBalance || !toAccountId} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs uppercase disabled:opacity-50">
            {saving ? 'Saving...' : 'Confirm Transfer'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const PayoutModal: React.FC<{
  shopId: string;
  accounts: FinanceAccountRow[];
  initialAccountId?: string;
  actor: ActorMeta;
  onClose: () => void;
}> = ({ shopId, accounts, initialAccountId, actor, onClose }) => {
  const [accountId, setAccountId] = useState(initialAccountId || accounts[0]?.id || '');
  const [category, setCategory] = useState<PayoutCategory>('supplierPayment');
  const [paidTo, setPaidTo] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const acc = accounts.find((a) => a.id === accountId);
  const available = Math.round(Number(acc?.balance) || 0);
  const parsedAmount = Number(amount) || 0;
  const exceedsBalance = parsedAmount > available;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exceedsBalance) {
      toast.error(`Insufficient balance in ${acc?.name} (available: ${formatCurrency(available)}).`);
      return;
    }
    setSaving(true);
    try {
      await recordPayout({
        shopId,
        accountId,
        amount: Number(amount),
        paidTo,
        category,
        description: description || null,
        notes: notes || null,
        actor,
      });
      toast.success('Payout recorded');
      onClose();
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Could not record payout.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Record Payout" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Pay From</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.ownerShopId !== shopId ? ' · Shared' : ''} (Avail: {formatCurrency(a.balance)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PayoutCategory)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          >
            {PAYOUT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Paid To</label>
          <input
            required
            value={paidTo}
            onChange={(e) => setPaidTo(e.target.value)}
            placeholder="Supplier / owner / staff name"
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Amount (Whole Rs)</label>
          <input
            required
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
          {exceedsBalance && (
            <p className="text-xs font-semibold text-rose-600 mt-1">
              Exceeds available balance ({formatCurrency(available)}).
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-xs uppercase text-slate-600">Cancel</button>
          <button type="submit" disabled={saving || exceedsBalance} className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white font-bold text-xs uppercase disabled:opacity-50">
            {saving ? 'Saving...' : 'Confirm Payout'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const ReverseTxModal: React.FC<{
  shopId: string;
  tx: FinanceTransactionRow;
  account?: FinanceAccountRow;
  actor: ActorMeta;
  onClose: () => void;
}> = ({ shopId, tx, account, actor, onClose }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await reverseFinanceTransaction({
        shopId,
        originalTxId: tx.id,
        reason,
        actor,
      });
      toast.success('Adjustment reversal posted');
      onClose();
    } catch (error: unknown) {
      toast.error(friendlyError(error, 'Could not reverse entry.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Reverse Ledger Entry" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
          <p className="font-bold text-slate-800">{account?.name ?? tx.accountId}</p>
          <p className="text-slate-600">
            {FINANCE_TX_TYPE_LABELS[tx.type as FinanceTransactionType] ?? tx.type} ·{' '}
            {tx.direction === 'in' ? '+' : '-'}{formatCurrency(tx.amount)}
          </p>
          {tx.description && <p className="text-slate-500">{tx.description}</p>}
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Reversal Reason (required)</label>
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why an adjustment entry is being posted..."
            className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm h-24 resize-none"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 font-bold text-xs uppercase text-slate-600">Cancel</button>
          <button type="submit" disabled={saving || !reason.trim()} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-bold text-xs uppercase disabled:opacity-50">
            {saving ? 'Posting...' : 'Post Adjustment'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default ManageCash;
