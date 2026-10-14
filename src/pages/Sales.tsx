import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  History, 
  Search, 
  Filter, 
  Eye, 
  Trash2, 
  Calendar, 
  Download, 
  Clock, 
  User, 
  CreditCard, 
  Banknote, 
  RefreshCw,
  X,
  FileText,
  Printer,
  TrendingUp,
  RotateCcw,
  ShoppingCart,
  Split,
  Edit
} from 'lucide-react';
import { deleteSaleWithReversal } from '../lib/salesReversal';
import { useDocumentOnce } from '../hooks/useSupabaseOnce';
import { formatCurrency, cn } from '../lib/utils';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAllPages';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import toast from 'react-hot-toast';
import { format, startOfDay, endOfDay, subDays, parseISO, isValid } from 'date-fns';
import { buildActorMeta } from '../lib/actor';
import { toDisplayDate } from '../lib/dates';
import ConfirmBulkDeleteModal from '../components/ui/ConfirmBulkDeleteModal';
import { reauthenticateForSensitiveAction, requiresPasswordReauth } from '../lib/secureAction';
import { refreshAfterSaleReversal } from '../lib/liveStock';
import { announceDeleted } from '../lib/liveSync';
import { useTableChanged } from '../hooks/useTableChanged';
import { friendlyError } from '../lib/errors';
import { REASONS, useShopPermissions } from '../lib/permissions';

/** Time of a sale's date, or NaN. */
const saleTime = (sale: any): number => {
  const t = Date.parse(String(sale?.saleDate ?? ''));
  return Number.isFinite(t) ? t : NaN;
};

/** Editing a sale and removing one item are paused until they become server commands (Phase 4). */
const EDIT_PAUSED_TIP = 'Paused: delete and ring again';

/** Rows drawn at once. The totals always use every loaded sale. */
const ROWS_PER_PAGE = 300;

/** Stop a bulk delete after this many failures in a row (for example when offline). */
const MAX_FAILURES_IN_A_ROW = 3;

/**
 * Start or end of a 'yyyy-MM-dd' day as an ISO string, or null when the input is
 * empty, invalid or not a plausible shop date (a year typed halfway, such as 0002).
 */
const dayBoundIso = (value: string, bound: 'start' | 'end'): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = parseISO(value);
  if (!isValid(day) || day.getFullYear() < 2000 || day.getFullYear() > 2099) return null;
  return (bound === 'start' ? startOfDay(day) : endOfDay(day)).toISOString();
};

/**
 * Every sale of the shop in the range, not just the first 1000. Pages are read
 * oldest first (saleDate, then id), so a sale rung meanwhile lands on the last
 * page instead of shifting earlier ones. The total is checked against a count and
 * the read is repeated once if they differ (a sale was added or deleted meanwhile).
 */
const loadSalesRange = async (shopId: string, startIso: string, endIso: string) => {
  let rows: any[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const fetched = await fetchAllPages<any>((from, to) =>
      supabase
        .from('sales')
        .select('*')
        .eq('shopId', shopId)
        .gte('saleDate', startIso)
        .lte('saleDate', endIso)
        .order('saleDate', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
    rows = [...new Map(fetched.map(sale => [sale.id, sale])).values()];
    const { count, error } = await supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('shopId', shopId)
      .gte('saleDate', startIso)
      .lte('saleDate', endIso);
    if (error) throw error;
    if (count === rows.length) return { rows, complete: true };
  }
  return { rows, complete: false };
};

const Sales: React.FC = () => {
  const { shopId, currentUser, userRole } = useAuth();
  const { customers } = useData();
  const [hasSearched, setHasSearched] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  const [activePreset, setActivePreset] = useState<string>('today');
  // What the date inputs show, exactly as typed (may be empty or half-typed).
  // Only a valid date reaches dateRange, which the query uses.
  const [dateInputs, setDateInputs] = useState(dateRange);

  // Empty or invalid date inputs are ignored (see the inputs below); this guard
  // only keeps the page from crashing if one ever slips through.
  const startIso = dayBoundIso(dateRange.start, 'start');
  const endIso = dayBoundIso(dateRange.end, 'end');
  const rangeKey = hasSearched && shopId && startIso && endIso ? `${shopId}|${startIso}|${endIso}` : null;

  const [loaded, setLoaded] = useState<{ key: string | null; rows: any[]; complete: boolean }>({ key: null, rows: [], complete: true });
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const refetchSales = useCallback(() => setReloadTick(t => t + 1), []);
  const { canDeleteSales } = useShopPermissions();

  // Live: a sale rung on another device joins the list at once (its row comes with the
  // change, so nothing is read). Any other change to sales reads the range again,
  // about 400 ms after the last one (useTableChanged).
  // While a read of the range runs, nothing restarts it (a long range would never
  // finish at rush hour): new sales are held and merged into its result, and any other
  // change reads the range once more after it ends.
  const liveRef = useRef({ rangeKey, startIso, endIso, shopId });
  liveRef.current = { rangeKey, startIso, endIso, shopId };
  /** The range a read is running for, if any. */
  const readingRef = useRef<string | null>(null);
  const heldRef = useRef<{ key: string | null; rows: Map<string, any>; reread: boolean }>({ key: null, rows: new Map(), reread: false });
  useTableChanged('sales', refetchSales, detail => {
    const live = liveRef.current;
    if (!live.rangeKey) return false; // nothing loaded yet
    if (detail.source === 'local') return false; // this page reads again after its own deletes
    const isInsert = detail.source === 'remote' && detail.event === 'INSERT' && !!detail.rows?.length;
    const start = Date.parse(live.startIso || '');
    const end = Date.parse(live.endIso || '');
    const fresh = isInsert
      ? detail.rows!.filter(row => {
          const t = saleTime(row);
          return row?.id != null && String(row?.shopId) === live.shopId && t >= start && t <= end;
        })
      : [];
    if (readingRef.current === live.rangeKey) {
      if (heldRef.current.key !== live.rangeKey) heldRef.current = { key: live.rangeKey, rows: new Map(), reread: false };
      const held = heldRef.current;
      if (!isInsert) held.reread = true;
      for (const row of fresh) held.rows.set(String(row.id), { ...(held.rows.get(String(row.id)) || {}), ...row });
      return false;
    }
    if (!isInsert) return true;
    if (fresh.length) {
      setLoaded(prev => {
        if (prev.key !== live.rangeKey) return prev;
        const byId = new Map<string, any>(prev.rows.map((sale: any) => [sale.id, sale] as [string, any]));
        for (const row of fresh) byId.set(row.id, { ...(byId.get(row.id) || {}), ...row });
        return { ...prev, rows: [...byId.values()] };
      });
    }
    return false;
  });

  useEffect(() => {
    if (!rangeKey || !shopId || !startIso || !endIso) return;
    let cancelled = false;
    // This read sees everything saved before it starts; changes from now on are held.
    readingRef.current = rangeKey;
    heldRef.current = { key: rangeKey, rows: new Map(), reread: false };
    setSalesLoading(true);
    setLoadError(null);
    loadSalesRange(shopId, startIso, endIso)
      .then(result => {
        if (cancelled) return;
        if (readingRef.current === rangeKey) readingRef.current = null;
        const held = heldRef.current.key === rangeKey ? heldRef.current : null;
        heldRef.current = { key: rangeKey, rows: new Map(), reread: false };
        let rows = result.rows;
        // New sales that arrived meanwhile (unless a read again follows anyway).
        if (held && !held.reread && held.rows.size) {
          const byId = new Map<string, any>(rows.map((sale: any) => [String(sale.id), sale] as [string, any]));
          for (const [id, row] of held.rows) if (!byId.has(id)) byId.set(id, row);
          rows = [...byId.values()];
        }
        setLoaded({ key: rangeKey, rows, complete: result.complete });
        if (held?.reread) refetchSales(); // once, now that this read has ended
      })
      .catch((error: any) => {
        console.error('[Sales] Loading sales failed', error);
        if (!cancelled && readingRef.current === rangeKey) readingRef.current = null;
        if (!cancelled) setLoadError({ key: rangeKey, message: friendlyError(error, 'Check the internet connection.') });
      })
      .finally(() => {
        if (cancelled) return;
        if (readingRef.current === rangeKey) readingRef.current = null;
        setSalesLoading(false);
      });
    return () => {
      cancelled = true;
      if (readingRef.current === rangeKey) readingRef.current = null;
    };
  }, [rangeKey, reloadTick]);

  // Sales deleted on this page leave the table and the totals at once, without
  // waiting for the refresh (a long range takes several seconds to read again).
  // A deleted sale's id never comes back, so the set is only ever added to.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const hideDeleted = (id: string) => setDeletedIds(prev => new Set(prev).add(id));

  // Sales of the current range only. The full-page spinner shows only while a new
  // range loads; a refresh after a delete keeps the table on screen.
  const sales = useMemo(
    () => (loaded.key === rangeKey ? loaded.rows : []).filter(s => !deletedIds.has(s.id)),
    [loaded, rangeKey, deletedIds]
  );
  const loading = rangeKey !== null && loaded.key !== rangeKey && loadError?.key !== rangeKey;
  const refreshing = salesLoading && !loading;

  const handlePreset = (preset: string) => {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);

    switch (preset) {
      case 'today':
        break;
      case 'yesterday':
        start = subDays(today, 1);
        end = subDays(today, 1);
        break;
      case 'last7':
        start = subDays(today, 6);
        break;
      case 'last30':
        start = subDays(today, 29);
        break;
      case 'complete':
        start = new Date('2020-01-01');
        break;
    }

    const range = {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd')
    };
    setDateRange(range);
    setDateInputs(range);
    setActivePreset(preset);
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [showInvoiceModal, setShowInvoiceModal] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const needsPassword = requiresPasswordReauth(currentUser);
  const actorMeta = useMemo(() => buildActorMeta({ currentUser, userRole }), [currentUser, userRole]);

  // Sales with a delete in flight: their buttons are disabled, and the ref stops a
  // second click before the screen has caught up.
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const busyRef = useRef<Set<string>>(new Set());
  const markBusy = (ids: string[], busy: boolean) => {
    for (const id of ids) {
      if (busy) busyRef.current.add(id);
      else busyRef.current.delete(id);
    }
    setBusyIds(new Set(busyRef.current));
  };

  const [shownCount, setShownCount] = useState(ROWS_PER_PAGE);
  useEffect(() => { setShownCount(ROWS_PER_PAGE); }, [rangeKey, searchTerm, paymentFilter]);
  // A new date range starts with nothing selected, so a bulk delete never
  // touches sales that are no longer on screen.
  useEffect(() => { setSelectedIds([]); }, [rangeKey]);

  const filteredSales = useMemo(() => {
    const filtered = sales.filter(s => {
      const customer = customers.find(c => c.id === s.customerId);
      const customerName = customer?.name || 'Walk-in';
      const searchLower = searchTerm.toLowerCase();
      
      const matchesSearch = 
        customerName.toLowerCase().includes(searchLower) || 
        s.id?.toLowerCase().includes(searchLower) ||
        s.items?.some((item: any) => item.productName?.toLowerCase().includes(searchLower));

      return matchesSearch && (paymentFilter === 'all' || s.paymentMethod === paymentFilter);
    });

    return filtered.sort((a, b) => {
      const dateA = toDisplayDate(a.saleDate, a.saleDateClient) || new Date(0);
      const dateB = toDisplayDate(b.saleDate, b.saleDateClient) || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [sales, customers, searchTerm, paymentFilter]);

  const visibleSales = useMemo(() => filteredSales.slice(0, shownCount), [filteredSales, shownCount]);

  /**
   * A deleted sale's stock, bottles and udhaar were restored on the server: this
   * device's copy is read again at once, and the shop's other devices are told.
   */
  const afterSalesDeleted = (deleted: any[]) => {
    if (!deleted.length || !shopId) return;
    announceDeleted('sales', deleted.map(s => s.id));
    for (const sale of deleted) {
      void refreshAfterSaleReversal(shopId, sale).catch(err => console.warn('[Sales] Refresh after delete failed', err));
    }
  };

  const handleDelete = async (sale: any) => {
    if (!canDeleteSales) {
      toast.error(REASONS.deleteSale);
      return;
    }
    if (busyRef.current.has(sale.id)) return;
    if (!window.confirm('Are you sure you want to delete this sale? This will reverse all inventory and credit changes.')) return;
    markBusy([sale.id], true);
    try {
      await deleteSaleWithReversal(sale, shopId, actorMeta);
      hideDeleted(sale.id);
      setSelectedIds(prev => prev.filter(id => id !== sale.id));
      afterSalesDeleted([sale]);
      toast.success('Sale deleted and inventory restored');
    } catch (error: any) {
      console.error(error);
      toast.error(`The sale was not deleted: ${friendlyError(error)}`);
    } finally {
      markBusy([sale.id], false);
      refetchSales();
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    // Only the rows on screen: never select sales that cannot be seen.
    const visibleIds = visibleSales.map((s) => s.id);
    setSelectedIds((prev) => checked
      ? [...new Set([...prev, ...visibleIds])]
      : prev.filter((id) => !visibleIds.includes(id)));
  };
  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id));
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length || bulkDeleting) return;
    if (!canDeleteSales) {
      toast.error(REASONS.deleteSale);
      return;
    }
    const targets = sales.filter((s) => selectedIds.includes(s.id) && !busyRef.current.has(s.id));
    if (!targets.length) {
      toast.error('The selected sales are not in the loaded list. Press Load Sales and select them again.');
      return;
    }
    setBulkDeleting(true);
    try {
      if (needsPassword && currentUser) {
        await reauthenticateForSensitiveAction(currentUser, deletePassword);
      }
    } catch (error: any) {
      toast.error(friendlyError(error, 'Could not confirm your password'));
      setBulkDeleting(false);
      return;
    }

    const total = targets.length;
    let deleted = 0;
    let failuresInARow = 0;
    let firstError = '';
    const done: any[] = [];
    markBusy(targets.map((s) => s.id), true);
    try {
      for (const sale of targets) {
        try {
          await deleteSaleWithReversal(sale, shopId, actorMeta);
          hideDeleted(sale.id);
          done.push(sale);
          deleted += 1;
          failuresInARow = 0;
          setSelectedIds((prev) => prev.filter((id) => id !== sale.id));
        } catch (error: any) {
          console.error(error);
          failuresInARow += 1;
          if (!firstError) firstError = friendlyError(error);
        } finally {
          markBusy([sale.id], false);
        }
        if (failuresInARow >= MAX_FAILURES_IN_A_ROW) break;
      }
      if (deleted === total) {
        toast.success(`${deleted} of ${total} sale(s) deleted, inventory restored`);
      } else {
        toast.error(`${deleted} of ${total} sale(s) deleted. The rest were not deleted and stay selected. First error: ${firstError}`, { duration: 10000 });
      }
      setShowBulkDeleteModal(false);
      setDeleteTyped('');
      setDeletePassword('');
    } finally {
      markBusy(targets.map((s) => s.id), false);
      setBulkDeleting(false);
      afterSalesDeleted(done);
      refetchSales();
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/20">
            <History size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sales History</h1>
            <p className="text-slate-500 text-sm">View and manage all your past sales and transactions</p>
            {!canDeleteSales && <p className="text-slate-400 text-xs mt-0.5">{REASONS.deleteSale}</p>}
          </div>
        </div>

      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="metric-card-cyan rounded-2xl p-6 shadow-lg shadow-cyan-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <ShoppingCart size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Sales</p>
            <p className="text-3xl font-bold text-white">{sales.length}</p>
          </div>
        </div>
        <div className="metric-card-violet rounded-2xl p-6 shadow-lg shadow-violet-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <TrendingUp size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Revenue</p>
            <p className="text-3xl font-bold text-white">
              {formatCurrency(sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0))}
            </p>
          </div>
        </div>
        
        {/* New KPI: Total Profit */}
        {userRole === 'admin' && (
          <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-6 shadow-lg shadow-amber-500/20 relative overflow-hidden group">
            <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
              <TrendingUp size={24} className="text-white" />
            </div>
            <div className="relative z-10">
              <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Profit</p>
              <p className="text-3xl font-bold text-white">
                {formatCurrency(sales.reduce((acc, s) => acc + (Number(s.totalProfit) || 0), 0))}
              </p>
            </div>
          </div>
        )}

        {/* New KPI: Cash Payments */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-6 shadow-lg shadow-emerald-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <Banknote size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Cash Payments</p>
            <p className="text-3xl font-bold text-white">
              {(() => {
                const getSplit = (s: any) => {
                  if (!s.splitAmounts) return { cash: 0, online: 0, credit: 0 };
                  if (typeof s.splitAmounts === 'string') {
                    try { return JSON.parse(s.splitAmounts); } catch { return { cash: 0, online: 0, credit: 0 }; }
                  }
                  return s.splitAmounts;
                };

                return formatCurrency(
                  sales.filter(s => s.paymentMethod === 'cash').reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0) + 
                  sales.filter(s => s.paymentMethod === 'split').reduce((acc, s) => acc + (Number(getSplit(s).cash) || 0), 0)
                );
              })()}
            </p>
          </div>
        </div>

        {/* New KPI: Online Payments */}
        <div className="bg-gradient-to-br from-sky-400 to-blue-500 rounded-2xl p-6 shadow-lg shadow-sky-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <RefreshCw size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Online Payments</p>
            <p className="text-3xl font-bold text-white">
              {(() => {
                const getSplit = (s: any) => {
                  if (!s.splitAmounts) return { cash: 0, online: 0, credit: 0 };
                  if (typeof s.splitAmounts === 'string') {
                    try { return JSON.parse(s.splitAmounts); } catch { return { cash: 0, online: 0, credit: 0 }; }
                  }
                  return s.splitAmounts;
                };

                return formatCurrency(
                  sales.filter(s => s.paymentMethod === 'online').reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0) + 
                  sales.filter(s => s.paymentMethod === 'split').reduce((acc, s) => acc + (Number(getSplit(s).online) || 0), 0)
                );
              })()}
            </p>
          </div>
        </div>

        {/* Existing & New Credit/Return KPIs grouped nicely */}
        <div className="metric-card-orange rounded-2xl p-6 shadow-lg shadow-orange-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <CreditCard size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Credit Sales (#)</p>
            <p className="text-3xl font-bold text-white">{sales.filter(s => s.paymentMethod === 'credit').length}</p>
          </div>
        </div>

        {/* New KPI: Credit Payments ($) */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 shadow-lg shadow-indigo-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <CreditCard size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Credit Payments ($)</p>
            <p className="text-3xl font-bold text-white">
              {(() => {
                const getSplit = (s: any) => {
                  if (!s.splitAmounts) return { cash: 0, online: 0, credit: 0 };
                  if (typeof s.splitAmounts === 'string') {
                    try { return JSON.parse(s.splitAmounts); } catch { return { cash: 0, online: 0, credit: 0 }; }
                  }
                  return s.splitAmounts;
                };

                return formatCurrency(
                  sales.filter(s => s.paymentMethod === 'credit').reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0) + 
                  sales.filter(s => s.paymentMethod === 'split').reduce((acc, s) => acc + (Number(getSplit(s).credit) || 0), 0)
                );
              })()}
            </p>
          </div>
        </div>

        <div className="metric-card-red rounded-2xl p-6 shadow-lg shadow-rose-500/20 relative overflow-hidden group">
          <div className="absolute top-4 right-4 p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <RotateCcw size={24} className="text-white" />
          </div>
          <div className="relative z-10">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Returns</p>
            <p className="text-3xl font-bold text-white">{sales.filter(s => s.paymentMethod === 'return').length}</p>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="glass-card p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {['today', 'yesterday', 'last7', 'last30', 'complete'].map(preset => (
            <button
              key={preset}
              onClick={() => handlePreset(preset)}
              className={cn(
                "px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-xl transition-all",
                activePreset === preset ? "bg-violet-600 text-white shadow-lg shadow-violet-600/20" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
              )}
            >
              {preset === 'last7' ? 'Last 7 Days' : preset === 'last30' ? 'Last 30 Days' : preset}
            </button>
          ))}
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex items-center gap-3">
            <input 
              type="date" 
              value={dateInputs.start}
              onChange={(e) => {
                const value = e.target.value;
                setDateInputs(inputs => ({ ...inputs, start: value }));
                if (!dayBoundIso(value, 'start')) return; // ignore an empty or invalid date
                setDateRange(range => ({ ...range, start: value }));
                setActivePreset('custom');
              }}
              className="px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none transition-all"
            />
            <span className="text-slate-300 font-bold text-xs uppercase">to</span>
            <input 
              type="date" 
              value={dateInputs.end}
              onChange={(e) => {
                const value = e.target.value;
                setDateInputs(inputs => ({ ...inputs, end: value }));
                if (!dayBoundIso(value, 'end')) return; // ignore an empty or invalid date
                setDateRange(range => ({ ...range, end: value }));
                setActivePreset('custom');
              }}
              className="px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm font-medium focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={() => { setHasSearched(true); refetchSales(); }}
            disabled={salesLoading}
            className="flex items-center gap-2 px-6 py-2.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-fuchsia-600/20 disabled:opacity-50"
          >
            <Search size={16} />
            {refreshing ? 'Refreshing...' : 'Load Sales'}
          </button>
        </div>

        {loadError?.key === rangeKey && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>Could not load sales: {loadError.message}</span>
            <button type="button" onClick={refetchSales} className="font-bold whitespace-nowrap hover:text-rose-900">Retry</button>
          </div>
        )}
        {loaded.key === rangeKey && !loaded.complete && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Sales were added or deleted while this list was loading, so the totals may be off by a sale or two. Press Load Sales to read them again.
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4 pt-4 border-t border-slate-100">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search by customer name or sale ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all shadow-sm"
            />
          </div>
          <div className="flex gap-3">
            <select 
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/20 shadow-sm"
            >
              <option value="all">All Payments</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
              <option value="credit">Credit</option>
              <option value="split">Split</option>
              <option value="return">Return</option>
            </select>
          </div>
          {canDeleteSales && selectedIds.length > 0 && (
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold"
            >
              Delete Selected ({selectedIds.length})
            </button>
          )}
        </div>
      </div>

      {/* Sales Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sale ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Customer</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Method</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">By</th>
                {canDeleteSales && (
                  <th className="px-3 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">
                    <input
                      type="checkbox"
                      checked={visibleSales.length > 0 && visibleSales.every((s) => selectedIds.includes(s.id))}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSales.map((sale, index) => {
                const busy = busyIds.has(sale.id);
                const customer = customers.find(c => c.id === sale.customerId);
                const currentSaleDate = toDisplayDate(sale.saleDate, sale.saleDateClient) || new Date();
                const currentDateStr = currentSaleDate.toLocaleDateString();
                
                let showDaySeparator = false;
                if (index > 0) {
                  const prevSale = visibleSales[index - 1];
                  const prevSaleDate = toDisplayDate(prevSale.saleDate, prevSale.saleDateClient) || new Date();
                  if (currentDateStr !== prevSaleDate.toLocaleDateString()) {
                    showDaySeparator = true;
                  }
                }
                
                return (
                  <React.Fragment key={sale.id}>
                    {showDaySeparator && (
                      <tr>
                        <td colSpan={canDeleteSales ? 8 : 7} className="px-6 py-3 bg-slate-100/50 border-y border-slate-200/60">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-violet-500" />
                            <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">{currentDateStr}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <span className="text-[10px] font-bold font-mono text-slate-400 group-hover:text-violet-600 transition-colors">
                        #{sale.id?.slice(-6).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                          <User size={14} />
                        </div>
                        <span className="text-slate-900 font-bold">{customer?.name || 'Walk-in'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-emerald-600 font-bold">{formatCurrency(sale.totalAmount)}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 w-fit",
                        sale.paymentMethod === 'cash' ? "bg-violet-100 text-violet-600" :
                        sale.paymentMethod === 'online' ? "bg-blue-100 text-blue-600" :
                        sale.paymentMethod === 'credit' ? "bg-amber-100 text-amber-600" :
                        sale.paymentMethod === 'split' ? "bg-teal-100 text-teal-600" :
                        "bg-rose-100 text-rose-600"
                      )}>
                        {sale.paymentMethod === 'cash' && <Banknote size={12} />}
                        {sale.paymentMethod === 'online' && <RefreshCw size={12} />}
                        {sale.paymentMethod === 'credit' && <CreditCard size={12} />}
                        {sale.paymentMethod === 'split' && <Split size={12} />}
                        {sale.paymentMethod}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-slate-500 font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-slate-400" />
                          <span>{currentDateStr}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <Clock size={12} className="text-slate-300" />
                          <span>{currentSaleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                          sale.actorRole === 'cashier' ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"
                        )}>
                          {sale.actorRole === 'cashier' ? 'Cashier' : 'Admin'}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">{sale.actorName || 'System'}</span>
                      </div>
                    </td>
                    {canDeleteSales && (
                      <td className="px-3 py-4 text-right">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(sale.id)}
                          disabled={busy}
                          onChange={(e) => toggleSelectOne(sale.id, e.target.checked)}
                        />
                      </td>
                    )}
                    <td className="px-6 py-4 text-right">
                      <div className={cn(
                        "flex items-center justify-end gap-2 transition-opacity",
                        busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}>
                        {busy && <span className="text-xs font-semibold text-slate-400">Deleting...</span>}
                        <button 
                          onClick={() => setShowInvoiceModal(sale)}
                          disabled={busy}
                          className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed" 
                          title="View Invoice"
                        >
                          <FileText size={18} />
                        </button>
                        {canDeleteSales && (
                          <>
                            {/* Edit is paused until it becomes a server command (Phase 4). */}
                            <span
                              role="img"
                              aria-label={`Edit sale: ${EDIT_PAUSED_TIP}`}
                              title={EDIT_PAUSED_TIP}
                              className="p-2 text-slate-200 cursor-not-allowed"
                            >
                              <Edit size={18} />
                            </span>
                            <button 
                              onClick={() => handleDelete(sale)}
                              disabled={busy}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed" 
                              title="Delete Sale"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredSales.length > visibleSales.length && (
          <div className="p-4 text-center border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShownCount((n) => n + ROWS_PER_PAGE)}
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-100"
            >
              Showing {visibleSales.length} of {filteredSales.length}: show {Math.min(ROWS_PER_PAGE, filteredSales.length - visibleSales.length)} more
            </button>
          </div>
        )}
        {filteredSales.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <History className="text-slate-300" size={40} />
            </div>
            <p className="text-slate-400 font-medium">No sales found matching your search.</p>
          </div>
        )}
      </div>

      {/* Invoice Modal */}
      {showInvoiceModal && (
        <InvoiceModal 
          sale={showInvoiceModal} 
          customer={customers.find(c => c.id === showInvoiceModal.customerId)}
          busy={busyIds.has(showInvoiceModal.id)}
          onClose={() => setShowInvoiceModal(null)} 
          editPaused={canDeleteSales}
        />
      )}
      <ConfirmBulkDeleteModal
        open={showBulkDeleteModal}
        count={selectedIds.length}
        title="Delete selected sales?"
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
    </div>
  );
};

/**
 * busy: a request for this sale is running, so the modal cannot be closed or
 * printed until it finishes. editPaused: show (to admins) that editing and
 * removing an item are paused.
 */
const InvoiceModal: React.FC<{ sale: any, customer: any, busy?: boolean, editPaused?: boolean, onClose: () => void }> = ({ sale, customer, busy = false, editPaused = false, onClose }) => {
  const { shopId } = useAuth();
  const { document: settings } = useDocumentOnce<any>(shopId ? 'settings' : null, shopId, 'shopId');

  const handlePrint = () => {
    if (busy) return;
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:p-0">
      <div className="bg-white text-black rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in duration-300 print:shadow-none print:rounded-none print:max-h-none print:w-full">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10 print:hidden">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Invoice #{sale.id?.slice(-6).toUpperCase()}</h2>
            {editPaused && (
              <p className="text-xs text-gray-400 mt-1" title={EDIT_PAUSED_TIP}>
                Edit and Remove item are paused: delete the sale and ring it again.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {busy && <span className="text-xs font-semibold text-gray-400">Working...</span>}
            <button 
              onClick={handlePrint}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer size={18} />
              Print
            </button>
            <button onClick={onClose} disabled={busy} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"><X size={20} /></button>
          </div>
        </div>

        <div className="p-8 space-y-8" id="printable-invoice">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-black text-violet-600 uppercase tracking-tighter">{settings?.shopName || 'VapeTrax'}</h1>
              {settings?.showShopAddress && <p className="text-sm text-gray-500 mt-1">{settings.shopAddress}</p>}
              {settings?.showShopPhone && <p className="text-sm text-gray-500">{settings.shopPhone}</p>}
            </div>
            <div className="text-right">
              <h2 className="text-4xl font-black text-gray-200 uppercase">Invoice</h2>
              <p className="text-sm font-bold text-gray-800 mt-2">#{sale.id?.toUpperCase()}</p>
              <p className="text-sm text-gray-500">
                {(toDisplayDate(sale.saleDate, sale.saleDateClient) || new Date()).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 border-y border-gray-100 py-8">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Bill To</p>
              <p className="text-lg font-bold text-gray-800">{customer?.name || 'Walk-in Customer'}</p>
              {customer?.phone && <p className="text-sm text-gray-500">{customer.phone}</p>}
              {customer?.email && <p className="text-sm text-gray-500">{customer.email}</p>}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Payment Info</p>
              <p className="text-lg font-bold text-gray-800 uppercase">{sale.paymentMethod}</p>
              <p className="text-sm text-gray-500">Status: Paid</p>
            </div>
          </div>

          {/* Items */}
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-gray-800 text-left text-[10px] font-black uppercase tracking-widest text-gray-400">
                <th className="py-4">Description</th>
                <th className="py-4 text-center">Qty/ML</th>
                <th className="py-4 text-right">Price</th>
                <th className="py-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sale.items?.map((item: any, idx: number) => (
                <tr key={idx} className="group/row">
                  <td className="py-4">
                    <p className="font-bold text-gray-800">{item.productName}</p>
                    <p className="text-[10px] text-gray-400 uppercase font-bold">{item.saleType.replace('_', ' ')}</p>
                  </td>
                  <td className="py-4 text-center font-bold text-gray-600">
                    {item.saleType === 'refill' ? `${item.refillAmount}ml x ${item.quantity}` : item.quantity}
                  </td>
                  <td className="py-4 text-right text-gray-600">{formatCurrency(item.unitPrice)}</td>
                  <td className="py-4 text-right font-bold text-gray-800">{formatCurrency(item.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end pt-8">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>{formatCurrency(sale.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Tax (0%)</span>
                <span>Rs 0</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t-2 border-gray-800">
                <span className="text-lg font-black uppercase">Total</span>
                <span className="text-2xl font-black text-violet-600">{formatCurrency(sale.totalAmount)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-12 text-center border-t border-gray-100">
            <p className="text-sm font-bold text-gray-800">{settings?.footerMessage || 'Thank you for your business!'}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-2">Generated by {settings?.shopName || 'VapeTrax'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sales;
